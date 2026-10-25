/**
 * The verdict: DONE / NOT_DONE / UNSTABLE, including the stability floor that makes UNSTABLE
 * possible and the precedence it has over everything else.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideVerdict } from "../dist/oracle/verdict.js";

const base = {
  assertionPass: true,
  assertionDetail: "gap 14px >= 12px -> pass",
  diffRatio: 0.0209,
  noiseRatio: 0,
  epsilon: 0.01,
  stabilityFloor: 0.01,
};

test("DONE needs both the assertion and a render change", () => {
  const decision = decideVerdict(base);
  assert.equal(decision.verdict, "DONE");
  assert.match(decision.reason, /changed by 2.09%/);
  assert.match(decision.reason, /epsilon 1.00%/);
});

test("a failing assertion is NOT_DONE and says which assertion failed", () => {
  const decision = decideVerdict({ ...base, assertionPass: false, assertionDetail: "gap 4px >= 12px -> fail" });
  assert.equal(decision.verdict, "NOT_DONE");
  assert.match(decision.reason, /gap 4px >= 12px -> fail/);
});

test("an assertion that holds but did not move the node is still NOT_DONE", () => {
  const decision = decideVerdict({ ...base, diffRatio: 0.005 });
  assert.equal(decision.verdict, "NOT_DONE");
  assert.match(decision.reason, /assertion holds but the node did not change/);
  assert.match(decision.reason, /0.50%/);
});

test("noise above the stability floor is UNSTABLE, whatever the assertion says", () => {
  const noisy = decideVerdict({ ...base, noiseRatio: 0.02 });
  assert.equal(noisy.verdict, "UNSTABLE");
  assert.match(noisy.reason, /re-render noise 2.00% exceeds the stability floor 1.00%/);

  const noisyAndFailing = decideVerdict({ ...base, noiseRatio: 0.5, assertionPass: false });
  assert.equal(noisyAndFailing.verdict, "UNSTABLE");
});

test("the stability floor and epsilon are inclusive boundaries", () => {
  // noise == floor is still usable.
  assert.equal(decideVerdict({ ...base, noiseRatio: 0.01 }).verdict, "DONE");
  // diff == epsilon counts as changed.
  assert.equal(decideVerdict({ ...base, diffRatio: 0.01 }).verdict, "DONE");
  assert.equal(decideVerdict({ ...base, diffRatio: 0.0099 }).verdict, "NOT_DONE");
});

test("the verdict carries no model: the same input always yields the same answer", () => {
  const first = decideVerdict(base);
  const second = decideVerdict({ ...base });
  assert.deepEqual(first, second);
});
