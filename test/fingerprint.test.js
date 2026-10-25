/**
 * Anchor fingerprints: reading a node's facts, re-locating it after the DOM drifted, and refusing
 * to guess when two candidates score the same.
 *
 * The page-side algorithm is a string that the real code evaluates inside the page. To exercise it
 * without a browser, the test runs it in a `node:vm` context over a minimal DOM shim and drives the
 * module through a PageBridge that evaluates expressions in that context. The scoring, the
 * ambiguity margin and the selector-first shortcut therefore run for real.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  anchorIdFromFacts,
  fingerprintHash,
  fingerprintNode,
  locateByFingerprint,
  nearbySelectors,
  resolveAnchor,
  selfSegment,
} from "../dist/anchor/fingerprint.js";

// -------------------------------------------------------------------------------------------
// A minimal DOM: elements, a body, and the handful of selectors the page runtime uses.
// -------------------------------------------------------------------------------------------

class El {
  constructor(tag, attributes = {}, text = "") {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.attributes = { ...attributes };
    this.id = attributes.id ?? "";
    this.ownText = text;
    this.children = [];
    this.parentElement = null;
    this.rect = { left: 0, top: 0, width: 100, height: 20 };
  }
  getAttribute(name) {
    return name in this.attributes ? String(this.attributes[name]) : null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
  }
  removeAttribute(name) {
    delete this.attributes[name];
    if (name === "id") this.id = "";
  }
  get textContent() {
    return this.children.reduce((out, child) => out + child.textContent, this.ownText);
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }
  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return { left, top, width, height };
  }
  querySelector(selector) {
    return query(this, selector)[0] ?? null;
  }
  querySelectorAll(selector) {
    return query(this, selector);
  }
}

function matches(element, selector) {
  if (selector === "*") return true;
  if (selector.startsWith("#")) return element.id === selector.slice(1);
  if (selector.startsWith("[")) {
    const found = /^\[([^=\]]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(selector);
    if (!found) return false;
    const value = element.getAttribute(found[1]);
    return found[2] === undefined ? value !== null : value === found[2];
  }
  if (/^[a-zA-Z][\w-]*$/.test(selector)) return element.tagName.toLowerCase() === selector.toLowerCase();
  return false;
}

function descendants(root) {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

function query(root, selector) {
  return [root, ...descendants(root)].filter((element) => matches(element, selector));
}

function makeDocument(tree) {
  const html = new El("html");
  const head = new El("head");
  const body = new El("body");
  html.append(head, body);
  tree(body);
  return {
    nodeType: 9,
    documentElement: html,
    body,
    querySelector: (selector) => query(html, selector)[0] ?? null,
    querySelectorAll: (selector) => query(html, selector),
  };
}

/** A PageBridge whose `evaluate` runs the expression in a vm context holding the shim. */
function createBridge(document, extras = {}) {
  const window = { scrollX: 0, scrollY: 0, ...extras };
  const sandbox = {
    window,
    document,
    CSS: { escape: (value) => String(value).replace(/[^A-Za-z0-9_-]/g, (char) => `\\${char}`) },
    console,
  };
  const context = vm.createContext(sandbox);
  return {
    window,
    document,
    client: {},
    target: { id: "1", url: "http://localhost:5173/settings", title: "settings", wsUrl: "ws://127.0.0.1:9222/x" },
    async evaluate(expression) {
      return vm.runInContext(expression, context, { filename: "nodepact-page.js" });
    },
    async close() {},
  };
}

/** The demo page: #submit sits 4px under the email input. */
function demoDocument() {
  return makeDocument((body) => {
    const main = new El("main");
    const form = new El("form", { id: "settings" });
    const email = new El("input", { id: "email", type: "email", placeholder: "请输入邮箱" });
    const actions = new El("div", { class: "actions" });
    const submit = new El("button", { id: "submit", type: "button" }, "提交");
    const reset = new El("button", { id: "reset", type: "button" }, "重置");
    submit.rect = { left: 431, top: 226.59375, width: 68, height: 46 };
    actions.append(submit, reset);
    form.append(email, actions);
    main.append(form);
    body.append(main);
  });
}

// -------------------------------------------------------------------------------------------
// Reading facts
// -------------------------------------------------------------------------------------------

