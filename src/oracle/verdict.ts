/**
 * The verdict: a deterministic function with no model anywhere on the path.
 *
 *   DONE     ⟺ the assertion holds now ∧ the node's render really changed (diff ≥ ε)
 *   UNSTABLE ⟺ the node re-renders differently from itself, so its pixels cannot be trusted
 *   NOT_DONE otherwise
 *
 * UNSTABLE exists because a noisy node (live timestamps, web fonts landing late, animations)
 * produces a pixel diff that cannot be separated from a real fix. Reporting UNSTABLE is the
 * honest answer there; calling it DONE would turn noise into acceptance.
 */
import { formatRatio } from "./assert.js";

export type Verdict = "DONE" | "NOT_DONE" | "UNSTABLE";

export type VerdictInput = {
  /** Result of the assertion evaluator. */
  assertionPass: boolean;
  assertionDetail: string;
  /** Render diff of baseline vs now. */
  diffRatio: number;
  /** Render diff of two back-to-back captures of the unchanged node. */
  noiseRatio: number;
  epsilon: number;
  stabilityFloor: number;
};

export type VerdictDecision = {
  verdict: Verdict;
  reason: string;
};

export function decideVerdict(input: VerdictInput): VerdictDecision {
  if (input.noiseRatio > input.stabilityFloor) {
    return {
      verdict: "UNSTABLE",
      reason:
        `node re-render noise ${formatRatio(input.noiseRatio)} exceeds the stability floor ` +
        `${formatRatio(input.stabilityFloor)}; the pixel diff cannot be separated from noise on this node`,
    };
  }
  if (!input.assertionPass) {
    return { verdict: "NOT_DONE", reason: `assertion does not hold: ${input.assertionDetail}` };
  }
  if (input.diffRatio < input.epsilon) {
    return {
      verdict: "NOT_DONE",
      reason:
        `assertion holds but the node did not change: render diff ${formatRatio(input.diffRatio)} ` +
        `is below epsilon ${formatRatio(input.epsilon)}`,
    };
  }
  return {
    verdict: "DONE",
    reason: `assertion holds and the node changed by ${formatRatio(input.diffRatio)} (≥ epsilon ${formatRatio(input.epsilon)})`,
  };
}
