#!/usr/bin/env node
/**
 * The Nodepact CLI: the composition root.
 *
 * Commands:
 *   init      attach to the developer's already-open Chrome and set up the local store
 *   annotate  inject the overlay, pick a node, write a Chinese annotation, confirm the assertion
 *   check     re-render the anchored node and return PASS/FAIL plus the render diff
 *   label     list the stored anchors, or replace the annotation on one of them
 *   mcp       run the stdio MCP server, or print the client config snippet
 *
 * `runCheck` and `runList` are exported so the MCP transport can reuse exactly the same code
 * path as the CLI; the verdict itself is computed in src/oracle and never touches a model.
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Command, InvalidArgumentError, Option } from "commander";
import { BindingChannel, attach, type PageBridge } from "../cdp/attach.js";
import { captureNode, createMeasurer, focusNode } from "../cdp/snapshot.js";
import {
  anchorIdFromFacts,
  fingerprintHash,
  fingerprintNode,
  nearbySelectors,
  resolveAnchor,
} from "../anchor/fingerprint.js";
import {
  CONFIG_FILENAME,
  DEFAULT_STORE_DIR,
  Store,
  loadConfig,
  persistCdpTarget,
  type Config,
  type SteerPair,
} from "../anchor/store.js";
import {
  formatAssertion,
  formatRatio,
  measureAssertion,
  parseAssertion,
  type MeasureSource,
} from "../oracle/assert.js";
import { diffPng } from "../oracle/diff.js";
import { decideVerdict, type Verdict } from "../oracle/verdict.js";
import { draftAssertion, providerStatus } from "../annotate/draft.js";
import { startMcpServer } from "../mcp/server.js";

const VERSION = (
  JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

const BINDING_NAME = "__nodepactSend";
/** Gap between the two captures used to measure a node's own re-render noise. */
const NOISE_SAMPLE_MS = 120;

// ---------------------------------------------------------------------------------------------
// check
// ---------------------------------------------------------------------------------------------

export type CheckResult = {
  node: string;
  anchor_id: string;
  anchor_fp: string;
  matched_by: "selector" | "fingerprint";
  match_score: number;
  assertion: string;
  /** Measured value when the baseline was captured; `null` for `changed()`. */
  before: number | string | null;
  /** Measured value now. */
  after: number | string | null;
  assertion_pass: boolean;
  assertion_detail: string;
  render_diff: {
    changed_px: number;
    total_px: number;
    ratio: number;
    /** Re-render noise of the unchanged node, measured on this run. */
    noise_ratio: number;
    epsilon: number;
    stability_floor: number;
    artifact: string;
    diff_artifact: string;
  };
  verdict: Verdict;
  reason: string;
  checked_at: string;
};

export type CheckFailure = { node: string; error: string; hint: string };
export type CheckOutcome = CheckResult | CheckFailure;

export function isFailure(outcome: CheckOutcome): outcome is CheckFailure {
  return "error" in outcome;
}

export type TargetRequest = {
  cwd: string;
  storeDir?: string;
  configPath?: string;
  url?: string;
  port?: number;
};

export type CheckRequest = TargetRequest & { node?: string };

function selectPairs(store: Store, node?: string): SteerPair[] {
  if (node) {
    const pair = store.findPair(node);
    if (!pair) {
      throw new Error(
        `no stored anchor matches "${node}"; stored anchors: ${
          store
            .readPairs()
            .map((entry) => entry.anchor.selector)
            .join(", ") || "none"
        }`,
      );
    }
    return [pair];
  }
  const pairs = store.readPairs();
  if (pairs.length === 0) {
    throw new Error(`no anchors in ${store.display(store.steerPath)}; run \`nodepact annotate\` first`);
  }
  return pairs;
}

