/**
 * Drafting an assertion from a Chinese annotation, with a domestic model over an
 * OpenAI-compatible endpoint (DeepSeek / Qwen / GLM / Kimi).
 *
 * This module is offline-optional by construction: it is imported only by `nodepact annotate`,
 * the draft is only a suggestion the human confirms or rewrites, and nothing in the verdict path
 * (`check`) can reach it. Removing the endpoint, the key or the whole file leaves PASS/FAIL
 * identical — the oracle is the assertion plus the render diff, never the model.
 *
 * The model's chain of thought is read from `reasoning_content` (the official field) with
 * `reasoning` as the alias used by vLLM-served endpoints, and is never used for anything but
 * showing the human why the draft looks the way it does.
 */
import type { Box } from "../anchor/fingerprint.js";
import type { Config } from "../anchor/store.js";
import { formatAssertion, parseAssertion } from "../oracle/assert.js";

export type DraftCandidate = { selector: string; label: string };

export type DraftInput = {
  annotation: string;
  anchor: { selector: string; tag: string; text: string; box: Box };
  candidates: DraftCandidate[];
  config: Config;
};

export type DraftOutcome = {
  /** The draft in canonical DSL form, or `null` when the model's answer did not parse. */
  assertion: string | null;
  /** The model's answer, verbatim. */
  raw: string;
  reasoning: string | null;
  provider: string;
  model: string;
  base_url: string;
  error: string | null;
};

export type ProviderStatus = {
  ready: boolean;
  reason: string;
  provider: string;
  model: string;
  base_url: string;
};

const SYSTEM_PROMPT = [
  "你是 UI 验收断言起草器。开发者对着页面上一个节点写了一句中文批注，你要把它起草成一条机器可判定的断言。",
  "",
  "只能输出下面三种形式之一，一行，不要解释、不要 Markdown、不要代码块：",
  "1) gap(<选择器A>, <选择器B>) >= <数字>px",
  "2) style(<CSS属性名>) == <值>",
  "3) changed()",
  "",
  "规则：",
  "- 选择器必须是候选列表里出现过的真实选择器，或锚点自身的选择器。",
  "- 批注说的是两个元素的距离、太近、太挤、太贴 → 用 gap，另一个选择器是批注里提到的那一个元素。",
  "- 批注说的是颜色、字号、粗细、显示方式这类外观 → 用 style，属性名写小写 CSS 名（color、font-size、display 等）。",
  "- 说不清，或者只是“这个节点应该改一下” → 输出 changed()。",
  "- 只输出断言本身。",
].join("\n");

type ChatMessage = {
  content?: string | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
};

type ChatResponse = {
  choices?: Array<{ message?: ChatMessage }>;
  error?: { message?: string; type?: string };
};

/** The CoT field: official `reasoning_content`, `reasoning` for vLLM-served endpoints. */
export function pickReasoning(message: ChatMessage | undefined): string | null {
  if (!message) return null;
  return message.reasoning_content ?? message.reasoning ?? null;
}

/** Resolve the configured provider and whether a draft call can actually be made. */
export function providerStatus(config: Config): ProviderStatus {
  const provider = config.model.provider;
  const settings = config.providers[provider];
  if (!settings) {
    return {
      ready: false,
      reason: `provider "${provider}" is not defined under providers: in nodepact.yaml`,
      provider,
      model: "",
      base_url: "",
    };
  }
  if (!settings.base_url) {
    return {
      ready: false,
      reason: `provider "${provider}" has no base_url in nodepact.yaml`,
      provider,
      model: settings.model,
      base_url: "",
    };
  }
  if (!process.env[settings.api_key_env]) {
    return {
      ready: false,
      reason: `no API key in ${settings.api_key_env}`,
      provider,
      model: settings.model,
      base_url: settings.base_url,
    };
  }
  return { ready: true, reason: "", provider, model: settings.model, base_url: settings.base_url };
}

/**
 * Pull the first line of the model's answer that parses as one of the three assertion forms,
 * and return it in canonical form. Returns `null` when nothing parses — the caller then asks
 * the human for the assertion instead of failing.
 */
export function extractAssertion(content: string): string | null {
  for (const rawLine of content.replace(/```[a-z]*/gi, "\n").split("\n")) {
    const line = rawLine.trim().replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "");
    if (!line) continue;
    try {
      return formatAssertion(parseAssertion(line));
    } catch {
      continue;
    }
  }
  return null;
}

function buildUserMessage(input: DraftInput): string {
  const lines = [
    `锚点: ${input.anchor.selector} (${input.anchor.tag})` +
      (input.anchor.text ? ` 文字: "${input.anchor.text.slice(0, 40)}"` : ""),
    `锚点尺寸: ${Math.round(input.anchor.box.w)}x${Math.round(input.anchor.box.h)}`,
    `批注: ${input.annotation}`,
  ];
  if (input.candidates.length > 0) {
    lines.push("候选节点:");
    for (const candidate of input.candidates) lines.push(`  ${candidate.selector}  ${candidate.label}`);
  }
  return lines.join("\n");
}

/**
 * Ask the configured provider for one assertion draft.
 *
 * Transport failures, missing keys and unparsable answers all come back as `error` /
 * `assertion: null`; this function never throws, so a broken endpoint can never stop a run.
 */
export async function draftAssertion(input: DraftInput): Promise<DraftOutcome> {
  const status = providerStatus(input.config);
  const base = {
    provider: status.provider,
    model: status.model,
    base_url: status.base_url,
  };
  if (!status.ready) {
    return { ...base, assertion: null, raw: "", reasoning: null, error: status.reason };
  }

  const url = `${status.base_url.replace(/\/+$/, "")}/chat/completions`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env[input.config.providers[status.provider]!.api_key_env]}`,
      },
      body: JSON.stringify({
        model: status.model,
        temperature: 0,
        max_tokens: 256,
        stream: false,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserMessage(input) },
        ],
      }),
      signal: AbortSignal.timeout(input.config.model.timeout_ms),
    });
  } catch (error) {
    return { ...base, assertion: null, raw: "", reasoning: null, error: `request failed: ${(error as Error).message}` };
  }

  let payload: ChatResponse;
  try {
    payload = (await response.json()) as ChatResponse;
  } catch (error) {
    return {
      ...base,
      assertion: null,
      raw: "",
      reasoning: null,
      error: `HTTP ${response.status} with an unreadable body: ${(error as Error).message}`,
    };
  }

  if (!response.ok) {
    return {
      ...base,
      assertion: null,
      raw: "",
      reasoning: null,
      error: `HTTP ${response.status}: ${payload.error?.message ?? "no error message"}`,
    };
  }

  const message = payload.choices?.[0]?.message;
  const raw = (message?.content ?? "").trim();
  const reasoning = pickReasoning(message);
  if (!raw) {
    return { ...base, assertion: null, raw, reasoning, error: "the model returned an empty answer" };
  }
  const assertion = extractAssertion(raw);
  return {
    ...base,
    assertion,
    raw,
    reasoning,
    error: assertion ? null : `model answer did not parse as an assertion: ${raw.split("\n")[0] ?? ""}`,
  };
}