test("reads selector, fingerprint, box and text in one round trip", async () => {
  const page = createBridge(demoDocument());
  const facts = await fingerprintNode(page, "#submit");

  assert.equal(facts.selector, "#submit");
  assert.equal(facts.tag, "button");
  assert.equal(facts.text, "提交");
  // self | nearest ancestors (max 3) | text hash
  assert.match(facts.fp, /^button#submit\[type=button\]\|div>form#settings>main\|t:[0-9a-f]{6}$/);
  // The box is the document-relative rect, stored next to the fingerprint instead of inside it.
  // Spread into a local object: the values come from the vm realm.
  assert.deepEqual({ ...facts.box }, { x: 431, y: 226.59375, w: 68, h: 46 });
  // The short id the CLI prints is the fingerprint hash, and it matches the recorded demo run.
  assert.equal(fingerprintHash(facts.fp), "99ceb4");
});

test("a generated id never reaches the fingerprint", async () => {
  const page = createBridge(
    makeDocument((body) => {
      body.append(new El("button", { id: "9f2c1a", type: "button" }, "提交"));
      body.append(new El("button", { id: "submit", type: "button" }, "提交"));
    }),
  );
  const generated = await fingerprintNode(page, "#9f2c1a");
  assert.match(selfSegment(generated.fp), /^button\[type=button\]$/, "a hex-looking id is dropped");

  const stable = await fingerprintNode(page, "#submit");
  assert.match(selfSegment(stable.fp), /^button#submit/);
});

test("throws when the selector matches nothing", async () => {
  const page = createBridge(demoDocument());
  await assert.rejects(() => fingerprintNode(page, "#nope"), /node not found in the page: #nope/);
});

// -------------------------------------------------------------------------------------------
// Re-location
// -------------------------------------------------------------------------------------------

test("the stored selector wins when it still points at the same node", async () => {
  const page = createBridge(demoDocument());
  const facts = await fingerprintNode(page, "#submit");
  const resolution = await resolveAnchor(page, { selector: "#submit", fp: facts.fp });
  assert.equal(resolution.matchedBy, "selector");
  assert.equal(resolution.score, 1);
  assert.equal(resolution.facts.selector, "#submit");
});

test("a stale selector falls back to the fingerprint", async () => {
  const page = createBridge(demoDocument());
  const facts = await fingerprintNode(page, "#submit");
  // The fix renamed the wrapper, so the stored selector no longer resolves; the fingerprint does.
  const resolution = await resolveAnchor(page, { selector: "#gone", fp: facts.fp });
  assert.ok(resolution, "the node is re-located by fingerprint");
  assert.equal(resolution.matchedBy, "fingerprint");
  assert.equal(resolution.facts.selector, "#submit");
  assert.ok(resolution.score > 0.6);
});

test("two candidates that score the same are refused, not guessed", async () => {
  const page = createBridge(
    makeDocument((body) => {
      const first = new El("div");
      const second = new El("div");
      first.append(new El("button", { type: "button" }, "提交"));
      second.append(new El("button", { type: "button" }, "提交"));
      body.append(first, second);
    }),
  );
  // Two buttons with the same tag, attributes, ancestors and text: no fingerprint can tell them
  // apart. Reading the first one installs the page runtime; the second is read directly.
  const first = await fingerprintNode(page, "button");
  page.window.__pick = page.document.querySelectorAll("button")[1];
  const fp = await page.evaluate("window.__nodepactAnchor.factsOfElement(window.__pick).fp");
  assert.equal(first.fp, fp, "both candidates carry the same fingerprint");

  assert.equal(await locateByFingerprint(page, fp), null, "ambiguous candidates must not be guessed");
  assert.equal(await resolveAnchor(page, { selector: "#gone", fp }), null);
});

test("a fingerprint that matches nothing resolves to null", async () => {
  const page = createBridge(demoDocument());
  assert.equal(await locateByFingerprint(page, "textarea[type=text]|div|t:000000"), null);
});

test("the minimum score is honoured", async () => {
  const page = createBridge(demoDocument());
  const facts = await fingerprintNode(page, "#submit");
  assert.ok(await locateByFingerprint(page, facts.fp, { minScore: 0.6 }));
  assert.equal(await locateByFingerprint(page, facts.fp, { minScore: 1.5 }), null);
});

// -------------------------------------------------------------------------------------------
// Pure helpers and drafting candidates
// -------------------------------------------------------------------------------------------

test("selfSegment and fingerprintHash are stable", () => {
  const fp = "button#submit[type=button]|div>form#settings>body|t:b6fc31";
  assert.equal(selfSegment(fp), "button#submit[type=button]");
  assert.match(fingerprintHash(fp), /^[0-9a-f]{6}$/);
  assert.equal(fingerprintHash(fp), fingerprintHash(fp));
  assert.notEqual(fingerprintHash(fp), fingerprintHash(`${fp}!`));
});

test("the anchor id prefers the node's own id and falls back to the fingerprint hash", () => {
  const withId = { fp: "button#submit[type=button]|div>form#settings|t:b6fc31" };
  assert.equal(anchorIdFromFacts(withId), "submit");

  const anonymous = { fp: "button[type=button]|div>body|t:abc123" };
  assert.equal(anchorIdFromFacts(anonymous), `n${fingerprintHash(anonymous.fp)}`);

  const punctuated = { fp: "button#a.b[type=button]|div|t:000000" };
  assert.equal(anchorIdFromFacts(punctuated), "a");
});

test("nearbySelectors offers the siblings a gap() assertion can name", async () => {
  const page = createBridge(demoDocument());
  const candidates = await nearbySelectors(page, "#submit");
  // Spread first: the array comes from the vm realm, so its own Array.prototype is not ours.
  assert.deepEqual([...candidates].map((candidate) => String(candidate.selector)), ["#reset"]);
  assert.equal(String(candidates[0].label), 'button#reset "重置"');
});