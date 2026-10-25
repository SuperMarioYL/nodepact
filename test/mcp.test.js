/**
 * The MCP tool surface.
 *
 * The test speaks the real protocol: it spawns `nodepact mcp` exactly as a coding agent would,
 * connects a real MCP client over stdio, and calls the two tools. Neither tool needs a browser
 * here — `nodepact.list` reads the store and `nodepact.check` fails before it reaches CDP when the
 * anchor is unknown, which is the error path an agent hits first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Store } from "../dist/anchor/store.js";

const CLI = fileURLToPath(new URL("../dist/cli/index.js", import.meta.url));
const TIMEOUT = { timeout: 30_000 };

function seededStore() {
  const cwd = mkdtempSync(join(tmpdir(), "nodepact-mcp-"));
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
  return { cwd, store };
}

async function withClient(cwd, run) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, "mcp", "--store", join(cwd, ".nodepact")],
    stderr: "pipe",
  });
  const client = new Client({ name: "nodepact-test", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

const textOf = (result) => result.content.map((part) => part.text ?? "").join("\n");

test("exposes exactly nodepact.check and nodepact.list", TIMEOUT, async () => {
  const { cwd } = seededStore();
  await withClient(cwd, async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ["nodepact.check", "nodepact.list"],
    );

    const check = tools.find((tool) => tool.name === "nodepact.check");
    assert.match(check.description, /DONE \/ NOT_DONE \/ UNSTABLE/);
    assert.match(check.description, /no model is involved/);
    assert.equal(check.inputSchema.type, "object");
    assert.ok(check.inputSchema.properties.node, "node is the optional anchor argument");

    const list = tools.find((tool) => tool.name === "nodepact.list");
    assert.match(list.description, /steering pairs/);
  });
  rmSync(cwd, { recursive: true, force: true });
});

test("nodepact.list returns the stored steering pair as JSON", TIMEOUT, async () => {
  const { cwd } = seededStore();
  await withClient(cwd, async (client) => {
    const result = await client.callTool({ name: "nodepact.list", arguments: {} });
    assert.ok(!result.isError, "list must not fail");
    const [summary] = JSON.parse(textOf(result));
    assert.equal(summary.node, "#submit");
    assert.equal(summary.anchor_id, "submit");
    assert.match(summary.anchor_fp, /^[0-9a-f]{6}$/);
    assert.equal(summary.assertion, "gap(#email, #submit) >= 12px");
    assert.equal(summary.annotation, "提交按钮和上面的邮箱输入框太近了");
    assert.equal(summary.baseline, ".nodepact/baseline/submit.png");
  });
  rmSync(cwd, { recursive: true, force: true });
});

test("an empty store lists nothing instead of failing", TIMEOUT, async () => {
  const cwd = mkdtempSync(join(tmpdir(), "nodepact-mcp-empty-"));
  await withClient(cwd, async (client) => {
    const result = await client.callTool({ name: "nodepact.list", arguments: {} });
    assert.ok(!result.isError);
    assert.deepEqual(JSON.parse(textOf(result)), []);
  });
  rmSync(cwd, { recursive: true, force: true });
});

test("nodepact.check reports an unknown anchor as a tool error, not a crash", TIMEOUT, async () => {
  const { cwd } = seededStore();
  await withClient(cwd, async (client) => {
    const result = await client.callTool({ name: "nodepact.check", arguments: { node: "#nope" } });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /nodepact\.check failed: no stored anchor matches "#nope"/);
  });
  rmSync(cwd, { recursive: true, force: true });
});

test("an unknown tool is reported as a protocol error", TIMEOUT, async () => {
  const { cwd } = seededStore();
  await withClient(cwd, async (client) => {
    const result = await client.callTool({ name: "nodepact.nope", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(textOf(result), /Tool nodepact\.nope not found/);
  });
  rmSync(cwd, { recursive: true, force: true });
});
