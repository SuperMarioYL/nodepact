# Changelog

All notable changes to Nodepact are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-26

The first release: the element-anchored steering pair, end to end. A human points at a node and
writes one annotation; `check` returns the node's before/after render diff and a verdict, and the
verdict path contains no model.

### Added

**m1 — anchor and check**

- `nodepact init` attaches to the Chrome the developer already has open, over CDP
  (`--remote-debugging-port`), and creates `nodepact.yaml` plus `.nodepact/`.
- `nodepact annotate` injects a plain-JS overlay, records the clicked node, and stores an anchor:
  a CSS selector, a structural fingerprint (tag + stable attributes + nearest ancestor chain +
  text hash), the node's box, and a baseline crop captured through `Page.captureScreenshot`.
- `nodepact check` re-locates the anchor, captures the node again, diffs the two crops with
  pixelmatch, evaluates the assertion, and returns `PASS`/`FAIL` with the measured value, the
  changed pixel count and the diff PNG.
- The crop is widened by `oracle.capture_margin` (16px by default) around the node: a crop tight to
  the node travels with it, so a fix that only *moves* the node would show a zero pixel diff.
- `nodepact label` lists the stored anchors, or replaces the annotation on one of them.

**m2 — assertion and draft**

- The assertion DSL: `gap(<selectorA>, <selectorB>) >= 12px`, `style(<property>) == <value>` and
  `changed()`, validated with zod and evaluated deterministically in `src/oracle/assert.ts`.
- `steer.yaml` stores the assertion as a structured block (`kind`/`a`/`b`/`op`/`px`) instead of one
  line of DSL text, because YAML ends a plain scalar at `" #"` and
  `assertion: gap(#email, #submit) >= 12px` would silently parse as `gap(#email,`.
- `annotate` drafts an assertion from the Chinese annotation with a domestic model over an
  OpenAI-compatible endpoint (DeepSeek / Qwen / GLM / Kimi, configured in `nodepact.yaml`). The
  draft is a suggestion the human confirms or rewrites; with no key or no network the assertion is
  typed by hand and `check` behaves identically.
- `nodepact.yaml` holds the CDP target, the oracle thresholds and the provider table; `init`
  persists the chosen URL prefix and port without rewriting hand-written comments.

**m3 — MCP and verdict**

- `nodepact mcp` serves the stdio MCP server with `nodepact.check` and `nodepact.list`, so a coding
  agent can call `check` itself and read the verdict JSON with the artifact paths.
- The verdict is `DONE` when the assertion holds *and* the render diff clears `oracle.epsilon`,
  `NOT_DONE` otherwise, and `UNSTABLE` when two back-to-back captures of the unchanged node differ
  by more than `oracle.stability_floor` — an honest "cannot tell" instead of a false `DONE`.
- `docs/demo.cast` records the ten-minute path: `init`, `annotate`, `check` returning `NOT_DONE` at
  a 4px gap, the one-line CSS fix, `check` returning `DONE`.

### Notes

- v0.1 attaches to Chromium only, only judges (it never edits the DOM or the code), and has no CI
  or headless mode: it screenshots the developer's own browser.
- The recorded run in `docs/demo-results.json` (anchor fp `99ceb4`, baseline 68x46, gap 4px -> 14px,
  165 changed pixels of 7900, ratio 0.0209, epsilon 0.01) is the source for the numbers quoted in
  the README.
