/**
 * The local project store.
 *
 * Everything Nodepact keeps lives in two places in the developer's project, and both are
 * plain files with no server, no database and no upload:
 *
 *   nodepact.yaml            tunables: CDP target, oracle thresholds, model providers
 *   .nodepact/steer.yaml     the steering pairs (anchors + annotations + assertions)
 *   .nodepact/baseline/*.png the crop captured when the anchor was created
 *   .nodepact/diffs/*.png    the crops and pixel-diff masks written by `check`
 *
 * Defaults live in {@link DEFAULT_CONFIG} and nowhere else; `configs/nodepact.yaml` is the
 * documented copy of the same values.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { AssertionSchema } from "../oracle/assert.js";
import type { Box } from "./fingerprint.js";

export const DEFAULT_STORE_DIR = ".nodepact";
export const CONFIG_FILENAME = "nodepact.yaml";

const PROVIDER_DEFAULTS: Record<string, ProviderConfig> = {
  deepseek: {
    base_url: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    api_key_env: "DEEPSEEK_API_KEY",
  },
  qwen: {
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    api_key_env: "DASHSCOPE_API_KEY",
  },
  // GLM's OpenAI-compatible endpoint differs per deployment (bigmodel.cn vs a private
  // gateway), so no URL is shipped here: set the one your gateway exposes.
  glm: {
    base_url: "",
    model: "glm-5",
    api_key_env: "ZHIPUAI_API_KEY",
  },
  kimi: {
    base_url: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-auto",
    api_key_env: "MOONSHOT_API_KEY",
  },
};

const ProviderSchema = z
  .object({
    base_url: z.string(),
    model: z.string().min(1),
    api_key_env: z.string().min(1),
  })
  .strict();

export const ConfigSchema = z
  .object({
    version: z.number().int(),
    cdp: z
      .object({
        host: z.string().min(1),
        port: z.number().int().positive(),
        url_match: z.string().nullable(),
      })
      .strict(),
    oracle: z
      .object({
        /** A render diff this large (fraction of the crop) counts as "the node really changed". */
        epsilon: z.number().min(0).max(1),
        /** Node re-render noise above this makes the pixel diff unusable -> UNSTABLE. */
        stability_floor: z.number().min(0).max(1),
        capture_scale: z.number().positive(),
        /**
         * Pixels of neighbourhood captured around the node. A tight crop moves with the node,
         * so a fix that only relocates it would show no pixel diff at all.
         */
        capture_margin: z.number().min(0),
        /** pixelmatch per-pixel colour tolerance. */
        pixel_threshold: z.number().min(0).max(1),
      })
      .strict(),
    model: z
      .object({
        provider: z.string().min(1),
        timeout_ms: z.number().int().positive(),
      })
      .strict(),
    providers: z.record(ProviderSchema),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderSchema>;

export const DEFAULT_CONFIG: Config = {
  version: 1,
  cdp: { host: "127.0.0.1", port: 9222, url_match: null },
  oracle: { epsilon: 0.01, stability_floor: 0.01, capture_scale: 1, capture_margin: 16, pixel_threshold: 0.1 },
  model: { provider: "deepseek", timeout_ms: 20_000 },
  providers: PROVIDER_DEFAULTS,
};

export const BoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const AnchorSchema = z.object({
  /** Filesystem-safe short id; also the artifact file stem (`submit`, `n4a91c2`). */
  id: z.string().min(1),
  selector: z.string().min(1),
  fp: z.string().min(1),
  /** Path of the baseline crop, relative to the project root. */
  baseline_png: z.string().min(1),
  /** The node's box when it was anchored (CSS px, document coordinates); a record, not a key. */
  box: BoxSchema,
});

export const SteerPairSchema = z.object({
  anchor: AnchorSchema,
  /** The human's own words (usually Chinese) about what is wrong with the node. */
  annotation: z.string(),
  /**
   * The assertion, stored in its structured form rather than as DSL text. YAML ends a plain
   * scalar at " #", so a hand-written `assertion: gap(#email, #submit) >= 12px` would silently
   * parse as `gap(#email,` — the exact edit this file invites. The one-line DSL form is still
   * what the CLI takes, prints and asks the model for.
   */
  assertion: AssertionSchema,
  /** The assertion's measured value when the baseline was captured; `null` for `changed()`. */
  baseline_measure: z.union([z.number(), z.string()]).nullable(),
  created_at: z.string(),
  updated_at: z.string().nullable(),
});

export const SteerFileSchema = z.object({
  version: z.number().int(),
  pairs: z.array(SteerPairSchema),
});

export type Anchor = z.infer<typeof AnchorSchema>;
export type SteerPair = z.infer<typeof SteerPairSchema>;

const STEER_HEADER =
  "# Nodepact steering pairs: one anchor + one human annotation + one machine-checkable\n" +
  "# assertion per entry. Hand-editable — the annotation is plain text and the assertion is a\n" +
  "# small block (kind: gap | style | changed). Selector values need quotes: YAML reads a plain\n" +
  "# value starting with # as a comment. `annotate` fills in baseline_measure; if you replace an\n" +
  "# assertion by hand, set it to null so `check` does not print a stale before value.\n";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : override) as T;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in merged ? deepMerge(merged[key], value) : value;
  }
  return merged as T;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  ${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("\n");
}

