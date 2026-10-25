/**
 * Anchor fingerprints.
 *
 * A steering pair must survive the DOM drift that a fix introduces, so an anchor is not just
 * a CSS selector. It carries a structural fingerprint: the node's own tag + stable attributes,
 * its nearest ancestor chain, and a hash of its text. When the stored selector no longer
 * resolves to the same node, `resolveAnchor` re-locates the node by scoring every candidate
 * against that fingerprint, and refuses to guess when two candidates score the same.
 *
 * Fingerprint grammar (one line, kept small on purpose so it stays readable in steer.yaml):
 *
 *   fp := <self> "|" <ancestors> "|" "t:" <text-hash>
 *   self      := tag ("#" id)? ("[" attr "=" value "]")*
 *   ancestors := segment (">" segment)*        nearest ancestor first, at most 3
 *   text-hash := 6 hex chars of FNV-1a over the node's whitespace-normalised text
 *
 * Example: `button#submit[type=submit]|div.actions>form#settings|t:9f2c1a`
 *
 * Geometry is deliberately *not* part of the fingerprint: the whole point is to detect that
 * the node moved or resized, so its box is stored next to the fingerprint instead of inside it.
 */
import { createHash } from "node:crypto";
import type { PageBridge } from "../cdp/attach.js";

/** Page geometry in CSS pixels. `x`/`y` are document coordinates (scroll included). */
export type Box = { x: number; y: number; w: number; h: number };

/** Everything read off one DOM node in a single round trip. */
export type NodeFacts = {
  selector: string;
  fp: string;
  fp_hash: string;
  box: Box;
  tag: string;
  text: string;
};

export type AnchorLookup = { selector: string; fp: string };

export type AnchorResolution = {
  facts: NodeFacts;
  matchedBy: "selector" | "fingerprint";
  score: number;
};

const MIN_SCORE = 0.6;

/**
 * The in-page half of the fingerprint algorithm. Installed once per page as
 * `window.__nodepactAnchor` so the scoring code exists in exactly one place.
 */
