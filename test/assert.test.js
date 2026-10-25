/**
 * The assertion DSL: parse -> format -> evaluate, for all three kinds.
 *
 * The DSL text form is what the CLI takes, prints and asks the model for; the structured form is
 * what steer.yaml stores. Both are covered here, plus the evaluator against a fake page source so
 * the arithmetic (gap, style, changed) is pinned without a browser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AssertionSchema,
  AssertionSyntaxError,
  formatAssertion,
  formatRatio,
  gapBetween,
  measureAssertion,
  parseAssertion,
} from "../dist/oracle/assert.js";

/** A MeasureSource backed by two lookup tables, mirroring what src/cdp/snapshot.ts returns. */
function fakeSource({ rects = {}, styles = {} } = {}) {
  return {
    viewportRect: async (selector) => rects[selector] ?? null,
    computedStyle: async (selector, property) =>
      selector in styles ? (styles[selector][property] ?? "") : null,
  };
}

const box = (x, y, w, h) => ({ x, y, w, h });
const options = { node: "#submit", diffRatio: 0, epsilon: 0.01 };

test("parses every gap form", () => {
  assert.deepEqual(parseAssertion("gap(#email, #submit) >= 12px"), {
    kind: "gap",
    a: "#email",
    b: "#submit",
    op: ">=",
    px: 12,
  });
  assert.deepEqual(parseAssertion("gap(#a,#b)<=3.5px"), { kind: "gap", a: "#a", b: "#b", op: "<=", px: 3.5 });
  assert.deepEqual(parseAssertion("  GAP( #a , #b ) >= 8 px ; "), {
    kind: "gap",
    a: "#a",
    b: "#b",
    op: ">=",
    px: 8,
  });
});

test("gap keeps commas inside a functional pseudo-class", () => {
  const parsed = parseAssertion("gap(:is(.a, .b), #submit) >= 12px");
  assert.equal(parsed.kind, "gap");
  assert.equal(parsed.a, ":is(.a, .b)");
  assert.equal(parsed.b, "#submit");
});

test("parses style with and without quotes, in both operators", () => {
  assert.deepEqual(parseAssertion("style(display) == flex"), {
    kind: "style",
    prop: "display",
    op: "==",
    value: "flex",
  });
  assert.deepEqual(parseAssertion('style("font-size") != 14px'), {
    kind: "style",
    prop: "font-size",
    op: "!=",
    value: "14px",
  });
  assert.deepEqual(parseAssertion("style(color) == rgb(17, 24, 39)"), {
    kind: "style",
    prop: "color",
    op: "==",
    value: "rgb(17, 24, 39)",
  });
});

test("parses changed with or without parentheses", () => {
  assert.deepEqual(parseAssertion("changed"), { kind: "changed" });
  assert.deepEqual(parseAssertion("changed()"), { kind: "changed" });
  assert.deepEqual(parseAssertion("Changed"), { kind: "changed" });
});

test("rejects anything that is not one of the three kinds", () => {
  for (const text of [
    "gap(#email) >= 12px", // one selector
    "gap(#a, #b) > 12px", // unsupported operator
    "width(#a) == 12px",
    "style(display) = flex",
    "style() == flex",
    "changed(1)",
    "",
  ]) {
    assert.throws(() => parseAssertion(text), AssertionSyntaxError, `should reject: ${text}`);
  }
  // `px` is optional, so this one parses.
  assert.equal(parseAssertion("gap(#a, #b) >= 12").px, 12);
  // The error text lists the accepted forms, so a human can fix the line in place.
  assert.throws(() => parseAssertion("nope"), /gap\(<selectorA>, <selectorB>\) >= 12px/);
});

test("format is the inverse of parse", () => {
  const cases = [
    "gap(#email, #submit) >= 12px",
    "gap(#email, #submit) <= 12px",
    "style(display) == flex",
    "style(color) != rgb(17, 24, 39)",
    "changed",
  ];
  for (const text of cases) {
    assert.equal(formatAssertion(parseAssertion(text)), text);
  }
});

test("the schema validates the structured form stored in steer.yaml", () => {
  assert.equal(AssertionSchema.safeParse({ kind: "changed" }).success, true);
  assert.equal(
    AssertionSchema.safeParse({ kind: "gap", a: "#a", b: "#b", op: ">=", px: 12 }).success,
    true,
  );
  // negative distance, empty selector, unknown operator, unknown kind, extra keys
  assert.equal(AssertionSchema.safeParse({ kind: "gap", a: "#a", b: "#b", op: ">=", px: -1 }).success, false);
  assert.equal(AssertionSchema.safeParse({ kind: "gap", a: "", b: "#b", op: ">=", px: 1 }).success, false);
  assert.equal(AssertionSchema.safeParse({ kind: "gap", a: "#a", b: "#b", op: ">", px: 1 }).success, false);
  assert.equal(AssertionSchema.safeParse({ kind: "width", px: 1 }).success, false);
  assert.equal(AssertionSchema.safeParse({ kind: "changed", px: 1 }).success, false);
});