async function checkPair(input: {
  bridge: PageBridge;
  store: Store;
  config: Config;
  measurer: MeasureSource;
  pair: SteerPair;
}): Promise<CheckOutcome> {
  const { bridge, store, config, measurer, pair } = input;
  const node = pair.anchor.selector;
  const fpHash = fingerprintHash(pair.anchor.fp);
  const assertion = pair.assertion;

  const resolution = await resolveAnchor(bridge, pair.anchor);
  if (!resolution) {
    return {
      node,
      error: "anchor_not_found",
      hint:
        `no node in the page matches fp ${fpHash} (${pair.anchor.selector}) well enough to be ` +
        `unambiguous; re-anchor the node with \`nodepact annotate\``,
    };
  }

  let baseline: Buffer;
  try {
    baseline = store.readBaseline(pair);
  } catch (error) {
    return { node, error: "baseline_missing", hint: (error as Error).message };
  }

  const scale = config.oracle.capture_scale;
  const margin = config.oracle.capture_margin;
  const threshold = config.oracle.pixel_threshold;
  const box = await focusNode(bridge, resolution.facts.selector);
  const first = await captureNode(bridge, box, { scale, margin });
  await sleep(NOISE_SAMPLE_MS);
  const boxNow = await focusNode(bridge, resolution.facts.selector);
  const after = await captureNode(bridge, boxNow, { scale, margin });

  const noise = diffPng(first, after, { pixelThreshold: threshold });
  const render = diffPng(baseline, after, { pixelThreshold: threshold });

  const measured = await measureAssertion(assertion, measurer, {
    node: resolution.facts.selector,
    diffRatio: render.ratio,
    epsilon: config.oracle.epsilon,
  });
  const decision = decideVerdict({
    assertionPass: measured.pass,
    assertionDetail: measured.detail,
    diffRatio: render.ratio,
    noiseRatio: noise.ratio,
    epsilon: config.oracle.epsilon,
    stabilityFloor: config.oracle.stability_floor,
  });

  return {
    node,
    anchor_id: pair.anchor.id,
    anchor_fp: fpHash,
    matched_by: resolution.matchedBy,
    match_score: Number(resolution.score.toFixed(3)),
    assertion: formatAssertion(assertion),
    before: pair.baseline_measure,
    after: measured.actual,
    assertion_pass: measured.pass,
    assertion_detail: measured.detail,
    render_diff: {
      changed_px: render.changedPx,
      total_px: render.totalPx,
      ratio: Number(render.ratio.toFixed(4)),
      noise_ratio: Number(noise.ratio.toFixed(4)),
      epsilon: config.oracle.epsilon,
      stability_floor: config.oracle.stability_floor,
      artifact: store.writeDiff(pair.anchor.id, "after", after),
      diff_artifact: store.writeDiff(pair.anchor.id, "diff", render.maskPng),
    },
    verdict: decision.verdict,
    reason: decision.reason,
    checked_at: new Date().toISOString(),
  };
}

/** Re-render every requested anchor and return one outcome per anchor, in store order. */
export async function runCheck(request: CheckRequest): Promise<CheckOutcome[]> {
  const loaded = loadConfig(request.cwd, request.configPath);
  const store = new Store(request.cwd, request.storeDir ?? DEFAULT_STORE_DIR);
  const pairs = selectPairs(store, request.node);
  const bridge = await attach({
    location: {
      host: loaded.config.cdp.host,
      port: request.port ?? loaded.config.cdp.port,
    },
    urlMatch: request.url ?? loaded.config.cdp.url_match,
  });
  try {
    const measurer = createMeasurer(bridge);
    const outcomes: CheckOutcome[] = [];
    for (const pair of pairs) {
      outcomes.push(await checkPair({ bridge, store, config: loaded.config, measurer, pair }));
    }
    return outcomes;
  } finally {
    await bridge.close();
  }
}

export type AnchorSummary = {
  node: string;
  anchor_id: string;
  anchor_fp: string;
  annotation: string;
  assertion: string;
  baseline: string;
  created_at: string;
};

/** The stored steering pairs, as data. Used by `nodepact label` and the MCP `nodepact.list`. */
export function runList(request: { cwd: string; storeDir?: string }): AnchorSummary[] {
  const store = new Store(request.cwd, request.storeDir ?? DEFAULT_STORE_DIR);
  return store.readPairs().map((pair) => ({
    node: pair.anchor.selector,
    anchor_id: pair.anchor.id,
    anchor_fp: fingerprintHash(pair.anchor.fp),
    annotation: pair.annotation,
    assertion: formatAssertion(pair.assertion),
    baseline: pair.anchor.baseline_png,
    created_at: pair.created_at,
  }));
}

// ---------------------------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------------------------

async function runInit(request: TargetRequest): Promise<number> {
  const loaded = loadConfig(request.cwd, request.configPath);
  const port = request.port ?? loaded.config.cdp.port;
  const urlMatch = request.url ?? loaded.config.cdp.url_match;
  const bridge = await attach({
    location: { host: loaded.config.cdp.host, port },
    urlMatch,
  });
  console.log(
    `attached to Chrome via CDP  ${bridge.target.wsUrl}   page: ${pagePath(bridge.target.url)}`,
  );
  await bridge.close();

  const store = new Store(request.cwd, request.storeDir ?? DEFAULT_STORE_DIR);
  store.ensure();
  persistCdpTarget(loaded.path, { url: urlMatch, port });

  console.log(`config   ${relative(request.cwd, loaded.path)}`);
  console.log(`store    ${store.display(store.dir)}/`);
  console.log(`next     nodepact annotate`);
  return 0;
}