const PAGE_RUNTIME_JS = `(function () {
  if (window.__nodepactAnchor) return "ready";
  var STABLE_ATTRS = ["role", "type", "name", "aria-label", "data-testid", "data-test", "placeholder", "alt", "title"];
  var MAX_CHAIN = 3;
  var MAX_TEXT = 80;
  var MAX_ATTR_VALUE = 24;
  var HASH_SEED = 0x811c9dc5;
  var HASH_PRIME = 0x01000193;

  function fnv1a(str) {
    var h = HASH_SEED;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, HASH_PRIME) >>> 0;
    }
    return h >>> 0;
  }
  function hex6(n) {
    return ("000000" + n.toString(16)).slice(-6);
  }
  function norm(str) {
    return (str || "").replace(/\\s+/g, " ").trim();
  }
  function textHashOf(el) {
    return hex6(fnv1a(norm(el.textContent).slice(0, MAX_TEXT)));
  }
  /* Ids and attributes that look generated (uuids, counters, content hashes) must not become
     part of the fingerprint, otherwise the anchor dies with the next render. */
  function dynamic(value) {
    if (!value) return true;
    if (value.length > 40) return true;
    if (/^[0-9]/.test(value)) return true;
    if (/^[0-9a-f]{6,}$/i.test(value)) return true;
    return false;
  }
  function stableId(el) {
    return el.id && !dynamic(el.id) ? el.id : "";
  }
  function segment(el) {
    var out = el.tagName.toLowerCase();
    var id = stableId(el);
    if (id) out += "#" + id;
    for (var i = 0; i < STABLE_ATTRS.length; i++) {
      var name = STABLE_ATTRS[i];
      var value = el.getAttribute ? el.getAttribute(name) : null;
      if (value && !dynamic(value)) out += "[" + name + "=" + norm(value).slice(0, MAX_ATTR_VALUE) + "]";
    }
    return out;
  }
  function ancestors(el) {
    var out = [];
    var cur = el.parentElement;
    while (cur && cur.tagName && cur.tagName.toLowerCase() !== "html" && out.length < MAX_CHAIN) {
      out.push(segment(cur));
      cur = cur.parentElement;
    }
    return out;
  }
  function cssPath(el) {
    var id = stableId(el);
    if (id) return "#" + CSS.escape(id);
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && depth < 5) {
      var step = cur.tagName.toLowerCase();
      var curId = stableId(cur);
      if (curId) {
        parts.unshift("#" + CSS.escape(curId));
        break;
      }
      var parent = cur.parentElement;
      if (parent) {
        var same = 0;
        var index = 0;
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i].tagName === cur.tagName) {
            same++;
            if (parent.children[i] === cur) index = same;
          }
        }
        if (same > 1) step += ":nth-of-type(" + index + ")";
      }
      parts.unshift(step);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(" > ");
  }
  function boxOf(el) {
    var rect = el.getBoundingClientRect();
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      w: rect.width,
      h: rect.height
    };
  }
  function factsOfElement(el) {
    var text = norm(el.textContent).slice(0, MAX_TEXT);
    return {
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      selector: cssPath(el),
      fp: segment(el) + "|" + ancestors(el).join(">") + "|t:" + textHashOf(el),
      box: boxOf(el),
      text: text
    };
  }
  function factsOf(selector) {
    var el = document.querySelector(selector);
    return el ? factsOfElement(el) : null;
  }
  function tokens(seg) {
    var tagMatch = /^([a-z0-9-]+)/.exec(seg);
    var idMatch = /#([^\\[\\]]*)/.exec(seg);
    var attrs = [];
    var attrRe = /\\[([^\\]]+)\\]/g;
    var match;
    while ((match = attrRe.exec(seg))) attrs.push(match[1]);
    return { tag: tagMatch ? tagMatch[1] : "", id: idMatch ? idMatch[1] : "", attrs: attrs };
  }
  function parseFp(fp) {
    var parts = String(fp).split("|");
    return {
      self: parts[0] || "",
      chain: (parts[1] || "").split(">").filter(function (s) { return !!s; }),
      text: (parts[2] || "").replace(/^t:/, "")
    };
  }
  function scoreOf(el, want) {
    var candidate = tokens(segment(el));
    var target = tokens(want.self);
    if (!target.tag || target.tag !== candidate.tag) return 0;
    var max = 0.3;
    var got = 0.3;
    if (target.id) {
      max += 0.4;
      if (target.id === candidate.id) got += 0.4;
    }
    if (target.attrs.length) {
      max += 0.2;
      var hits = 0;
      for (var i = 0; i < target.attrs.length; i++) {
        if (candidate.attrs.indexOf(target.attrs[i]) >= 0) hits++;
      }
      got += 0.2 * (hits / target.attrs.length);
    }
    if (want.chain.length) {
      max += 0.3;
      var have = ancestors(el);
      var chainHits = 0;
      for (var j = 0; j < want.chain.length; j++) {
        if (have.indexOf(want.chain[j]) >= 0) chainHits++;
      }
      got += 0.3 * (chainHits / want.chain.length);
    }
    if (want.text) {
      max += 0.2;
      if (textHashOf(el) === want.text) got += 0.2;
    }
    return max > 0 ? got / max : 0;
  }
  function locate(fp, minScore) {
    var want = parseFp(fp);
    var all = document.querySelectorAll("*");
    var best = null;
    var runnerUp = 0;
    for (var i = 0; i < all.length; i++) {
      var score = scoreOf(all[i], want);
      if (score <= 0) continue;
      if (!best || score > best.score) {
        runnerUp = best ? best.score : 0;
        best = { score: score, el: all[i] };
      } else if (score > runnerUp) {
        runnerUp = score;
      }
    }
    if (!best || best.score < minScore) return null;
    return {
      score: best.score,
      ambiguous: runnerUp > 0 && best.score - runnerUp < 0.1,
      facts: factsOfElement(best.el)
    };
  }
  function labelOf(el) {
    var text = norm(el.textContent).slice(0, 40);
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (text ? ' "' + text + '"' : "");
  }
  /* Selector candidates the assertion drafter may reference from a gap() assertion: the
     anchor's siblings first (the usual partner node), then any id-bearing node in the same
     container. */
  function nearby(selector, limit) {
    var el = document.querySelector(selector);
    if (!el) return [];
    var scope = el.parentElement || document.body;
    var out = [];
    var seen = {};
    function add(node) {
      if (!node || node.nodeType !== 1 || node === el) return;
      var sel = cssPath(node);
      if (seen[sel]) return;
      seen[sel] = true;
      out.push({ selector: sel, label: labelOf(node) });
    }
    for (var i = 0; i < scope.children.length && out.length < limit; i++) add(scope.children[i]);
    var withId = scope.querySelectorAll("[id]");
    for (var j = 0; j < withId.length && out.length < limit; j++) add(withId[j]);
    return out.slice(0, limit);
  }

  window.__nodepactAnchor = {
    factsOf: factsOf,
    factsOfElement: factsOfElement,
    locate: locate,
    nearby: nearby
  };
  return "installed";
})()`;

