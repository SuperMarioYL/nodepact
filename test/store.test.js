/**
 * The local store: .nodepact/steer.yaml, the baseline crops and the check artifacts.
 *
 * The assertion is stored as a structured block rather than as one line of DSL text, because YAML
 * ends a plain scalar at " #" and `assertion: gap(#email, #submit) >= 12px` would silently parse as
 * `gap(#email,`. The round-trip test pins that decision.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  ConfigSchema,
  DEFAULT_CONFIG,
  Store,
  loadConfig,
  persistCdpTarget,
} from "../dist/anchor/store.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "nodepact-store-"));
}

function pair(overrides = {}) {
  return {
    anchor: {
      id: "submit",
      selector: "#submit",
      fp: "button#submit[type=button]|div>form#settings>main|t:b6fc31",
      baseline_png: ".nodepact/baseline/submit.png",
      box: { x: 431, y: 226.59375, w: 68, h: 46 },
    },
    annotation: "提交按钮和上面的邮箱输入框太近了",
    assertion: { kind: "gap", a: "#email", b: "#submit", op: ">=", px: 12 },
    baseline_measure: 4,
    created_at: "2026-10-26T02:41:00.000Z",
    updated_at: null,
    ...overrides,
  };
}

test("ensure() creates the layout and an empty steer file", () => {
  const cwd = tempDir();
  const store = new Store(cwd);
  assert.equal(store.steerPath, join(cwd, ".nodepact", "steer.yaml"));
  store.ensure();
  assert.ok(existsSync(store.baselineDir));
  assert.ok(existsSync(store.diffsDir));
  assert.ok(existsSync(store.steerPath));
  assert.deepEqual(store.readPairs(), []);
  assert.match(readFileSync(store.steerPath, "utf8"), /^# Nodepact steering pairs/);
  rmSync(cwd, { recursive: true, force: true });
});

test("a steering pair survives the YAML round trip with its structured assertion", () => {
  const cwd = tempDir();
  const store = new Store(cwd);
  store.writePairs([pair()]);

  const raw = readFileSync(store.steerPath, "utf8");
  const document = parseYaml(raw);
  assert.equal(typeof document.pairs[0].assertion, "object", "the assertion is a block, not a scalar");
  assert.equal(document.pairs[0].assertion.kind, "gap");
  assert.match(raw, /kind: gap/);
  assert.match(raw, /a: "#email"/, "a selector starting with # must be quoted");

  const [restored] = store.readPairs();
  assert.deepEqual(restored.assertion, { kind: "gap", a: "#email", b: "#submit", op: ">=", px: 12 });
  assert.equal(restored.annotation, "提交按钮和上面的邮箱输入框太近了");
  assert.equal(restored.anchor.id, "submit");
  assert.deepEqual(restored.anchor.box, { x: 431, y: 226.59375, w: 68, h: 46 });
  rmSync(cwd, { recursive: true, force: true });
});

test("all three assertion kinds round-trip, including a null baseline measure", () => {
  const cwd = tempDir();
  const store = new Store(cwd);
  store.writePairs([
    pair(),
    pair({
      anchor: { ...pair().anchor, id: "reset", selector: "#reset" },
      assertion: { kind: "style", prop: "display", op: "!=", value: "none" },
      baseline_measure: "inline-block",
    }),
    pair({
      anchor: { ...pair().anchor, id: "status", selector: "#status" },
      assertion: { kind: "changed" },
      baseline_measure: null,
    }),
  ]);
  const pairs = store.readPairs();
  assert.equal(pairs.length, 3);
  assert.deepEqual(pairs[1].assertion, { kind: "style", prop: "display", op: "!=", value: "none" });
  assert.deepEqual(pairs[2].assertion, { kind: "changed" });
  assert.equal(pairs[2].baseline_measure, null);
  rmSync(cwd, { recursive: true, force: true });
});

test("findPair accepts an id, a #id and the stored selector", () => {
  const cwd = tempDir();
  const store = new Store(cwd);
  store.writePairs([pair()]);
  assert.equal(store.findPair("submit")?.anchor.id, "submit");
  assert.equal(store.findPair("#submit")?.anchor.id, "submit");
  assert.equal(store.findPair("#email"), undefined);
  rmSync(cwd, { recursive: true, force: true });
});

test("upsertPair updates in place and keeps created_at", () => {
  const cwd = tempDir();
  const store = new Store(cwd);
  store.upsertPair(pair());
  store.upsertPair({ ...pair(), annotation: "再远一点", updated_at: "2026-10-26T03:00:00.000Z" });
  const pairs = store.readPairs();
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].annotation, "再远一点");
  assert.equal(pairs[0].created_at, "2026-10-26T02:41:00.000Z");
  rmSync(cwd, { recursive: true, force: true });
});

test("updatePair stamps updated_at and rejects an unknown anchor", () => {
  const cwd = tempDir();
  const store = new Store(cwd);
  store.writePairs([pair()]);
  const updated = store.updatePair("submit", { annotation: "改短一点" });
  assert.equal(updated.annotation, "改短一点");
  assert.ok(updated.updated_at);
  assert.equal(store.readPairs()[0].annotation, "改短一点");
  assert.throws(() => store.updatePair("nope", { annotation: "x" }), /no stored anchor with id nope/);
  rmSync(cwd, { recursive: true, force: true });
});

test("baselines and diff artifacts are written under .nodepact/ and read back byte for byte", () => {
  const cwd = tempDir();
  const store = new Store(cwd);
  store.ensure();
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const relative = store.writeBaseline("submit", bytes);
  assert.equal(relative, join(".nodepact", "baseline", "submit.png"));
  assert.deepEqual(store.readBaseline(pair()), bytes);

  assert.equal(store.writeDiff("submit", "after", bytes), join(".nodepact", "diffs", "submit.after.png"));
  assert.equal(store.writeDiff("submit", "diff", bytes), join(".nodepact", "diffs", "submit.diff.png"));
  assert.ok(existsSync(join(cwd, ".nodepact", "diffs", "submit.diff.png")));

  rmSync(join(cwd, ".nodepact", "baseline", "submit.png"));
  assert.throws(() => store.readBaseline(pair()), /baseline crop missing/);
  rmSync(cwd, { recursive: true, force: true });
});

test("a corrupted steer file is reported, not silently dropped", () => {
  const cwd = tempDir();
  const store = new Store(cwd);
  store.ensure();
  writeFileSync(store.steerPath, "version: 1\npairs:\n  - anchor: {id: submit}\n");
  assert.throws(() => store.readPairs(), /invalid steer file/);
  rmSync(cwd, { recursive: true, force: true });
});

test("config defaults load without a file", () => {
  const cwd = tempDir();
  const loaded = loadConfig(cwd);
  assert.equal(loaded.exists, false);
  assert.deepEqual(loaded.config, DEFAULT_CONFIG);
  assert.equal(loaded.config.oracle.epsilon, 0.01);
  assert.equal(loaded.config.oracle.stability_floor, 0.01);
  assert.equal(loaded.config.oracle.capture_margin, 16);
  assert.equal(loaded.config.providers.deepseek.model, "deepseek-chat");
  assert.equal(loaded.config.providers.qwen.model, "qwen-plus");
  assert.equal(loaded.config.providers.kimi.model, "moonshot-v1-auto");
  assert.equal(loaded.config.providers.glm.model, "glm-5");
  assert.equal(loaded.config.providers.glm.base_url, "", "GLM's endpoint is deployment specific");
  assert.throws(() => loadConfig(cwd, "missing.yaml"), /config file not found/);
  rmSync(cwd, { recursive: true, force: true });
});

test("a hand-written config is merged over the defaults", () => {
  const cwd = tempDir();
  writeFileSync(join(cwd, "nodepact.yaml"), "version: 1\noracle:\n  epsilon: 0.05\ncdp:\n  port: 9333\n");
  const loaded = loadConfig(cwd);
  assert.equal(loaded.exists, true);
  assert.equal(loaded.config.oracle.epsilon, 0.05);
  assert.equal(loaded.config.oracle.capture_margin, 16, "unspecified keys keep their default");
  assert.equal(loaded.config.cdp.port, 9333);
  rmSync(cwd, { recursive: true, force: true });
});

test("an out-of-range or unknown config value fails loudly", () => {
  const cwd = tempDir();
  writeFileSync(join(cwd, "nodepact.yaml"), "version: 1\noracle:\n  epsilon: 2\n");
  assert.throws(() => loadConfig(cwd), /invalid config/);

  writeFileSync(join(cwd, "nodepact.yaml"), "version: 1\nnope: 1\n");
  assert.throws(() => loadConfig(cwd), /invalid config/);

  assert.equal(ConfigSchema.safeParse({ ...DEFAULT_CONFIG, oracle: { ...DEFAULT_CONFIG.oracle, epsilon: 1.5 } }).success, false);
  rmSync(cwd, { recursive: true, force: true });
});

test("init persists the CDP target without losing the rest of the file", () => {
  const cwd = tempDir();
  const path = join(cwd, "nodepact.yaml");
  persistCdpTarget(path, { url: "http://localhost:5173", port: 9222 });
  const first = loadConfig(cwd).config;
  assert.equal(first.cdp.url_match, "http://localhost:5173");
  assert.equal(first.cdp.port, 9222);

  persistCdpTarget(path, { url: "http://localhost:3000", port: 9333 });
  const second = loadConfig(cwd).config;
  assert.equal(second.cdp.url_match, "http://localhost:3000");
  assert.equal(second.cdp.port, 9333);
  assert.equal(second.oracle.capture_margin, 16);
  rmSync(cwd, { recursive: true, force: true });
});
