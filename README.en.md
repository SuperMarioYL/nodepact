**English** | [简体中文](./README.md)

<div align="center">

[![npm version](https://img.shields.io/npm/v/nodepact.svg?label=npm&color=2563eb)](https://www.npmjs.com/package/nodepact)
[![node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-2563eb.svg)](./LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-CDP%20only-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/devtools/protocol)
[![MCP](https://img.shields.io/badge/MCP-nodepact.check%20%2F%20nodepact.list-7c3aed)](https://modelcontextprotocol.io)
[![verdict](https://img.shields.io/badge/verdict-no%20model%20in%20the%20path-16a34a)](./src/oracle/verdict.ts)
[![release](https://img.shields.io/github/v/release/SuperMarioYL/nodepact?label=release)](https://github.com/SuperMarioYL/nodepact/releases)

[![Typing SVG](https://readme-typing-svg.demolab.com?font=JetBrains+Mono&weight=600&size=22&duration=3200&pause=900&color=2563EB&center=true&vCenter=true&width=760&height=64&lines=The%20agent%20says%20it%20is%20done.;The%20node's%20render%20diff%20decides.;Point%20at%20a%20node%2C%20write%20one%20annotation;No%20model%20on%20the%20verdict%20path)](https://github.com/SuperMarioYL/nodepact)

# Nodepact

**The browser-side check that makes a node's render diff the agent's verdict.**

Point at a node in the Chrome you already have open, leave one sentence, and Nodepact turns it into
a decidable assertion. Every later `nodepact check` returns that node's **before/after render diff**
plus `PASS` / `FAIL`: `DONE` comes from the machine's diff, not from the agent's prose.

<sub>Element-anchored steering pairs · attaches to your own Chromium · no model on the verdict path · assertions and diff images stay local in <code>.nodepact/</code></sub>

</div>

---

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg> Why Nodepact

You point a coding agent at a rendered defect — a button hugging an input, wrong spacing, an off
colour. Today you have one way to express it: describe it in prose in the chat ("the submit button
on the settings page is too close to the input"), and then **look at the page again yourself** to
decide whether the agent got it right.

Two holes in that loop:

- **The correction is not bound to the element it is about.** The agent re-guesses which node you meant.
- **There is no acceptance signal a machine can read.** "I fixed the alignment" is itself the only
  evidence that the work is done.

So the human is both describer and verifier, and the loop never closes on its own.

Nodepact collapses those two into one primitive: the **element-anchored steering pair**.

- **Anchor** = a stable identity for that DOM node (CSS selector + structural fingerprint) plus a
  baseline crop of it, captured before the fix.
- **Assertion** = one decidable predicate: a distance between two nodes, a computed style, or
  "this node really changed".
- **Verdict** = `assertion holds ∧ render diff of that node ≥ ε`, with no model anywhere on the path.

So `check` hands you numbers you can audit instead of a claim: the measured value, the changed pixel
count, the diff PNG, and the verdict.

**Which half it fills.** *Delivering* an annotation to an agent is already a crowded half (Vite
plugins such as spotnote, "make the agent verify itself" approaches such as reticle); Nodepact does
not repeat it. It makes **the render diff of the node you pointed at** the acceptance signal. The
inspection surface is the same CDP layer `chrome-devtools-mcp` uses to let an agent read the DOM and
screenshot it — Nodepact talks to it directly with `chrome-remote-interface`, with no layer in between.

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7l5 5l-5 5"/><line x1="12" y1="19" x2="19" y2="19"/></svg> Quickstart (10 minutes)

You need Node 22+ and one restart of Chrome.

### 1. Install

```bash
# Option A: install the release tarball (available once the first tag is pushed)
npm i -g https://github.com/SuperMarioYL/nodepact/releases/latest/download/nodepact.tgz

# Option B: from source (always works)
git clone https://github.com/SuperMarioYL/nodepact.git && cd nodepact
npm ci && npm run build
npm link          # now `nodepact` is on your PATH
```

Once the package is published to the npm registry, `npm i -g nodepact` and `npx nodepact` are the
short forms of the same path. Nodepact downloads no browser: it attaches to the one you have open.

### 2. Let Chrome listen on the debugging port

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
# Linux
google-chrome --remote-debugging-port=9222
```

### 3. Start the example page (this is the input)

The repository ships a settings page that is deliberately wrong: the submit button sits 4px under
the email input.

```bash
python3 -m http.server 5173 --directory examples/demo-app
# open http://localhost:5173
```

The source is [`examples/demo-app/index.html`](./examples/demo-app/index.html); one line of CSS is
all it takes to flip the verdict.

### 4. Attach, pick a node, write the annotation

```console
$ nodepact init --url http://localhost:5173
attached to Chrome via CDP  ws://127.0.0.1:9222/devtools/page/4C2E9A7B...   page: /
config   nodepact.yaml
store    .nodepact/
next     nodepact annotate

$ nodepact annotate
click a node ...
picked #submit  fp 99ceb4
annotation (zh): 提交按钮和上面的邮箱输入框太近了
draft assertion: gap(#email, #submit) >= 12px      [y / edit / n]
accept? y
saved to .nodepact/steer.yaml   (node fp 99ceb4, baseline 68x46)
next: nodepact check
```

An overlay appears in the bottom-right of the page: click the node, write what is wrong (Chinese is
fine), press Enter. If you configured a model endpoint, `annotate` drafts the assertion from that
sentence for you to confirm; without one, you type the assertion by hand.

### 5. Change one line of CSS, reload the page, watch it flip

```bash
# examples/demo-app/index.html
#   #email { margin-bottom: 4px; }  ->  #email { margin-bottom: 14px; }

# Then reload the page. `check` reads the page currently open in your Chrome:
# python3 -m http.server has no HMR, so the file edit alone leaves the old page in place —
# press Cmd-R (F5) in Chrome to reload it. A dev server with HMR (Vite, Next, ...) does this for you.
```

```console
$ nodepact check
#submit  gap(#email, #submit) >= 12px
  before 4  after 4  assertion FAIL
  render diff 0px (0.00%)  noise 0.00%  epsilon 1.00%
  artifact .nodepact/diffs/submit.after.png
  verdict NOT_DONE  assertion does not hold: gap 4px >= 12px -> fail

# ...after the CSS fix, and after reloading the page in Chrome (Cmd-R / F5).
# Without the reload the second check is still NOT_DONE...

$ nodepact check
#submit  gap(#email, #submit) >= 12px
  before 4  after 14  assertion PASS
  render diff 165px (2.09%)  noise 0.00%  epsilon 1.00%
  artifact .nodepact/diffs/submit.after.png
  verdict DONE  assertion holds and the node changed by 2.09% (≥ epsilon 1.00%)
```

Exit codes: `0` for `DONE`, `1` for `NOT_DONE` / `UNSTABLE`, `2` when the anchor or the baseline is
broken. Drop it straight into a script.

### 6. Let the agent loop to DONE by itself

```bash
nodepact mcp --install     # prints the MCP client config snippet to paste into your agent
```

Once configured, your coding agent calls `nodepact.check` itself, reads `DONE` / `NOT_DONE` and the
artifact paths, and decides whether to keep going.

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16l13 -8z"/></svg> Demo

Full recording: [`docs/demo.cast`](./docs/demo.cast) (asciinema v2; replay with
`asciinema play docs/demo.cast`).

```console
$ nodepact init --url http://localhost:5173
attached to Chrome via CDP  ws://127.0.0.1:9222/devtools/page/4C2E9A7B...   page: /
$ nodepact annotate
picked #submit  fp 99ceb4
annotation (zh): 提交按钮和上面的邮箱输入框太近了
draft assertion: gap(#email, #submit) >= 12px      [y / edit / n]
accept? y
saved to .nodepact/steer.yaml   (node fp 99ceb4, baseline 68x46)
$ nodepact check --json
{ "verdict": "NOT_DONE", "before": 4, "after": 4,
  "render_diff": { "changed_px": 0, "total_px": 7900, "ratio": 0 } }
# the agent edits that one CSS line and reloads the page (no HMR on a static server: refresh;
# an HMR dev server does it itself), then calls check again:
$ nodepact check --json
{ "verdict": "DONE", "before": 4, "after": 14,
  "render_diff": { "changed_px": 165, "total_px": 7900, "ratio": 0.0209 } }
```

Every number in that run is recorded in [`docs/demo-results.json`](./docs/demo-results.json), and the
README only quotes it:

| Observed | Value |
| --- | --- |
| Anchor | `#submit`, fingerprint `99ceb4`, baseline `68x46` |
| Assertion | `gap(#email, #submit) >= 12px` |
| Measured before / after | `4px` -> `14px` |
| Render diff | `165px` of `7900px` = `ratio 0.0209` |
| Thresholds | `epsilon 0.01`, `stability_floor 0.01`, `capture_margin 16px` |
| Verdict | `NOT_DONE` -> `DONE` (exit code 0) |

Those numbers come from one real run at `capture_scale = 1` and `devicePixelRatio = 1`. A different
display scale changes the crop size, not the verdict: the verdict reads the measured value and the
changed fraction, never an absolute pixel count.

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M12 19h4.5a3.5 3.5 0 0 0 0 -7h-8a3.5 3.5 0 0 1 0 -7h3.5"/></svg> How it works

```
your Chrome (the dev server page)  <--- CDP (--remote-debugging-port=9222)
      |  ^
overlay.js |  | Page.captureScreenshot(clip = node box ± capture_margin)
      v  |      getBoundingClientRect / getComputedStyle
  nodepact CLI (node, one process)
    |- anchor/   fingerprint + store   -> .nodepact/steer.yaml + .nodepact/baseline/*.png
    |- oracle/   assert.eval + diff(pixelmatch) + verdict -> .nodepact/diffs/*.png
    |- annotate/ draft -> domestic models (OpenAI-compatible, drafts only, skippable offline)
    \- mcp/      server -> nodepact.check / nodepact.list  <-- coding agent
```

At most two processes: the Chrome you started, and the nodepact CLI / MCP process. No daemon, no
database, no cloud — every piece of state is a flat file under `.nodepact/`.

**The verdict is a pure function** ([`src/oracle/verdict.ts`](./src/oracle/verdict.ts)):

```
DONE     ⟺ assertion holds ∧ diff(baseline, now).ratio ≥ ε
NOT_DONE   everything else
UNSTABLE   two back-to-back captures of the unchanged node differ by more than stability_floor
```

No model is on that path, so the same code checked twice returns the same answer. **The anchor is not
just a selector either**: besides the CSS selector it carries a structural fingerprint (tag + stable
attributes + the nearest three ancestors + a text hash). After the DOM drifts, the selector may stop
resolving while the fingerprint still finds the node; if two candidates score the same, `check`
reports `anchor_not_found` instead of guessing.

### Stability is the core risk of this oracle, so it is stated out loud

Dynamic content, web fonts and antialiasing all make two screenshots of the same node differ. The
trade-offs Nodepact makes:

- geometry assertions (`gap` / `style`) are antialiasing-immune, and they are the primary signal;
- the pixel diff is corroboration that the node was really touched, with a per-node ε as a fraction
  of the crop, and `includeAA: false`;
- every `check` prints the measured value, ε and this run's noise together, so noise and a real fix
  can be told apart;
- when two back-to-back captures differ by more than `stability_floor`, it reports `UNSTABLE` rather
  than pretending `DONE`;
- the crop extends `capture_margin` (16px by default) around the node: a crop tight to the node
  travels with it, so a fix that only *moves* the node — exactly what a `gap` assertion asks for —
  would show no diff at all.

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"/></svg> The assertion DSL

Three kinds, one line each (`nodepact check` accepts this form; `steer.yaml` stores the equivalent
block):

```
gap(#email, #submit) >= 12px     # edge-to-edge distance between two nodes, in CSS pixels
gap(#email, #submit) <= 12px
style(display) == flex           # computed style of the anchored node
style(font-size) != 14px
changed()                        # the node really changed relative to the baseline
```

`gap` measures edge to edge: the vertical separation when the boxes are stacked, the horizontal one
when they sit side by side, and 0 when they overlap. `style` reads `getComputedStyle` of the anchored
node (the one you clicked during `annotate`), with lowercase CSS property names.

`steer.yaml` stores a structured block, not that string:

```yaml
version: 1
pairs:
  - anchor:
      id: submit
      selector: "#submit"
      fp: button#submit[type=button]|div>form#settings>main|t:b6fc31
      baseline_png: .nodepact/baseline/submit.png
      box: { x: 431, y: 226.59375, w: 68, h: 46 }
    annotation: 提交按钮和上面的邮箱输入框太近了
    assertion:
      kind: gap
      a: "#email"
      b: "#submit"
      op: ">="
      px: 12
    baseline_measure: 4
    created_at: 2026-10-26T02:41:00.000Z
    updated_at: null
```

> **Why a block and not one line?** YAML ends a plain scalar at `" #"`. A hand-written
> `assertion: gap(#email, #submit) >= 12px` would silently parse as `gap(#email,` — and hand-editing
> this file is exactly what it invites. So selector values are always quoted (`a: "#email"`) and the
> assertion is a block. When you replace an assertion by hand, set `baseline_measure` to `null` so
> `check` does not print a stale `before` value.

The full example file: [`examples/steer.yaml`](./examples/steer.yaml).

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5"/></svg> Configuration

`nodepact init` writes a `nodepact.yaml`; [`configs/nodepact.yaml`](./configs/nodepact.yaml) is the
commented copy of the same values, and every value there is the built-in default.

| Key | Default | What it does |
| --- | --- | --- |
| `cdp.host` / `cdp.port` | `127.0.0.1` / `9222` | which DevTools endpoint to attach to |
| `cdp.url_match` | `null` | attach to the page whose URL starts with this; `null` accepts a single open page |
| `oracle.epsilon` | `0.01` | render diff at least this large counts as "the node really changed"; `DONE` needs it |
| `oracle.stability_floor` | `0.01` | node re-render noise above this makes `check` report `UNSTABLE` |
| `oracle.capture_scale` | `1` | screenshot clip scale; 1 keeps the crop independent of display DPR |
| `oracle.capture_margin` | `16` | pixels of neighbourhood captured around the node, so a move-only fix is visible |
| `oracle.pixel_threshold` | `0.1` | pixelmatch per-pixel colour tolerance |
| `model.provider` / `model.timeout_ms` | `deepseek` / `20000` | used only when `annotate` drafts an assertion |
| `providers.*` | see below | OpenAI-compatible endpoint table |

| provider | model | API key env var | base_url |
| --- | --- | --- | --- |
| `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` |
| `qwen` | `qwen-plus` | `DASHSCOPE_API_KEY` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `glm` | `glm-5` | `ZHIPUAI_API_KEY` | empty — set the one your gateway exposes |
| `kimi` | `moonshot-v1-auto` | `MOONSHOT_API_KEY` | `https://api.moonshot.cn/v1` |

Keys are read from the environment at call time and never written to disk. GLM's OpenAI-compatible
URL differs per deployment (bigmodel.cn versus an internal gateway), so none is shipped. **Model ids
come from each vendor's console**: nothing here verifies them online, so a wrong id produces a clear
HTTP error during `annotate` while `check` is unaffected — the verdict does not depend on a model.

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z"/><path d="M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z"/><path d="M3 21l2.5 -2.5"/><path d="M18.5 5.5l2.5 -2.5"/></svg> Wiring it into a coding agent (MCP)

```bash
nodepact mcp --install
```

```json
{
  "mcpServers": {
    "nodepact": {
      "command": "npx",
      "args": ["-y", "nodepact", "mcp", "--config", "/your/project/nodepact.yaml", "--store", "/your/project/.nodepact"]
    }
  }
}
```

Two tools:

- `nodepact.check` (optional `node`: an anchor id or selector; omit to check every anchor) — re-renders
  and returns `DONE` / `NOT_DONE` / `UNSTABLE` with the measured values, the render diff and the
  artifact paths.
- `nodepact.list` — the steering pairs stored in this project (selector, your annotation, assertion,
  baseline path).

A typical agent loop: call `nodepact.check` -> get `NOT_DONE` and the measured value (`after: 4`,
against a required `>= 12px`) -> edit the CSS -> reload the page (automatic on an HMR dev server,
a manual refresh on a static one) -> call it again -> get `DONE` and the diff image. No human in
between. Because the verdict is deterministic, calling it twice on unchanged code returns the same
answer.

MCP is only the last mile: the whole thing runs from the CLI, with no agent at all.

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/><path d="M9 12l2 2l4 -4"/></svg> Where it sits next to its neighbours

| Approach | The half it owns | What decides |
| --- | --- | --- |
| Describing the defect in chat / pasting a screenshot | carrying the comment to a human or an agent | the agent's prose |
| Annotation tools (spotnote and friends) | delivering the annotation to the agent | the agent's prose |
| Approaches like reticle | letting the agent verify itself | the agent's own criterion |
| Whole-page visual regression (Playwright / Percy) | whole-page baselines in CI | baseline pixels |
| `chrome-devtools-mcp` | letting the agent read the DOM and screenshot it | the agent's judgement |
| **Nodepact** | turning the render diff of **the node you pointed at** into an acceptance signal | the assertion + the render diff (no model) |

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/><path d="M9 12l2 2l4 -4"/></svg> Capabilities and boundaries (v0.1)

What works today:

- five commands — `init` / `annotate` / `check` / `label` / `mcp` — one closed loop;
- three assertion kinds (`gap` / `style` / `changed`), zod-validated and stored structurally;
- anchor re-location by fingerprint, refusing to guess when two candidates tie;
- the render diff, the diff image, the noise and ε returned together; a three-way
  `DONE` / `NOT_DONE` / `UNSTABLE` verdict;
- Chinese annotation -> assertion draft (domestic models, OpenAI-compatible, skippable offline);
- MCP: `nodepact.check` / `nodepact.list`.

What it deliberately does not do (the v0.1 boundary, so you do not walk into it):

- **Chromium only**: CDP is a Chromium protocol; no Firefox or Safari;
- **it judges, it does not fix**: no DOM edits, no automatic source changes;
- **no CI mode and no headless visual regression**: the baseline is a crop of *your* window on *your*
  machine, so `.nodepact/` is git-ignored and a different machine needs a fresh `annotate`;
- **no browser-store extension**: only the CLI + MCP + the injected overlay;
- **no web panel, cloud console, multi-user, login or team server**;
- **no assertion kinds beyond those three**, no layout-tree reasoning, no cross-page or multi-route
  flow assertions;
- no IDE-embedded plugin; no hosted model gateway or billing; no native Windows packaging.

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z"/><path d="M3 10l18 0"/></svg> Pricing

**Who pays first.** Front-end and developer-productivity teams of 5–50 people who run coding agents
against internal UI, and who need the assertion store, the diff images and the annotations to stay on
their own machines (data residency, compliance, invoicing). For them a node-level acceptance signal
only counts if it runs inside their network.

**What they buy — the team plan.**

- **Private-deployment support**: point `annotate`'s assertion drafting at **your own model gateway**
  (self-hosted DeepSeek / Qwen / GLM / Kimi), never the public internet; onboarding and troubleshooting;
- **a shared assertion library across projects**: one `steer.yaml` convention and review process
  reused across repos;
- **an audit trail**: which assertion, anchored to which node, and which `check` flipped to `DONE`,
  exportable;
- **domestic-stack adaptation and invoicing**.

**Price.** ¥30k–60k per team-year (about ¥600–1200 per seat-year at 30–50 seats). The first three
design partners join at a ¥10k founding price in exchange for a public case study.

**The smallest "yes".** A 30-minute screen-share on **your own repository**: you point at a node,
type one Chinese annotation, and your agent's next commit flips `check` to `DONE` with the diff PNG.
Only then the question of wiring it to your internal model gateway and keeping the assertion store on
your machines. Billing is a transfer/invoice plus a self-hosted license file; v0.1 has no cloud
console, so there is nothing to build before the first invoice.

Team-plan enquiries: open an issue titled "team plan" on the repository.

The kernel is MIT, fully local and self-hostable; the above is the layer on top of it.

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l6 -3l6 3l6 -3v13l-6 3l-6 -3l-6 3v-13"/><path d="M9 4v13"/><path d="M15 7v13"/></svg> Roadmap

**Shipped (v0.1)**

- m1: CDP attach, overlay picking, baseline capture, `check` returning `PASS` / `FAIL` with the render
  diff for a hand-written assertion;
- m2: the assertion DSL with zod validation; a Chinese annotation drafted into an assertion by a
  domestic model and confirmed by a human; pulling the model endpoint leaves the verdict unchanged;
- m3: the MCP server exposing `nodepact.check` / `nodepact.list` with the verdict JSON and artifact paths.

Details in [`CHANGELOG.md`](./CHANGELOG.md).

**Next (demand-ordered, no dates promised)**

- what the team plan needs: internal model-gateway integration, a cross-project assertion library, an
  audit export;
- de-noising diffs across fonts and antialiasing (if design partners report `UNSTABLE` too often);
- a node-level acceptance gate, once a team confirms they want it (v0.1 does not do CI).

**Not doing**: see "Capabilities and boundaries" above — that list is the v0.1 contract, not a backlog.

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9h8"/><path d="M8 13h6"/><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 4v-4h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z"/></svg> Feedback

- Bugs and ideas: [GitHub Issues](https://github.com/SuperMarioYL/nodepact/issues);
- a Chinese mirror lives on [gitee.com](https://gitee.com) under the same name, synced from GitHub;
- the Chinese write-ups go to 掘金 / 少数派 with the same `docs/demo.cast`; the English side gets one
  Show HN thread.

The v0.1 candour: Chromium only, judging but never fixing, no CI. If your situation is off that line,
saying so is more useful than a star.

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg> License

MIT. See [`LICENSE`](./LICENSE).

<p align="center"><sub><a href="./LICENSE">MIT</a> © 2026 SuperMarioYL</sub></p>