// ---------------------------------------------------------------------------------------------
// annotate
// ---------------------------------------------------------------------------------------------

type OverlayMessage =
  | { type: "ready" }
  | { type: "pick"; pick_id: string }
  | { type: "submit"; pick_id: string; annotation: string }
  | { type: "cancel" };

function isOverlayMessage(payload: unknown): payload is OverlayMessage {
  return typeof payload === "object" && payload !== null && "type" in payload;
}

async function runAnnotate(request: TargetRequest): Promise<number> {
  const loaded = loadConfig(request.cwd, request.configPath);
  const config = loaded.config;
  const store = new Store(request.cwd, request.storeDir ?? DEFAULT_STORE_DIR);
  store.ensure();

  const bridge = await attach({
    location: { host: config.cdp.host, port: request.port ?? config.cdp.port },
    urlMatch: request.url ?? config.cdp.url_match,
  });
  const channel = await BindingChannel.open(bridge.client, BINDING_NAME);
  const readline = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const overlaySource = readFileSync(new URL("../annotate/overlay.js", import.meta.url), "utf8");
    await bridge.evaluate(
      `window.__nodepactBoot = ${JSON.stringify({
        anchors: store.readPairs().map((pair) => pair.anchor.selector),
      })};`,
    );
    await bridge.evaluate(overlaySource);
    await channel.next({ where: isOverlayMessage, timeoutMs: 30_000 });

    console.log("click a node ...");
    const picked = await channel.next<OverlayMessage>({
      where: (payload) => isOverlayMessage(payload) && (payload.type === "pick" || payload.type === "cancel"),
    });
    if (picked.type === "cancel") {
      console.log("cancelled");
      return 0;
    }
    if (picked.type !== "pick") throw new Error("unexpected overlay message");

    const facts = await fingerprintNode(bridge, `[data-nodepact-pick="${picked.pick_id}"]`);
    const fpHash = fingerprintHash(facts.fp);
    await bridge.evaluate(`window.__nodepactOverlay.release(${JSON.stringify(picked.pick_id)})`);
    await bridge.evaluate(
      `window.__nodepactOverlay.confirmPick(${JSON.stringify({
        selector: facts.selector,
        fp_hash: fpHash,
        width: Math.round(facts.box.w),
        height: Math.round(facts.box.h),
      })})`,
    );
    console.log(`picked ${facts.selector}  fp ${fpHash}`);

    const submitted = await channel.next<OverlayMessage>({
      where: (payload) =>
        isOverlayMessage(payload) && (payload.type === "submit" || payload.type === "cancel"),
    });
    if (submitted.type === "cancel") {
      console.log("cancelled");
      return 0;
    }
    if (submitted.type !== "submit") throw new Error("unexpected overlay message");
    const annotation = submitted.annotation.trim();
    console.log(`annotation (zh): ${annotation}`);

    const draft = await offerDraft({ bridge, config, facts, annotation });
    const assertionText = await confirmAssertion(readline, draft);
    const assertion = parseAssertion(assertionText);

    const box = await focusNode(bridge, facts.selector);
    const measured = await measureAssertion(assertion, createMeasurer(bridge), {
      node: facts.selector,
      diffRatio: 0,
      epsilon: config.oracle.epsilon,
    });
    const baselinePng = await captureNode(bridge, box, {
      scale: config.oracle.capture_scale,
      margin: config.oracle.capture_margin,
    });

    const anchorId = anchorIdFromFacts(facts);
    const now = new Date().toISOString();
    store.upsertPair({
      anchor: {
        id: anchorId,
        selector: facts.selector,
        fp: facts.fp,
        baseline_png: store.writeBaseline(anchorId, baselinePng),
        box,
      },
      annotation,
      assertion,
      baseline_measure: assertion.kind === "changed" ? null : measured.actual,
      created_at: now,
      updated_at: null,
    });

    console.log(
      `saved to ${store.display(store.steerPath)}   (node fp ${fpHash}, baseline ` +
        `${Math.round(box.w)}x${Math.round(box.h)})`,
    );
    console.log(`next: nodepact check`);
    return 0;
  } finally {
    readline.close();
    await bridge.evaluate("window.__nodepactOverlay && window.__nodepactOverlay.destroy()").catch(() => undefined);
    channel.dispose();
    await bridge.close();
  }
}