export type LoadedConfig = {
  config: Config;
  path: string;
  /** False when no config file exists yet and built-in defaults were used. */
  exists: boolean;
};

/** Read `nodepact.yaml` (or an explicit path), merged over {@link DEFAULT_CONFIG}. */
export function loadConfig(cwd: string, explicitPath?: string): LoadedConfig {
  const path = resolve(cwd, explicitPath ?? CONFIG_FILENAME);
  if (!existsSync(path)) {
    if (explicitPath) throw new Error(`config file not found: ${path}`);
    return { config: DEFAULT_CONFIG, path, exists: false };
  }
  const raw = parseYaml(readFileSync(path, "utf8")) as unknown;
  const merged = deepMerge(DEFAULT_CONFIG, raw ?? {});
  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(`invalid config in ${path}:\n${formatIssues(parsed.error)}`);
  }
  return { config: parsed.data, path, exists: true };
}

/**
 * Persist the CDP target into `nodepact.yaml`, creating the file from defaults if needed.
 * The YAML document API is used so a hand-written config keeps its comments and layout.
 */
export function persistCdpTarget(
  path: string,
  target: { url: string | null; port: number },
): void {
  const source = existsSync(path) ? readFileSync(path, "utf8") : stringifyYaml(DEFAULT_CONFIG);
  const document = parseDocument(source);
  document.setIn(["cdp", "url_match"], target.url);
  document.setIn(["cdp", "port"], target.port);
  writeFileSync(path, document.toString());
}

export class Store {
  readonly cwd: string;
  readonly dir: string;

  constructor(cwd: string, storeDir: string = DEFAULT_STORE_DIR) {
    this.cwd = resolve(cwd);
    this.dir = resolve(this.cwd, storeDir);
  }

  get steerPath(): string {
    return join(this.dir, "steer.yaml");
  }

  get baselineDir(): string {
    return join(this.dir, "baseline");
  }

  get diffsDir(): string {
    return join(this.dir, "diffs");
  }

  /** Create the directory layout and an empty steer file. Safe to call repeatedly. */
  ensure(): void {
    mkdirSync(this.baselineDir, { recursive: true });
    mkdirSync(this.diffsDir, { recursive: true });
    if (!existsSync(this.steerPath)) this.writePairs([]);
  }

  readPairs(): SteerPair[] {
    if (!existsSync(this.steerPath)) return [];
    const raw = parseYaml(readFileSync(this.steerPath, "utf8")) as unknown;
    if (raw === null || raw === undefined) return [];
    const parsed = SteerFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`invalid steer file at ${this.steerPath}:\n${formatIssues(parsed.error)}`);
    }
    return parsed.data.pairs;
  }

  writePairs(pairs: SteerPair[]): void {
    mkdirSync(this.dir, { recursive: true });
    const body = stringifyYaml({ version: 1, pairs }, { lineWidth: 0 });
    writeFileSync(this.steerPath, STEER_HEADER + body);
  }

  /** Find one pair by anchor id, by stored selector, or by `#id`. */
  findPair(node: string): SteerPair | undefined {
    const wanted = node.replace(/^#/, "");
    return this.readPairs().find(
      (pair) =>
        pair.anchor.id === wanted ||
        pair.anchor.id === node ||
        pair.anchor.selector === node ||
        pair.anchor.selector === `#${wanted}`,
    );
  }

  upsertPair(pair: SteerPair): void {
    const pairs = this.readPairs();
    const index = pairs.findIndex((existing) => existing.anchor.id === pair.anchor.id);
    if (index >= 0) {
      pairs[index] = { ...pair, created_at: pairs[index]!.created_at };
    } else {
      pairs.push(pair);
    }
    this.writePairs(pairs);
  }

  updatePair(anchorId: string, patch: Partial<Pick<SteerPair, "annotation" | "assertion">>): SteerPair {
    const pairs = this.readPairs();
    const index = pairs.findIndex((pair) => pair.anchor.id === anchorId);
    if (index < 0) throw new Error(`no stored anchor with id ${anchorId}`);
    const current = pairs[index]!;
    const updated: SteerPair = { ...current, ...patch, updated_at: new Date().toISOString() };
    pairs[index] = updated;
    this.writePairs(pairs);
    return updated;
  }

  /** Write the baseline crop and return its path relative to the project root. */
  writeBaseline(anchorId: string, png: Buffer): string {
    const path = join(this.baselineDir, `${anchorId}.png`);
    writeFileSync(path, png);
    return relative(this.cwd, path);
  }

  readBaseline(pair: SteerPair): Buffer {
    const path = resolve(this.cwd, pair.anchor.baseline_png);
    if (!existsSync(path)) {
      throw new Error(
        `baseline crop missing at ${pair.anchor.baseline_png} for anchor ${pair.anchor.id}; ` +
          `re-run \`nodepact annotate\` to capture a fresh baseline`,
      );
    }
    return readFileSync(path);
  }

  /** Write a check artifact and return its path relative to the project root. */
  writeDiff(anchorId: string, kind: "after" | "diff", png: Buffer): string {
    const path = join(this.diffsDir, `${anchorId}.${kind}.png`);
    writeFileSync(path, png);
    return relative(this.cwd, path);
  }

  /** Path as printed to the user: relative to the project root. */
  display(path: string): string {
    return relative(this.cwd, path);
  }
}
