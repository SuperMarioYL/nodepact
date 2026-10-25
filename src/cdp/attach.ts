/**
 * CDP attach layer.
 *
 * Nodepact never launches a browser. It attaches to the Chrome the developer already
 * has open, using the DevTools HTTP endpoint (`http://<host>:<port>/json/*`) to find the
 * page target and its WebSocket URL, then talks to that page over the protocol.
 *
 * Everything that touches the page goes through the `PageBridge` returned here: a single
 * evaluation entry point plus the page -> CLI message channel used by the annotation overlay.
 */
import CDP from "chrome-remote-interface";

/** Where Chrome's DevTools HTTP endpoint listens. */
export type CdpLocation = {
  host: string;
  port: number;
};

/** A page target as reported by `/json/list`. */
export type TargetInfo = {
  id: string;
  url: string;
  title: string;
  wsUrl: string;
};

export type PageBridge = {
  target: TargetInfo;
  client: CDP.Client;
  /** Evaluate an expression in the page's main frame and return its value. */
  evaluate<T>(expression: string): Promise<T>;
  close(): Promise<void>;
};

type DevtoolsVersion = {
  Browser?: string;
  webSocketDebuggerUrl?: string;
};

type DevtoolsTarget = {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
};

const HTTP_TIMEOUT_MS = 3000;

function endpoint(location: CdpLocation, path: string): string {
  return `http://${location.host}:${location.port}${path}`;
}

function remoteDebuggingHint(location: CdpLocation): string {
  return [
    `Start Chrome with remote debugging enabled and keep the page you want to check open, e.g.:`,
    `  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=${location.port}`,
    `  google-chrome --remote-debugging-port=${location.port}            # Linux`,
    `Then re-run this command.`,
  ].join("\n");
}

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`${url} answered HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Ask Chrome who it is and for its browser-level WebSocket URL. */
async function discoverChrome(
  location: CdpLocation,
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<{ browser: string; wsUrl: string }> {
  const url = endpoint(location, "/json/version");
  let version: DevtoolsVersion;
  try {
    version = await getJson<DevtoolsVersion>(url, timeoutMs);
  } catch (error) {
    throw new Error(
      `cannot reach Chrome's DevTools endpoint at ${url}: ${(error as Error).message}\n${remoteDebuggingHint(location)}`,
    );
  }
  return { browser: version.Browser ?? "unknown", wsUrl: version.webSocketDebuggerUrl ?? "" };
}

/** Every inspectable page target, in Chrome's own order. */
async function listPages(
  location: CdpLocation,
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<TargetInfo[]> {
  const url = endpoint(location, "/json/list");
  const raw = await getJson<DevtoolsTarget[]>(url, timeoutMs);
  return raw
    .filter((target) => target.type === "page" && !target.url.startsWith("devtools://"))
    .map((target) => ({
      id: target.id,
      url: target.url,
      title: target.title,
      wsUrl: target.webSocketDebuggerUrl ?? "",
    }));
}

export type AttachOptions = {
  location: CdpLocation;
  /** Prefix of the dev server URL to attach to; `null` accepts a single open page. */
  urlMatch?: string | null;
};

/**
 * Attach to one page target.
 *
 * Target selection is deliberately strict: with `urlMatch` the first page whose URL starts
 * with it wins; without it a single open page is accepted and anything else is an error that
 * lists the candidates, so a check never silently runs against the wrong tab.
 */
export async function attach(options: AttachOptions): Promise<PageBridge> {
  const { location } = options;
  await discoverChrome(location);
  const pages = await listPages(location);
  if (pages.length === 0) {
    throw new Error(`Chrome has no open page target at ${location.host}:${location.port}`);
  }

  const wanted = options.urlMatch?.replace(/\/+$/, "") ?? null;
  let target: TargetInfo | undefined;
  if (wanted) {
    target = pages.find((page) => page.url.replace(/\/+$/, "").startsWith(wanted));
    if (!target) {
      throw new Error(
        `no open page starts with ${wanted}; open pages:\n${pages.map((page) => `  ${page.url}`).join("\n")}`,
      );
    }
  } else if (pages.length === 1) {
    target = pages[0];
  } else {
    throw new Error(
      `Chrome has ${pages.length} open pages; pass --url <prefix> to pick one:\n${pages
        .map((page) => `  ${page.url}`)
        .join("\n")}`,
    );
  }
  if (!target?.wsUrl) {
    throw new Error(`page ${target?.url ?? "?"} has no WebSocket debugger URL`);
  }

  const client = await CDP({ target: target.wsUrl });
  await Promise.all([client.Runtime.enable(), client.Page.enable()]);

  return {
    target,
    client,
    async evaluate<T>(expression: string): Promise<T> {
      const { result, exceptionDetails } = await client.Runtime.evaluate({
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });
      if (exceptionDetails) {
        const detail = exceptionDetails.exception?.description ?? exceptionDetails.text;
        throw new Error(`page evaluation failed: ${detail}`);
      }
      return result.value as T;
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

type Waiter = {
  where: (payload: unknown) => boolean;
  settle: (payload: unknown) => void;
  fail: (error: Error) => void;
};

/**
 * Page -> CLI message channel built on `Runtime.addBinding`.
 *
 * Payloads are queued from the moment the binding is installed, so a message the page sends
 * before the CLI starts waiting for it is never lost.
 */
export class BindingChannel {
  readonly #client: CDP.Client;
  readonly #name: string;
  readonly #queue: unknown[] = [];
  readonly #waiters: Waiter[] = [];
  #closed = false;

  private constructor(client: CDP.Client, name: string) {
    this.#client = client;
    this.#name = name;
  }

  static async open(client: CDP.Client, name: string): Promise<BindingChannel> {
    const channel = new BindingChannel(client, name);
    client.Runtime.bindingCalled(({ name: called, payload }) => {
      if (called !== channel.#name || channel.#closed) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const index = channel.#waiters.findIndex((waiter) => waiter.where(parsed));
      if (index >= 0) {
        const [waiter] = channel.#waiters.splice(index, 1);
        waiter.settle(parsed);
      } else {
        channel.#queue.push(parsed);
      }
    });
    await client.Runtime.addBinding({ name });
    return channel;
  }

  /** Wait for the next payload the page sends. Non-matching payloads are dropped. */
  next<T>(options: { timeoutMs?: number; where?: (payload: unknown) => boolean } = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 900_000;
    const where = options.where ?? (() => true);
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = {
        where,
        settle: (payload) => {
          clearTimeout(timer);
          resolve(payload as T);
        },
        fail: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s waiting for the page`));
      }, timeoutMs);

      const queuedIndex = this.#queue.findIndex(where);
      if (queuedIndex >= 0) {
        const [payload] = this.#queue.splice(queuedIndex, 1);
        waiter.settle(payload);
        return;
      }
      this.#waiters.push(waiter);
    });
  }

  dispose(): void {
    this.#closed = true;
    this.#queue.length = 0;
    for (const waiter of this.#waiters.splice(0)) {
      waiter.fail(new Error("the page channel was closed"));
    }
  }
}