/** Ask the configured model for a draft. Returns `null` when the endpoint is not usable. */
async function offerDraft(input: {
  bridge: PageBridge;
  config: Config;
  facts: { selector: string; tag: string; text: string; box: { x: number; y: number; w: number; h: number } };
  annotation: string;
}): Promise<string | null> {
  const status = providerStatus(input.config);
  if (!status.ready) {
    console.log(`draft skipped (${status.reason}); write the assertion by hand`);
    return null;
  }
  const candidates = await nearbySelectors(input.bridge, input.facts.selector);
  const outcome = await draftAssertion({
    annotation: input.annotation,
    anchor: input.facts,
    candidates,
    config: input.config,
  });
  if (!outcome.assertion) {
    console.log(`draft skipped (${outcome.error ?? "no usable answer"}); write the assertion by hand`);
    return null;
  }
  console.log(`draft assertion: ${outcome.assertion}      [y / edit / n]`);
  return outcome.assertion;
}

async function confirmAssertion(
  readline: ReturnType<typeof createInterface>,
  draft: string | null,
): Promise<string> {
  if (draft) {
    const answer = (await readline.question("accept? ")).trim().toLowerCase();
    if (answer === "" || answer === "y" || answer === "yes") return draft;
    return promptAssertion(readline, answer === "n" || answer === "no" ? null : draft);
  }
  return promptAssertion(readline, null);
}

