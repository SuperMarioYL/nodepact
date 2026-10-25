/**
 * The assertion DSL and its evaluator.
 *
 * Three kinds, and nothing more (v0.1 does not reason about layout trees):
 *
 *   gap(<selectorA>, <selectorB>) >= 12px   distance between two nodes, in CSS pixels
 *   style(<property>) == flex               computed style of the anchored node
 *   changed()                               the node's render actually changed vs the baseline
 *
 * The evaluator is deterministic and model-free: it turns page measurements into a boolean and
 * the measured value that gets printed next to it, so a human can always tell a real fix from
 * noise.
 *
 * Geometry note: `gap` is the edge-to-edge distance between the two boxes, preferring the
 * vertical separation when the boxes are stacked (which is the "too close" case) and the
 * horizontal one when they sit side by side. Overlapping boxes give 0.
 */
import { z } from "zod";
import type { Box } from "../anchor/fingerprint.js";

export type GapAssertion = { kind: "gap"; a: string; b: string; op: ">=" | "<="; px: number };
export type StyleAssertion = { kind: "style"; prop: string; op: "==" | "!="; value: string };
export type ChangedAssertion = { kind: "changed" };
export type Assertion = GapAssertion | StyleAssertion | ChangedAssertion;

export const AssertionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("gap"),
      a: z.string().min(1),
      b: z.string().min(1),
      op: z.enum([">=", "<="]),
      px: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("style"),
      prop: z.string().min(1),
      op: z.enum(["==", "!="]),
      value: z.string(),
    })
    .strict(),
  z.object({ kind: z.literal("changed") }).strict(),
]);

/** Sub-pixel tolerance: layout values are rounded by the browser, `12px` must not fail as `11.999`. */
const PX_TOLERANCE = 0.005;

export class AssertionSyntaxError extends Error {
  constructor(text: string) {
    super(
      `cannot parse assertion: ${text}\n` +
        `expected one of:\n` +
        `  gap(<selectorA>, <selectorB>) >= 12px\n` +
        `  gap(<selectorA>, <selectorB>) <= 12px\n` +
        `  style(<css-property>) == <value>\n` +
        `  style(<css-property>) != <value>\n` +
        `  changed()`,
    );
    this.name = "AssertionSyntaxError";
  }
}

/** Split on `separator` at bracket depth 0, so `:is(a, b)` in a selector survives. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (const char of text) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    else if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim());
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/**
 * Parse the DSL text form used in `steer.yaml` and on the command line.
 * Throws {@link AssertionSyntaxError} for anything that is not one of the three kinds.
 */
export function parseAssertion(text: string): Assertion {
  const source = text.trim().replace(/;+$/, "").trim();

  if (/^changed\s*(\(\s*\))?$/i.test(source)) {
    return AssertionSchema.parse({ kind: "changed" });
  }

  const gap = /^gap\s*\((.*)\)\s*(>=|<=)\s*([0-9]*\.?[0-9]+)\s*(px)?$/i.exec(source);
  if (gap) {
    const selectors = splitTopLevel(gap[1] ?? "", ",");
    if (selectors.length !== 2 || !selectors[0] || !selectors[1]) throw new AssertionSyntaxError(text);
    return AssertionSchema.parse({
      kind: "gap",
      a: selectors[0],
      b: selectors[1],
      op: gap[2],
      px: Number(gap[3]),
    });
  }

  const style = /^style\s*\((.*)\)\s*(==|!=)\s*(.+)$/i.exec(source);
  if (style) {
    const prop = unquote(style[1] ?? "");
    if (!prop) throw new AssertionSyntaxError(text);
    return AssertionSchema.parse({
      kind: "style",
      prop,
      op: style[2],
      value: unquote(style[3] ?? ""),
    });
  }

  throw new AssertionSyntaxError(text);
}

export function formatAssertion(assertion: Assertion): string {
  switch (assertion.kind) {
    case "gap":
      return `gap(${assertion.a}, ${assertion.b}) ${assertion.op} ${assertion.px}px`;
    case "style":
      return `style(${assertion.prop}) ${assertion.op} ${assertion.value}`;
    case "changed":
      return "changed";
  }
}

export function formatRatio(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

/** The page side of an assertion: only what the evaluator actually needs to read. */
export type MeasureSource = {
  /** Box in viewport coordinates (`getBoundingClientRect`), used for gap arithmetic. */
  viewportRect(selector: string): Promise<Box | null>;
  computedStyle(selector: string, property: string): Promise<string | null>;
};

export type MeasureOptions = {
  /** The anchored node's selector, the implicit subject of `style()` and `changed()`. */
  node: string;
  /** Render diff ratio of baseline vs now, the measured value of `changed()`. */
  diffRatio: number;
  epsilon: number;
};

export type Measured = {
  actual: number | string | null;
  pass: boolean;
  detail: string;
};

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Edge-to-edge distance between two boxes; 0 when they overlap. */
export function gapBetween(a: Box, b: Box): number {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  return dy > 0 ? dy : dx;
}

/** Evaluate one assertion against the live page. Never throws for a missing node. */
export async function measureAssertion(
  assertion: Assertion,
  source: MeasureSource,
  options: MeasureOptions,
): Promise<Measured> {
  switch (assertion.kind) {
    case "gap": {
      const [boxA, boxB] = await Promise.all([
        source.viewportRect(assertion.a),
        source.viewportRect(assertion.b),
      ]);
      if (!boxA || !boxB) {
        const missing = boxA ? assertion.b : assertion.a;
        return {
          actual: null,
          pass: false,
          detail: `${missing} not found in the page, so the gap cannot be measured`,
        };
      }
      const gap = round(gapBetween(boxA, boxB), 2);
      const pass =
        assertion.op === ">=" ? gap >= assertion.px - PX_TOLERANCE : gap <= assertion.px + PX_TOLERANCE;
      return {
        actual: gap,
        pass,
        detail: `gap ${gap}px ${assertion.op} ${assertion.px}px -> ${pass ? "pass" : "fail"}`,
      };
    }
    case "style": {
      const value = await source.computedStyle(options.node, assertion.prop);
      if (value === null) {
        return {
          actual: null,
          pass: false,
          detail: `${options.node} not found in the page, so ${assertion.prop} cannot be read`,
        };
      }
      if (value === "") {
        return {
          actual: value,
          pass: false,
          detail: `computed style ${assertion.prop} is empty; use the CSS name (kebab-case)`,
        };
      }
      const equal = value === assertion.value;
      const pass = assertion.op === "==" ? equal : !equal;
      return {
        actual: value,
        pass,
        detail: `${assertion.prop} = ${value} ${assertion.op} ${assertion.value} -> ${pass ? "pass" : "fail"}`,
      };
    }
    case "changed": {
      const actual = round(options.diffRatio, 4);
      const pass = options.diffRatio >= options.epsilon;
      return {
        actual,
        pass,
        detail: `render diff ${formatRatio(options.diffRatio)} vs epsilon ${formatRatio(options.epsilon)} -> ${pass ? "pass" : "fail"}`,
      };
    }
  }
}
