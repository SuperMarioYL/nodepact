/**
 * The CLI surface, driven the way a user drives it.
 *
 * Every case here runs the built binary as a child process, so commander's wiring, the exit codes
 * and the error hints are exercised for real. The cases that need Chrome point at a port nothing
 * listens on, which pins the "cannot reach Chrome" hint without a browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../dist/anchor/store.js";

const CLI = fileURLToPath(new URL("../dist/cli/index.js", import.meta.url));
const DEAD_PORT = "1";

function run(args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", ...options });
}

function seededStore() {
  const cwd = mkdtempSync(join(tmpdir(), "nodepact-cli-"));
  const store = new Store(cwd);
  store.writePairs([
    {
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
    },
  ]);
  return cwd;
}

test("--version prints the package version", () => {
  const result = run(["--version"]);
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "0.1.0");
});

test("--help lists every command", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0);
  for (const command of [
    "init [options]",
    "annotate [options]",
    "check [options] [node]",
    "label [options] [node]",
    "mcp [options]",
  ]) {
    assert.ok(result.stdout.includes(command), `help should mention ${command}`);
  }
});

test("label prints the stored anchors as a table", () => {
  const cwd = seededStore();
  const result = run(["label", "--store", join(cwd, ".nodepact")]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /#submit/);
  assert.match(result.stdout, /gap\(#email, #submit\) >= 12px/);
  assert.match(result.stdout, /提交按钮和上面的邮箱输入框太近了/);
  rmSync(cwd, { recursive: true, force: true });
});

test("label on an empty store says so without failing", () => {
  const cwd = mkdtempSync(join(tmpdir(), "nodepact-cli-empty-"));
  const result = run(["label", "--store", join(cwd, ".nodepact")]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /no anchors in/);
  assert.match(result.stdout, /nodepact annotate/);
  rmSync(cwd, { recursive: true, force: true });
});

test("check without anchors fails with the next step", () => {
  const cwd = mkdtempSync(join(tmpdir(), "nodepact-cli-empty-"));
  const result = run(["check", "--store", join(cwd, ".nodepact")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no anchors in .*steer\.yaml; run `nodepact annotate` first/);
  rmSync(cwd, { recursive: true, force: true });
});

test("check for an unknown node lists the stored ones", () => {
  const cwd = seededStore();
  const result = run(["check", "#nope", "--store", join(cwd, ".nodepact")]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /no stored anchor matches "#nope"/);
  assert.match(result.stderr, /stored anchors: #submit/);
  rmSync(cwd, { recursive: true, force: true });
});

test("check on a stored anchor explains how to enable remote debugging when Chrome is not there", () => {
  const cwd = seededStore();
  const result = run(["check", "#submit", "--store", join(cwd, ".nodepact"), "--port", DEAD_PORT]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot reach Chrome's DevTools endpoint/);
  assert.match(result.stderr, /--remote-debugging-port=1/);
  rmSync(cwd, { recursive: true, force: true });
});

test("init fails with the remote-debugging hint when Chrome is not listening", () => {
  const cwd = mkdtempSync(join(tmpdir(), "nodepact-cli-init-"));
  const result = run(["init", "--port", DEAD_PORT, "--store", join(cwd, ".nodepact")], { cwd });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot reach Chrome's DevTools endpoint at http:\/\/127\.0\.0\.1:1\/json\/version/);
  assert.match(result.stderr, /Start Chrome with remote debugging enabled/);
  rmSync(cwd, { recursive: true, force: true });
});

test("mcp --install prints a client config snippet with absolute paths", () => {
  const cwd = mkdtempSync(join(tmpdir(), "nodepact-cli-mcp-"));
  const config = join(cwd, "nodepact.yaml");
  const store = join(cwd, ".nodepact");
  const result = run(["mcp", "--install", "--config", config, "--store", store]);
  assert.equal(result.status, 0);
  const snippet = JSON.parse(result.stdout);
  const server = snippet.mcpServers.nodepact;
  assert.equal(server.command, "npx");
  assert.deepEqual(server.args.slice(0, 3), ["-y", "nodepact", "mcp"]);
  assert.ok(server.args.includes("--config"));
  assert.ok(server.args.includes(config));
  assert.ok(server.args.includes(store));
  rmSync(cwd, { recursive: true, force: true });
});

test("--port rejects a value that is not a port", () => {
  const result = run(["init", "--port", "70000"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a port number: 70000/);
});