async function promptAssertion(
  readline: ReturnType<typeof createInterface>,
  fallback: string | null,
): Promise<string> {
  for (;;) {
    const answer = (await readline.question(fallback ? `assertion [${fallback}]: ` : "assertion: ")).trim();
    const text = answer || fallback || "";
    if (!text) {
      console.log("an assertion is required, e.g. gap(#email, #submit) >= 12px");
      continue;
    }
    try {
      return formatAssertion(parseAssertion(text));
    } catch (error) {
      console.log((error as Error).message);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// label
// ---------------------------------------------------------------------------------------------

async function runLabel(request: TargetRequest & { node?: string; text?: string }): Promise<number> {
  const store = new Store(request.cwd, request.storeDir ?? DEFAULT_STORE_DIR);
  const pairs = store.readPairs();
  if (pairs.length === 0) {
    console.log(`no anchors in ${store.display(store.steerPath)}; run \`nodepact annotate\` first`);
    return 0;
  }
  if (!request.node) {
    printAnchorTable(pairs);
    return 0;
  }
  const pair = store.findPair(request.node);
  if (!pair) {
    console.error(`no stored anchor matches "${request.node}"`);
    return 2;
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = request.text ?? (await readline.question(`annotation for ${pair.anchor.selector}: `));
    const annotation = answer.trim();
    if (!annotation) {
      console.log("unchanged");
      return 0;
    }
    store.updatePair(pair.anchor.id, { annotation });
    console.log(`annotation updated for ${pair.anchor.selector}`);
    return 0;
  } finally {
    readline.close();
  }
}

function printAnchorTable(pairs: SteerPair[]): void {
  const width = Math.max(...pairs.map((pair) => pair.anchor.selector.length));
  for (const pair of pairs) {
    console.log(
      `${pair.anchor.selector.padEnd(width)}  ${formatAssertion(pair.assertion).padEnd(36)}  ${pair.annotation}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// output helpers
// ---------------------------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pagePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function formatMeasured(value: number | string | null): string {
  if (value === null) return "n/a";
  return typeof value === "number" ? String(value) : value;
}

function printOutcome(outcome: CheckOutcome): void {
  if (isFailure(outcome)) {
    console.log(`${outcome.node}  ERROR ${outcome.error}`);
    console.log(`  ${outcome.hint}`);
    return;
  }
  console.log(`${outcome.node}  ${outcome.assertion}`);
  console.log(
    `  before ${formatMeasured(outcome.before)}  after ${formatMeasured(outcome.after)}  assertion ${
      outcome.assertion_pass ? "PASS" : "FAIL"
    }`,
  );
  console.log(
    `  render diff ${outcome.render_diff.changed_px}px (${formatRatio(outcome.render_diff.ratio)})  ` +
      `noise ${formatRatio(outcome.render_diff.noise_ratio)}  epsilon ${formatRatio(outcome.render_diff.epsilon)}`,
  );
  console.log(`  artifact ${outcome.render_diff.artifact}`);
  console.log(`  verdict ${outcome.verdict}  ${outcome.reason}`);
}

function exitCodeFor(outcomes: CheckOutcome[]): number {
  if (outcomes.some(isFailure)) return 2;
  if (outcomes.some((outcome) => !isFailure(outcome) && outcome.verdict !== "DONE")) return 1;
  return 0;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new InvalidArgumentError(`not a port number: ${value}`);
  }
  return port;
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

type CommonOptions = {
  config?: string;
  store?: string;
  url?: string;
  port?: number;
};

function addCommonOptions(command: Command): Command {
  return command
    .addOption(new Option("--config <path>", `config file (default ./${CONFIG_FILENAME})`))
    .addOption(new Option("--store <dir>", "local state directory").default(DEFAULT_STORE_DIR))
    .addOption(new Option("--url <url>", "dev server URL prefix to attach to"))
    .addOption(new Option("--port <number>", "Chrome DevTools port").argParser(parsePort));
}

function targetRequest(options: CommonOptions): TargetRequest {
  return {
    cwd: process.cwd(),
    storeDir: options.store,
    configPath: options.config,
    url: options.url,
    port: options.port,
  };
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("nodepact")
    .description(
      "元素锚定的 UI 纠偏与验收：在开发者已开的 Chrome 里点一个节点、写一句中文批注，" +
        "用该节点的渲染差异判定 DONE / NOT_DONE",
    )
    .version(VERSION)
    .showHelpAfterError();

  const initCommand = addCommonOptions(
    program.command("init").description("attach to your open Chrome and set up the local store"),
  );
  initCommand.action(async (_options, command: Command) => {
    process.exitCode = await runInit(targetRequest(command.opts<CommonOptions>()));
  });

  const annotateCommand = addCommonOptions(
    program
      .command("annotate")
      .description("pick a node in the page, write an annotation and confirm its assertion"),
  );
  annotateCommand.action(async (_options, command: Command) => {
    process.exitCode = await runAnnotate(targetRequest(command.opts<CommonOptions>()));
  });

  const checkCommand = addCommonOptions(
    program
      .command("check [node]")
      .description("re-render the anchored node and return PASS/FAIL with the render diff")
      .option("--json", "print the result as JSON"),
  );
  checkCommand.action(async (node: string | undefined, _options, command: Command) => {
    const options = command.opts<CommonOptions & { json?: boolean }>();
    const outcomes = await runCheck({ ...targetRequest(options), node });
    if (options.json) {
      console.log(JSON.stringify(outcomes.length === 1 ? outcomes[0] : outcomes, null, 2));
    } else {
      for (const outcome of outcomes) printOutcome(outcome);
    }
    process.exitCode = exitCodeFor(outcomes);
  });

  const labelCommand = addCommonOptions(
    program
      .command("label [node]")
      .description("list stored anchors, or replace the annotation on one of them")
      .option("--text <annotation>", "the annotation to store"),
  );
  labelCommand.action(async (node: string | undefined, _options, command: Command) => {
    const options = command.opts<CommonOptions & { text?: string }>();
    process.exitCode = await runLabel({ ...targetRequest(options), node, text: options.text });
  });

  const mcpCommand = addCommonOptions(
    program
      .command("mcp")
      .description("run the stdio MCP server exposing nodepact.check / nodepact.list")
      .option("--install", "print the MCP client config snippet instead of serving"),
  );
  mcpCommand.action(async (_options, command: Command) => {
    const options = command.opts<CommonOptions & { install?: boolean }>();
    const request = targetRequest(options);
    if (options.install) {
      console.log(mcpClientSnippet(request));
      return;
    }
    await startMcpServer(
      {
        check: async (input) => {
          const outcomes = await runCheck({ ...request, node: input.node });
          // Same shape as `nodepact check --json`: one object for one anchor, an array for many.
          return outcomes.length === 1 ? outcomes[0] : outcomes;
        },
        list: async () => runList(request),
      },
      VERSION,
    );
  });

  return program;
}

function mcpClientSnippet(request: TargetRequest): string {
  return JSON.stringify(
    {
      mcpServers: {
        nodepact: {
          command: "npx",
          args: [
            "-y",
            "nodepact",
            "mcp",
            "--config",
            resolve(request.cwd, request.configPath ?? CONFIG_FILENAME),
            "--store",
            resolve(request.cwd, request.storeDir ?? DEFAULT_STORE_DIR),
          ],
        },
      },
    },
    null,
    2,
  );
}

buildProgram()
  .parseAsync(process.argv)
  .catch((error: unknown) => {
    console.error(`nodepact: ${(error as Error).message}`);
    process.exitCode = 2;
  });
