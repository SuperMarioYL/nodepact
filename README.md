[English](./README.en.md) | **简体中文**

<div align="center">

[![npm version](https://img.shields.io/npm/v/nodepact.svg?label=npm&color=2563eb)](https://www.npmjs.com/package/nodepact)
[![node](https://img.shields.io/badge/node-%E2%89%A522-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-2563eb.svg)](./LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-CDP%20only-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/devtools/protocol)
[![MCP](https://img.shields.io/badge/MCP-nodepact.check%20%2F%20nodepact.list-7c3aed)](https://modelcontextprotocol.io)
[![verdict](https://img.shields.io/badge/%E5%88%A4%E5%AE%9A-no%20model%20in%20the%20path-16a34a)](./src/oracle/verdict.ts)
[![release](https://img.shields.io/github/v/release/SuperMarioYL/nodepact?label=release)](https://github.com/SuperMarioYL/nodepact/releases)

[![Typing SVG](https://readme-typing-svg.demolab.com?font=Noto+Sans+SC&weight=600&size=22&duration=3200&pause=900&color=2563EB&center=true&vCenter=true&width=760&height=64&lines=%E7%82%B9%E4%B8%80%E4%B8%AA%E8%8A%82%E7%82%B9%20%C2%B7%20%E5%86%99%E4%B8%80%E5%8F%A5%E4%B8%AD%E6%96%87%E6%89%B9%E6%B3%A8;%E6%8A%8A%E5%AE%83%E5%8F%98%E6%88%90%E4%B8%80%E6%9D%A1%E5%8F%AF%E5%88%A4%E5%AE%9A%E7%9A%84%E6%96%AD%E8%A8%80;agent%20%E8%AF%B4%E6%94%B9%E5%A5%BD%E4%BA%86%EF%BC%8C%E8%8A%82%E7%82%B9%E5%B7%AE%E5%BC%82%E8%AF%B4%E4%BA%86%E7%AE%97;%E5%88%A4%E5%AE%9A%E8%B7%AF%E5%BE%84%E4%B8%8A%E6%B2%A1%E6%9C%89%E6%A8%A1%E5%9E%8B)](https://github.com/SuperMarioYL/nodepact)

# Nodepact

**让节点自己的渲染差异，成为 coding agent 的验收结论。**

你在自己已打开的 Chrome 里点一个节点、留一句话，Nodepact 把它落成一条可判定的断言；
之后每次 `nodepact check`，返回的是那个节点**前后渲染的差异**加 `PASS` / `FAIL`，
`DONE` 由机器的差异说了算，而不是 agent 的措辞。

<sub>元素锚定纠偏对 · 只连你已开的 Chromium · 判定路径上没有模型 · 断言库与差异图全在本地 <code>.nodepact/</code></sub>

</div>

---

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg> 为什么需要 Nodepact

你让 coding agent 改一处界面，看到的是一个渲染缺陷：按钮贴着输入框、间距不对、颜色偏了。
现在你只有一种表达方式——在聊天里用文字描述它（"设置页那个提交按钮离输入框太近了"），
然后**自己再看一遍页面**，判断 agent 到底改对没有。

这条回路里有两个洞：

- **批注没有绑在它说的那个元素上。** agent 只能重新猜你指的是哪个节点。
- **没有一个机器能读的验收信号。** agent 说"我已经修好了"，这句话本身就是"完成"的唯一证据。

于是人既是描述者又是复核者，回路永远合不上。

Nodepact 把这两件事合成一个原语：**元素锚定纠偏对**（element-anchored steering pair）。

- **锚点** = 那个 DOM 节点的稳定定位（CSS 选择器 + 结构指纹）＋ 修复前的渲染基线（该节点的裁剪截图）。
- **断言** = 一条可判定的谓词：两节点间距、computed style，或者"相对基线确实变了"。
- **判定** = `断言成立 ∧ 该节点前后渲染差异 ≥ ε`，路径上没有模型。

所以 `check` 给你的不是措辞，是一组可以复核的数：实测值、像素差异、差异 PNG 和结论。

**它补的是哪一半。** 把批注*投递*给 agent 的那一半已经很拥挤了（spotnote 这类 Vite 插件、reticle
这类"让 agent 自证"的方案）；Nodepact 不重复那一半，它让**你指的那个节点自己的渲染差异**成为
验收信号。检查面这一层和 `chrome-devtools-mcp`（让 agent 读 DOM、截图的那层 agent-to-DOM 能力）
是同一条 CDP 通路，Nodepact 直接用 `chrome-remote-interface` 连上去，不经过中间层。

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7l5 5l-5 5"/><line x1="12" y1="19" x2="19" y2="19"/></svg> 快速开始（10 分钟）

需要一个 Node 22+ 的环境，和一次 Chrome 的重启。

### 1. 安装

```bash
# 方式 A：直接装发布包（第一次 tag 推送之后可用）
npm i -g https://github.com/SuperMarioYL/nodepact/releases/latest/download/nodepact.tgz

# 方式 B：从源码（任何时刻都能跑）
git clone https://github.com/SuperMarioYL/nodepact.git && cd nodepact
npm ci && npm run build
npm link          # 之后就能直接敲 nodepact
```

发布到 npm registry 之后，`npm i -g nodepact` 与 `npx nodepact` 是同一条路径的短写法。
Nodepact 不下载任何浏览器：它只连你已打开的那一个。

### 2. 让 Chrome 打开调试端口

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222
# Linux
google-chrome --remote-debugging-port=9222
```

### 3. 起示例页面（这就是输入）

仓库里带了一个故意做错的设置页：提交按钮和邮箱输入框只隔了 4px。

```bash
python3 -m http.server 5173 --directory examples/demo-app
# 打开 http://localhost:5173
```

源码就在 [`examples/demo-app/index.html`](./examples/demo-app/index.html)，改一行 CSS 就能看到判定翻转。

### 4. 挂上去、点选、写批注

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

浮层出现在页面右下角：点节点，写下你的意见（中文就行），回车提交。如果你配了模型端点，
`annotate` 会把这句话起草成一条断言给你确认；没配也能用，直接手写断言。

### 5. 改一行 CSS，看它翻成 DONE

```bash
# examples/demo-app/index.html
#   #email { margin-bottom: 4px; }  ->  #email { margin-bottom: 14px; }
```

```console
$ nodepact check
#submit  gap(#email, #submit) >= 12px
  before 4  after 4  assertion FAIL
  render diff 0px (0.00%)  noise 0.00%  epsilon 1.00%
  artifact .nodepact/diffs/submit.after.png
  verdict NOT_DONE  assertion does not hold: gap 4px >= 12px -> fail

# ...改完 CSS...

$ nodepact check
#submit  gap(#email, #submit) >= 12px
  before 4  after 14  assertion PASS
  render diff 165px (2.09%)  noise 0.00%  epsilon 1.00%
  artifact .nodepact/diffs/submit.after.png
  verdict DONE  assertion holds and the node changed by 2.09% (≥ epsilon 1.00%)
```

退出码：`DONE` 是 0，`NOT_DONE` / `UNSTABLE` 是 1，锚点或基线出问题是 2。可以直接进你的脚本或 CI。

### 6. 让 agent 自己循环到 DONE

```bash
nodepact mcp --install     # 打印 MCP 客户端配置片段，粘贴到你的 agent 配置里
```

配置好之后，你的 coding agent 自己调 `nodepact.check`，拿到 `DONE` / `NOT_DONE` 与差异产物路径，
自己决定要不要继续改。

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16l13 -8z"/></svg> 演示

完整录屏：[`docs/demo.cast`](./docs/demo.cast)（asciinema v2 格式，`asciinema play docs/demo.cast` 回放）。

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
# agent 改掉那一行 CSS，再调一次：
$ nodepact check --json
{ "verdict": "DONE", "before": 4, "after": 14,
  "render_diff": { "changed_px": 165, "total_px": 7900, "ratio": 0.0209 } }
```

这次运行的全部数字都记录在 [`docs/demo-results.json`](./docs/demo-results.json)，README 只引用它：

| 观测项 | 值 |
| --- | --- |
| 锚点 | `#submit`，指纹 `99ceb4`，基线 `68x46` |
| 断言 | `gap(#email, #submit) >= 12px` |
| 修复前 / 修复后实测 | `4px` → `14px` |
| 渲染差异 | `165px` / 共 `7900px` = `ratio 0.0209` |
| 阈值 | `epsilon 0.01`，`stability_floor 0.01`，`capture_margin 16px` |
| 判定 | `NOT_DONE` → `DONE`（退出码 0） |

这些数字来自一次真实运行（`capture_scale = 1`，`devicePixelRatio = 1`）。换个屏幕缩放，裁剪尺寸会变，
判定不会：判定看的是断言实测值与差异占比，不是像素的绝对数量。

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M12 19h4.5a3.5 3.5 0 0 0 0 -7h-8a3.5 3.5 0 0 1 0 -7h3.5"/></svg> 工作原理

```
你的 Chrome（dev server 页面）  <--- CDP (--remote-debugging-port=9222)
      |  ^
overlay.js |  | Page.captureScreenshot(clip = 节点框 ± capture_margin)
      v  |      getBoundingClientRect / getComputedStyle
  nodepact CLI（node，单进程）
    |- anchor/   fingerprint + store   -> .nodepact/steer.yaml + .nodepact/baseline/*.png
    |- oracle/   assert.eval + diff(pixelmatch) + verdict -> .nodepact/diffs/*.png
    |- annotate/ draft -> 国产模型（OpenAI 兼容，仅起草断言，可离线跳过）
    \- mcp/      server -> nodepact.check / nodepact.list  <-- coding agent
```

最多两个进程：你自己开的 Chrome，和 nodepact 的 CLI / MCP 进程。没有守护进程、没有数据库、
没有云端——全部状态是 `.nodepact/` 下的扁平文件。

**判定是一个纯函数**（[`src/oracle/verdict.ts`](./src/oracle/verdict.ts)）：

```
DONE     ⟺ 断言成立 ∧ diff(基线, 现在).ratio ≥ ε
NOT_DONE   其余情况
UNSTABLE   该节点自己重渲染两次的差异 > stability_floor
```

判定里没有模型，所以同一份代码跑两次结论一定一样。**锚点也不是选择器**：除了 CSS 选择器，它还带一份
结构指纹（标签 + 稳定属性 + 最近三层祖先链 + 文本哈希）。DOM 漂移之后选择器可能失效，指纹还能把节点找回来；
如果两个候选打平，`check` 直接报 `anchor_not_found`，绝不猜。

### 稳定性是这套 oracle 的核心风险，所以它是明说的

动态内容、网页字体、抗锯齿都会让同一个节点的两次截图天然不同。Nodepact 的取舍是：

- 几何类断言（`gap` / `style`）本身不受抗锯齿影响，它们是主判据；
- 像素差异只作为"这个节点确实被动过"的辅证，阈值 ε 按节点框内像素占比算，且 `includeAA: false`；
- 每次 `check` 都把实测值、ε、本次噪声一起打出来，让"噪声"和"真修复"可分辨；
- 两次背靠背截图的差异超过 `stability_floor` 时，报 `UNSTABLE`，不假装 `DONE`；
- 截图会在节点四周多裁 `capture_margin`（默认 16px）：裁得太紧的截图会跟着节点一起移动，
  一个只把节点挪开的修复（正是 `gap` 断言要求的那种）就会看不见差异。

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"/></svg> 断言 DSL

只有三种，一行一条（`nodepact check` 接受这种写法，`steer.yaml` 里存的是等价的块）：

```
gap(#email, #submit) >= 12px     # 两个节点的边缘间距，单位 CSS 像素
gap(#email, #submit) <= 12px
style(display) == flex           # 锚定节点的 computed style
style(font-size) != 14px
changed()                        # 相对基线，这个节点确实变了
```

`gap` 取两个盒子边缘到边缘的距离：上下排布时取垂直间距，左右并排时取水平间距，重叠为 0。
`style` 读的是锚定节点（`annotate` 时你点的那个）的 `getComputedStyle`，属性名用小写 CSS 名。

`steer.yaml` 里存的是结构化的块，不是上面那行字符串：

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

> **为什么断言是块而不是一行？** YAML 遇到 `" #"` 就结束一个纯量。手写
> `assertion: gap(#email, #submit) >= 12px` 会被安静地解析成 `gap(#email,`——而手写这个文件正是它的用法。
> 所以选择器值一律加引号（`a: "#email"`），断言用块。改断言时记得把 `baseline_measure` 置为 `null`，
> 免得 `check` 打出一个过期的 before 值。

完整的示例文件：[`examples/steer.yaml`](./examples/steer.yaml)。

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5"/></svg> 配置

`nodepact init` 会写一份 `nodepact.yaml`；[`configs/nodepact.yaml`](./configs/nodepact.yaml) 是同样内容的
带注释副本，所有值就是内置默认值。

| 键 | 默认 | 作用 |
| --- | --- | --- |
| `cdp.host` / `cdp.port` | `127.0.0.1` / `9222` | 连哪个 DevTools 端点 |
| `cdp.url_match` | `null` | 只挂 URL 以它开头的那个页面；`null` 时要求只有一个打开页面 |
| `oracle.epsilon` | `0.01` | 渲染差异达到这个占比才算"节点真的变了"，`DONE` 需要它 |
| `oracle.stability_floor` | `0.01` | 节点自重渲染噪声超过它，`check` 报 `UNSTABLE` |
| `oracle.capture_scale` | `1` | 截图 clip 的缩放，1 让裁剪不受屏幕 DPR 影响 |
| `oracle.capture_margin` | `16` | 节点四周多裁的像素，让"只挪位置"的修复也能被看见 |
| `oracle.pixel_threshold` | `0.1` | pixelmatch 的单像素颜色容差 |
| `model.provider` / `model.timeout_ms` | `deepseek` / `20000` | 只用 `annotate` 起草断言时用到 |
| `providers.*` | 见下 | OpenAI 兼容端点表 |

| provider | 模型 | API Key 环境变量 | base_url |
| --- | --- | --- | --- |
| `deepseek` | `deepseek-chat` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` |
| `qwen` | `qwen-plus` | `DASHSCOPE_API_KEY` | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `glm` | `glm-5` | `ZHIPUAI_API_KEY` | 空——按你的网关填 |
| `kimi` | `moonshot-v1-auto` | `MOONSHOT_API_KEY` | `https://api.moonshot.cn/v1` |

Key 只在调用时从环境变量读，不落盘。GLM 的 OpenAI 兼容地址随部署不同（bigmodel.cn 与内网网关不一样），
所以不预置。**模型名以各家控制台为准**：这里没有在线校验模型名，写错了会在 `annotate` 时得到一个明确的
HTTP 错误，而 `check` 完全不受影响——判定不依赖模型。

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5z"/><path d="M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5z"/><path d="M3 21l2.5 -2.5"/><path d="M18.5 5.5l2.5 -2.5"/></svg> 接入 coding agent（MCP）

```bash
nodepact mcp --install
```

```json
{
  "mcpServers": {
    "nodepact": {
      "command": "npx",
      "args": ["-y", "nodepact", "mcp", "--config", "/你的项目/nodepact.yaml", "--store", "/你的项目/.nodepact"]
    }
  }
}
```

两个工具：

- `nodepact.check`（可选参数 `node`：锚点 id 或选择器；省略则检查全部）——重新渲染并返回
  `DONE` / `NOT_DONE` / `UNSTABLE`、实测值、像素差异和产物路径。
- `nodepact.list`——列出本项目里存的纠偏对（选择器、你的批注、断言、基线路径）。

一个典型的 agent 循环：调 `nodepact.check` → 拿到 `NOT_DONE` 和实测值（`after: 4`，要求 `>= 12px`）→
改 CSS → 再调一次 → 拿到 `DONE` 和差异图。中间不需要人。因为判定是确定性的，重复调用同一份代码得到同一个答案。

MCP 只是最后一公里：整套东西从 CLI 就能跑，不需要任何 agent。

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/><path d="M9 12l2 2l4 -4"/></svg> 与相邻工具的分工

| 做法 | 它负责的那一半 | 谁说了算 |
| --- | --- | --- |
| 聊天里描述缺陷 / 贴截图 | 把意见传给人或 agent | agent 的措辞 |
| 批注类工具（spotnote 等） | 把批注投递给 agent | agent 的措辞 |
| reticle 一类方案 | 让 agent 自己验证自己 | agent 自己的判据 |
| 整页视觉回归（Playwright / Percy） | CI 里的整页基线快照 | 基线像素 |
| `chrome-devtools-mcp` | 让 agent 读 DOM、截图 | agent 的判断 |
| **Nodepact** | 把**你指的那个节点**的前后渲染差异变成验收信号 | 断言 + 渲染差异（无模型） |

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3"/><path d="M9 12l2 2l4 -4"/></svg> 能力与边界（v0.1）

已经能做的：

- `init` / `annotate` / `check` / `label` / `mcp` 五个命令，一条闭环；
- 三类断言（`gap` / `style` / `changed`）+ zod 校验 + 结构化存储；
- 锚点指纹重定位，两个候选打平时拒绝猜测；
- 渲染差异、差异图、噪声与 ε 一起返回；`DONE` / `NOT_DONE` / `UNSTABLE` 三态判定；
- 中文批注 → 断言草稿（国产模型，OpenAI 兼容，可离线跳过）；
- MCP：`nodepact.check` / `nodepact.list`。

明确不做的（v0.1 的边界，写在这里免得你踩空）：

- **只连 Chromium**：CDP 是 Chromium 的协议，Firefox / Safari 不支持；
- **只判定，不改码**：不自动改 DOM、不自动修代码；
- **不做 CI 与无头视觉回归**：基线是**你自己那台机器、你那个窗口**的截图，所以 `.nodepact/` 被 git 忽略，
  换台机器要重新 `annotate`；
- **不做浏览器商店扩展**：只有 CLI + MCP + 注入式浮层；
- **不做 Web 面板 / 云控制台 / 多用户 / 登录 / 团队服务端**；
- **断言不超过三类**，不做布局树推理；不做跨页面、多路由的流程断言；
- 不做 IDE 内嵌插件；不做托管的模型网关与计费；不做 Windows 原生打包。

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3z"/><path d="M3 10l18 0"/></svg> 付费

**谁先付钱。** 5–50 人的中后台前端 / 研发效能团队：他们在内部 UI 上跑 coding agent，
而断言库、差异图、批注都必须留在自己机器上（数据不出境 / 信创 / 等保）。对他们来说，
"节点级验收信号"要落到内网才算数。

**他们买的是什么——团队版。**

- **私有化部署支持**：把 `annotate` 的断言起草接到**你们自己的模型网关**（自建 DeepSeek / Qwen / GLM / Kimi），
  不走公网；上线陪跑与排障；
- **跨项目共享断言库**：一套 `steer.yaml` 约定与评审流程，在多项目、多仓库之间复用；
- **审计留痕**：哪条断言、锚在哪个节点、哪一次 `check` 翻成了 `DONE`，可导出；
- **信创适配与开票**：内网环境适配、对公转账与发票。

**价格。** ¥30k–60k / 团队·年（30–50 席约 ¥600–1200 / 席·年）。前 3 个设计伙伴按 ¥10k 创始价合作，
换一次公开案例研究。

**最小的一次"好"。** 30 分钟屏幕共享，挂到**你们自己的仓库**上：你点一个节点、写一句中文批注，
你们 agent 的下一次提交把 `check` 翻成 `DONE`，带着差异 PNG。然后才谈"要不要接你们内网的模型网关、
断言库放你们自己机器上"。结算走对公转账 / 开票 + 自托管 license 文件；v0.1 没有云端控制台，
所以在第一张发票之前没有需要先建的东西。

咨询团队版：在仓库开一个 issue，标题写「团队版」。

内核是 MIT、全本地、可自托管；上面这些服务是它之上的那一层。

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l6 -3l6 3l6 -3v13l-6 3l-6 -3l-6 3v-13"/><path d="M9 4v13"/><path d="M15 7v13"/></svg> 路线图

**已交付（v0.1）**

- m1：CDP 挂载、浮层点选、基线抓取、`check` 对一条手写断言返回 `PASS` / `FAIL` 加渲染差异；
- m2：断言 DSL + zod 校验；中文批注经国产模型起草断言，人确认后写入；拔掉模型端点判定不变；
- m3：MCP 服务暴露 `nodepact.check` / `nodepact.list`，返回 verdict JSON 与产物路径。

细节见 [`CHANGELOG.md`](./CHANGELOG.md)。

**下一步（按需求排，不承诺日期）**

- 团队版要求的那些：内网模型网关接入、跨项目共享断言库、审计导出；
- 跨字体 / 抗锯齿的差异去噪（如果设计伙伴反馈 `UNSTABLE` 太频繁）；
- 团队确认后的节点级验收门禁（现在的 v0.1 不做 CI）。

**不做**：见上面「能力与边界」——那份清单是 v0.1 的契约，不是待办。

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9h8"/><path d="M8 13h6"/><path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 4v-4h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z"/></svg> 反馈

- Bug 与想法：[GitHub Issues](https://github.com/SuperMarioYL/nodepact/issues)；
- 国内镜像：[gitee.com](https://gitee.com) 上的同名仓库（同步 GitHub）；
- 中文长文会发在掘金 / 少数派，同一段 `docs/demo.cast`；英文侧会发一次 Show HN。

v0.1 的坦白：只连 Chromium、只判定不改码、不做 CI。如果你的场景不在这条线上，直说更有用。

## <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg> 许可

MIT。见 [`LICENSE`](./LICENSE)。

<p align="center"><sub><a href="./LICENSE">MIT</a> © 2026 SuperMarioYL</sub></p>