test("gapBetween measures edge to edge and prefers the vertical separation", () => {
  assert.equal(gapBetween(box(0, 0, 10, 10), box(0, 14, 10, 10)), 4); // stacked
  assert.equal(gapBetween(box(0, 0, 10, 10), box(20, 0, 10, 10)), 10); // side by side
  assert.equal(gapBetween(box(0, 0, 10, 10), box(5, 5, 10, 10)), 0); // overlapping
  assert.equal(gapBetween(box(0, 0, 10, 10), box(0, 10, 10, 10)), 0); // touching
});

test("evaluates gap against the live boxes", () => {
  const tooClose = fakeSource({ rects: { "#email": box(0, 0, 200, 40), "#submit": box(0, 44, 68, 46) } });
  const fixed = fakeSource({ rects: { "#email": box(0, 0, 200, 40), "#submit": box(0, 54, 68, 46) } });
  const assertion = parseAssertion("gap(#email, #submit) >= 12px");

  return Promise.all([
    measureAssertion(assertion, tooClose, options).then((measured) => {
      assert.equal(measured.actual, 4);
      assert.equal(measured.pass, false);
      assert.match(measured.detail, /gap 4px >= 12px -> fail/);
    }),
    measureAssertion(assertion, fixed, options).then((measured) => {
      assert.equal(measured.actual, 14);
      assert.equal(measured.pass, true);
      assert.match(measured.detail, /gap 14px >= 12px -> pass/);
    }),
  ]);
});

test("gap tolerates sub-pixel rounding but not a real miss", () => {
  const rounded = fakeSource({ rects: { "#a": box(0, 0, 10, 10), "#b": box(0, 21.999, 10, 10) } });
  const short = fakeSource({ rects: { "#a": box(0, 0, 10, 10), "#b": box(0, 21.9, 10, 10) } });
  const assertion = parseAssertion("gap(#a, #b) >= 12px");
  return Promise.all([
    measureAssertion(assertion, rounded, options).then((m) => assert.equal(m.pass, true)),
    measureAssertion(assertion, short, options).then((m) => {
      assert.equal(m.actual, 11.9);
      assert.equal(m.pass, false);
    }),
  ]);
});

test("gap rounds the measured value to two decimals", async () => {
  const source = fakeSource({ rects: { "#a": box(0, 0, 10, 10), "#b": box(0, 14.126, 10, 10) } });
  const measured = await measureAssertion(parseAssertion("gap(#a, #b) <= 20px"), source, options);
  assert.equal(measured.actual, 4.13);
});

test("gap reports a missing node instead of throwing", async () => {
  const source = fakeSource({ rects: { "#a": box(0, 0, 10, 10) } });
  const measured = await measureAssertion(parseAssertion("gap(#a, #gone) >= 12px"), source, options);
  assert.equal(measured.actual, null);
  assert.equal(measured.pass, false);
  assert.match(measured.detail, /#gone not found in the page/);
});

test("style reads the anchored node's computed value", async () => {
  const source = fakeSource({ styles: { "#submit": { display: "flex", color: "rgb(255, 255, 255)" } } });
  const equals = await measureAssertion(parseAssertion("style(display) == flex"), source, options);
  assert.equal(equals.actual, "flex");
  assert.equal(equals.pass, true);

  const notEquals = await measureAssertion(parseAssertion("style(display) != flex"), source, options);
  assert.equal(notEquals.pass, false);

  const color = await measureAssertion(parseAssertion("style(color) != rgb(0, 0, 0)"), source, options);
  assert.equal(color.actual, "rgb(255, 255, 255)");
  assert.equal(color.pass, true);
});

test("style explains an empty property and a missing node", async () => {
  const empty = await measureAssertion(
    parseAssertion("style(background-color) == red"),
    fakeSource({ styles: { "#submit": {} } }),
    options,
  );
  assert.equal(empty.pass, false);
  assert.match(empty.detail, /kebab-case/);

  const missing = await measureAssertion(
    parseAssertion("style(display) == flex"),
    fakeSource({ styles: {} }),
    options,
  );
  assert.equal(missing.actual, null);
  assert.match(missing.detail, /#submit not found in the page/);
});

test("changed compares the render diff against epsilon", async () => {
  const moved = await measureAssertion(parseAssertion("changed"), fakeSource(), {
    ...options,
    diffRatio: 0.0209,
  });
  assert.equal(moved.actual, 0.0209);
  assert.equal(moved.pass, true);

  const noise = await measureAssertion(parseAssertion("changed"), fakeSource(), {
    ...options,
    diffRatio: 0.005,
  });
  assert.equal(noise.pass, false);
  assert.match(noise.detail, /render diff 0.50% vs epsilon 1.00%/);
});

test("formatRatio prints a fraction as a percentage", () => {
  assert.equal(formatRatio(0.0209), "2.09%");
  assert.equal(formatRatio(0), "0.00%");
  assert.equal(formatRatio(0.01), "1.00%");
});