export function selfSegment(fp: string): string {
  return fp.split("|")[0] ?? "";
}

/** Short display id for a fingerprint (`node fp 4a91c2` in the CLI output). */
export function fingerprintHash(fp: string): string {
  return createHash("sha256").update(fp).digest("hex").slice(0, 6);
}

/**
 * Filesystem-safe anchor id, used as the key in steer.yaml and as the artifact file stem:
 * the node's own id when it has a stable one (`#submit` -> `submit`), otherwise `n<fp hash>`.
 */
export function anchorIdFromFacts(facts: NodeFacts): string {
  const id = /^[a-z0-9-]+#([A-Za-z0-9_-]+)/.exec(selfSegment(facts.fp))?.[1];
  return (id ?? `n${fingerprintHash(facts.fp)}`).replace(/[^A-Za-z0-9_-]/g, "-");
}

async function ensureRuntime(page: PageBridge): Promise<void> {
  await page.evaluate<string>(PAGE_RUNTIME_JS);
}

async function readFacts(page: PageBridge, selector: string): Promise<NodeFacts | null> {
  return page.evaluate<NodeFacts | null>(
    `window.__nodepactAnchor.factsOf(${JSON.stringify(selector)})`,
  );
}

/** Read selector, fingerprint, geometry and text of one node in a single round trip. */
export async function fingerprintNode(page: PageBridge, selector: string): Promise<NodeFacts> {
  await ensureRuntime(page);
  const facts = await readFacts(page, selector);
  if (!facts) throw new Error(`node not found in the page: ${selector}`);
  return facts;
}

/**
 * Re-locate a node from its fingerprint alone.
 *
 * Returns `null` when nothing scores high enough, or when the best two candidates are within
 * 0.1 of each other (the page-side margin): an ambiguous anchor is reported as a failure rather
 * than checked against a guessed node.
 */
export async function locateByFingerprint(
  page: PageBridge,
  fp: string,
  options: { minScore?: number } = {},
): Promise<{ facts: NodeFacts; score: number } | null> {
  await ensureRuntime(page);
  const found = await page.evaluate<{ score: number; ambiguous: boolean; facts: NodeFacts } | null>(
    `window.__nodepactAnchor.locate(${JSON.stringify(fp)}, ${options.minScore ?? MIN_SCORE})`,
  );
  if (!found || found.ambiguous) return null;
  return { facts: found.facts, score: found.score };
}

/**
 * Resolve a stored anchor against the live page.
 *
 * The stored selector wins when it still points at the same node (cheap and exact); otherwise
 * the fingerprint search decides. `null` means the node could not be found unambiguously.
 */
export async function resolveAnchor(
  page: PageBridge,
  anchor: AnchorLookup,
): Promise<AnchorResolution | null> {
  await ensureRuntime(page);
  const direct = await readFacts(page, anchor.selector);
  if (direct && selfSegment(direct.fp) === selfSegment(anchor.fp)) {
    return { facts: direct, matchedBy: "selector", score: 1 };
  }
  const located = await locateByFingerprint(page, anchor.fp);
  if (!located) return null;
  return { facts: located.facts, matchedBy: "fingerprint", score: located.score };
}

/** Selector candidates around a node, used to draft a `gap()` assertion. */
export async function nearbySelectors(
  page: PageBridge,
  selector: string,
  limit = 8,
): Promise<Array<{ selector: string; label: string }>> {
  await ensureRuntime(page);
  return page.evaluate<Array<{ selector: string; label: string }>>(
    `window.__nodepactAnchor.nearby(${JSON.stringify(selector)}, ${limit})`,
  );
}
