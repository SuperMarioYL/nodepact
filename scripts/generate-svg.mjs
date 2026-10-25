#!/usr/bin/env node
// Generates the site/README figure groups from web/palette.json.
//
//   node scripts/generate-svg.mjs
//
// Colors and the data-palette stamp come from the pinned renderer:
//   node "$FACTORY_DIR/scripts/palette.js" --site web/site.json --out web/palette.json
// Nothing here hardcodes a color. Every figure is a self-contained SVG using
// CSS animation only (no script, no remote fonts/images); its complete static
// frame keeps every label, relationship and result. The two scene-fallback
// stills are deliberately static — no animation at all.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, "web/assets/presentation");
const palette = JSON.parse(fs.readFileSync(path.join(root, "web/palette.json"), "utf8"));

const MONO = "'SF Mono','JetBrains Mono','Cascadia Code',ui-monospace,Menlo,Consolas,monospace";
const SANS = "-apple-system,'Segoe UI','PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const css = (anim) => `
    text { font-family: ${SANS}; }
    .mono { font-family: ${MONO}; }
    .zh { font-family: ${SANS}; }${
      anim
        ? `
    .drift1 { animation: drift1 7s ease-in-out infinite alternate; }
    .drift2 { animation: drift2 9s ease-in-out infinite alternate; }
    .pulse  { animation: pulse 2.6s ease-in-out infinite; }
    .pulse2 { animation: pulse2 3.4s ease-in-out infinite; }
    .flow   { stroke-dasharray: 6 8; animation: march 1.6s linear infinite; }
    .flow-slow { stroke-dasharray: 5 9; animation: march 3.2s linear infinite; }
    .blink  { animation: blink 2.4s steps(2, jump-none) infinite; }
    @keyframes drift1 { from { transform: translate(0,0); } to { transform: translate(14px,-18px); } }
    @keyframes drift2 { from { transform: translate(0,0); } to { transform: translate(-12px,16px); } }
    @keyframes pulse  { 0%,100% { opacity: .25; } 50% { opacity: 1; } }
    @keyframes pulse2 { 0%,100% { opacity: .9; } 45% { opacity: .25; } }
    @keyframes march  { to { stroke-dashoffset: -28; } }
    @keyframes blink  { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
    @media (prefers-reduced-motion: reduce) {
      .drift1,.drift2,.pulse,.pulse2,.flow,.flow-slow,.blink { animation: none; }
    }`
        : ""
    }`;

function svg(label, w, h, t, body, { anim = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" data-palette="${palette.id}">
  <style>${css(anim)}</style>
${body}
</svg>
`;
}

// Faint blueprint grid + a scattered particle field, tinted by the palette.
function backdrop(t, w, h, seedShift = 0) {
  const dots = [];
  let x = 37 + seedShift, y = 61;
  for (let i = 0; i < 30; i++) {
    x = (x * 73 + 41) % (w - 20) + 10;
    y = (y * 131 + 29) % (h - 20) + 10;
    const r = 1 + (i % 3) * 0.7;
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${i % 2 ? t.primary : t.highlight}" opacity="${(0.1 + (i % 4) * 0.05).toFixed(2)}"/>`);
  }
  const lines = [];
  for (let gx = 60; gx < w; gx += 120) lines.push(`<line x1="${gx}" y1="0" x2="${gx}" y2="${h}" stroke="${t.line}" stroke-width="0.5" opacity="0.5"/>`);
  for (let gy = 60; gy < h; gy += 120) lines.push(`<line x1="0" y1="${gy}" x2="${w}" y2="${gy}" stroke="${t.line}" stroke-width="0.5" opacity="0.5"/>`);
  return `<g>${lines.join("\n")}<g class="drift1">${dots.slice(0, 15).join("")}</g><g class="drift2">${dots.slice(15).join("")}</g></g>`;
}

function glowDefs(t) {
  return `<filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="6" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <radialGradient id="halo" cx="50%" cy="42%" r="55%">
    <stop offset="0%" stop-color="${t.primary}" stop-opacity="0.18"/>
    <stop offset="60%" stop-color="${t.secondary}" stop-opacity="0.06"/>
    <stop offset="100%" stop-color="${t.bg}" stop-opacity="0"/>
  </radialGradient>`;
}

const chip = (t, x, y, w, h, text, { hot = false, mono = false } = {}) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${t.code}" stroke="${hot ? t.primary : t.line}" stroke-width="${hot ? 1.6 : 1.2}"/>
  <text x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle" font-size="14" fill="${hot ? t.primary : t.muted}"${mono ? ' class="mono"' : ""}>${esc(text)}</text>`;

const node = (t, x, y, w, h, { hot = false, dashed = false } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${t.panel}" stroke="${hot ? t.primary : t.line}" stroke-width="${hot ? 1.8 : 1.4}"${dashed ? ' stroke-dasharray="5 5"' : ""}/>`;

// The demo page fragment: the deliberately-wrong settings form, drawn at a
// given gap so before/after states read at a glance.
function formFragment(t, x, y, gapPx, { highlight = false } = {}) {
  const scale = 3.2;
  const gapH = Math.max(6, gapPx * scale);
  const emailY = y;
  const btnY = y + 46 + gapH;
  return `<g>
    <rect x="${x}" y="${y - 26}" width="300" height="${btnY - y + 72}" rx="14" fill="${t.code}" stroke="${t.line}" stroke-width="1.2"/>
    <text x="${x + 16}" y="${y - 8}" font-size="12" class="mono" fill="${t.muted}">form#settings</text>
    <rect x="${x + 16}" y="${emailY}" width="268" height="38" rx="7" fill="${t.panel}" stroke="${t.secondary}" stroke-width="1.4"/>
    <text x="${x + 28}" y="${emailY + 24}" font-size="13" fill="${t.muted}">#email</text>
    <rect x="${x + 16}" y="${btnY}" width="120" height="38" rx="7" fill="${t.panel}" stroke="${highlight ? t.primary : t.secondary}" stroke-width="${highlight ? 2 : 1.4}"/>
    <text x="${x + 30}" y="${btnY + 24}" font-size="13" fill="${t.ink}">#submit</text>
    <line x1="${x + 286}" y1="${emailY + 38}" x2="${x + 286}" y2="${btnY}" stroke="${t.primary}" stroke-width="1.4" class="flow"/>
    <line x1="${x + 280}" y1="${emailY + 38}" x2="${x + 292}" y2="${emailY + 38}" stroke="${t.primary}" stroke-width="1.4"/>
    <line x1="${x + 280}" y1="${btnY}" x2="${x + 292}" y2="${btnY}" stroke="${t.primary}" stroke-width="1.4"/>
    <text x="${x + 300}" y="${(emailY + 38 + btnY) / 2 + 4}" font-size="13" class="mono" fill="${t.primary}">${gapPx}px</text>
  </g>`;
}

// ---------------------------------------------------------------- hero still
// Static on purpose: the reduced-motion / no-WebGL still for the particle hero.
// Atmospheric only — the hero DOM already carries the wordmark, the headline
// and the actions, so this must not repeat them (and must crop cleanly at any
// viewport ratio).
function heroStill(t) {
  const W = 1200, H = 760, cx = 600, cy = 380;
  const particles = [];
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + (i % 3) * 0.4;
    const r = 170 + (i % 6) * 46;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.62;
    particles.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.6 + (i % 3) * 0.9).toFixed(1)}" fill="${i % 2 ? t.primary : t.highlight}" opacity="${(0.22 + (i % 5) * 0.11).toFixed(2)}"/>`);
  }
  const spokes = [];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2;
    spokes.push(`<line x1="${(cx + Math.cos(a) * 250).toFixed(1)}" y1="${(cy + Math.sin(a) * 155).toFixed(1)}" x2="${(cx + Math.cos(a) * 86).toFixed(1)}" y2="${(cy + Math.sin(a) * 54).toFixed(1)}" stroke="${t.line}" stroke-width="1" opacity="0.8"/>`);
  }
  const rings = [150, 205, 262].map((r, i) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${(r * 0.62).toFixed(0)}" fill="none" stroke="${i === 1 ? t.primary : t.line}" stroke-width="${i === 1 ? 1.2 : 0.8}" opacity="${i === 1 ? 0.5 : 0.7}"/>`).join("\n  ");
  return svg("Nodepact — particle convergence onto one anchored node", W, H, t, `  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  ${glowDefs(t)}
  <rect width="${W}" height="${H}" fill="url(#halo)"/>
  ${backdrop(t, W, H, 7)}
  <g>${rings}</g>
  <g>${spokes.join("")}</g>
  <g>${particles.join("")}</g>

  <!-- the anchored node: baseline crop + the assertion it must satisfy -->
  <g filter="url(#glow)">
    <rect x="${cx - 96}" y="${cy - 66}" width="192" height="132" rx="16" fill="${t.panel}" stroke="${t.primary}" stroke-width="2.4"/>
  </g>
  <rect x="${cx - 76}" y="${cy - 44}" width="152" height="34" rx="7" fill="${t.code}" stroke="${t.secondary}" stroke-width="1.2"/>
  <text x="${cx - 62}" y="${cy - 22}" font-size="13" class="mono" fill="${t.muted}">#email</text>
  <rect x="${cx - 76}" y="${cy + 12}" width="86" height="34" rx="7" fill="${t.code}" stroke="${t.primary}" stroke-width="1.8"/>
  <text x="${cx - 62}" y="${cy + 34}" font-size="13" class="mono" fill="${t.ink}">#submit</text>
  <line x1="${cx + 74}" y1="${cy - 10}" x2="${cx + 74}" y2="${cy + 12}" stroke="${t.primary}" stroke-width="1.6"/>
  <line x1="${cx + 68}" y1="${cy - 10}" x2="${cx + 80}" y2="${cy - 10}" stroke="${t.primary}" stroke-width="1.6"/>
  <line x1="${cx + 68}" y1="${cy + 12}" x2="${cx + 80}" y2="${cy + 12}" stroke="${t.primary}" stroke-width="1.6"/>
  <text x="${cx + 88}" y="${cy + 6}" font-size="12" class="mono" fill="${t.primary}">≥ 12px</text>
`);
}

// --------------------------------------------------------------- core process
function processSvg(t, mobile = false) {
  const stages = [
    { n: "01", zh: "init", en: "attach over CDP", sub: "只连你已开的 Chrome", subEn: "your own Chrome, never launched" },
    { n: "02", zh: "annotate", en: "pick + annotate", sub: "中文批注 → 断言草稿", subEn: "Chinese line → drafted assertion" },
    { n: "03", zh: "check", en: "re-render + diff", sub: "断言实测 + 像素差异", subEn: "measured value + pixel diff" },
    { n: "04", zh: "verdict", en: "three states", sub: "判定路径上没有模型", subEn: "no model on the verdict path", hot: true },
    { n: "05", zh: "mcp", en: "agent loop", sub: "agent 自己循环到 DONE", subEn: "the agent loops to DONE" },
  ];
  if (mobile) {
    const W = 720, H = 1000;
    const rows = stages.map((s, i) => {
      const y = 120 + i * 168;
      return `<g>
        ${node(t, 40, y, 640, 124, { hot: !!s.hot })}
        <circle cx="88" cy="${y + 44}" r="21" fill="${t.code}" stroke="${s.hot ? t.primary : t.secondary}" stroke-width="1.6"/>
        <text x="88" y="${y + 51}" text-anchor="middle" font-size="17" class="mono" fill="${t.primary}">${s.n}</text>
        <text x="130" y="${y + 50}" font-size="26" font-weight="600" fill="${t.ink}">${esc(s.zh)}</text>
        <text x="130" y="${y + 76}" font-size="14" class="mono" fill="${t.muted}">${esc(s.en)}</text>
        <text x="60" y="${y + 106}" font-size="14" fill="${t.muted}">${esc(s.sub)}</text>
        ${i < stages.length - 1 ? `<path d="M 88 ${y + 124} L 88 ${y + 168}" stroke="${t.primary}" stroke-width="1.8" class="flow" fill="none"/>` : ""}
      </g>`;
    }).join("\n");
    return svg("Nodepact core process", W, H, t, `  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  ${glowDefs(t)}
  ${backdrop(t, W, H, 11)}
  <text x="40" y="58" font-size="27" font-weight="600" fill="${t.ink}">一次闭环 <tspan fill="${t.muted}" font-size="17">· 五条命令</tspan></text>
  <text x="40" y="88" font-size="14" class="mono" fill="${t.muted}">init · annotate · check · label · mcp</text>
  ${rows}
  <text x="40" y="${H - 24}" font-size="14" fill="${t.muted}">DONE ⟺ 断言成立 ∧ 差异占比 ≥ ε　·　NOT_DONE 其余　·　UNSTABLE 噪声超上限</text>
`);
  }
  const W = 1200, H = 528;
  const cards = stages.map((s, i) => {
    const x = 40 + i * 230;
    return `<g>
      ${node(t, x, 132, 202, 176, { hot: !!s.hot })}
      <circle cx="${x + 30}" cy="164" r="15" fill="${t.code}" stroke="${s.hot ? t.primary : t.secondary}" stroke-width="1.4"/>
      <text x="${x + 30}" y="169" text-anchor="middle" font-size="13" class="mono" fill="${t.primary}">${s.n}</text>
      <text x="${x + 20}" y="212" font-size="24" font-weight="600" fill="${t.ink}">${esc(s.zh)}</text>
      <text x="${x + 20}" y="238" font-size="12.5" class="mono" fill="${t.muted}">${esc(s.en)}</text>
      <text x="${x + 20}" y="268" font-size="12.5" fill="${t.muted}">${esc(s.sub)}</text>
      <text x="${x + 20}" y="288" font-size="11.5" fill="${t.muted}">${esc(s.subEn)}</text>
      ${i < stages.length - 1 ? `<path d="M ${x + 202} 220 L ${x + 230} 220" stroke="${t.primary}" stroke-width="1.8" class="flow" fill="none"/>` : ""}
    </g>`;
  }).join("\n");
  const states = [
    { x: 130, label: "NOT_DONE", sub: "断言不成立，或节点没变" },
    { x: 600, label: "DONE", sub: "断言成立 且 差异 ≥ ε" },
    { x: 1070, label: "UNSTABLE", sub: "自重渲染噪声 > stability_floor" },
  ].map((s) => `<g>
    <rect x="${s.x - 128}" y="372" width="256" height="60" rx="12" fill="${t.code}" stroke="${t.line}" stroke-width="1.4"/>
    <text x="${s.x}" y="400" text-anchor="middle" font-size="19" font-weight="600" class="mono" fill="${t.primary}">${s.label}</text>
    <text x="${s.x}" y="421" text-anchor="middle" font-size="12" fill="${t.muted}">${esc(s.sub)}</text>
  </g>`).join("\n");
  return svg("Nodepact core process", W, H, t, `  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  ${glowDefs(t)}
  ${backdrop(t, W, H, 11)}
  <text x="40" y="52" font-size="24" font-weight="600" fill="${t.ink}">一次闭环 <tspan fill="${t.muted}" font-size="16">· init · annotate · check · label · mcp</tspan></text>
  ${cards}
  <path d="M 1012 308 L 1012 336 L 600 336 L 600 372" stroke="${t.secondary}" stroke-width="1.5" class="flow-slow" fill="none"/>
  <text x="700" y="330" font-size="12.5" class="mono" fill="${t.muted}">check 的三态判定</text>
  ${states}
  <text x="40" y="${H - 26}" font-size="13.5" fill="${t.muted}">判定是纯函数，路径上没有模型；label 复查已有锚点，mcp 把 nodepact.check / nodepact.list 交给 agent。</text>
`);
}

// -------------------------------------------------------------- architecture
function architectureSvg(t, mobile = false) {
  if (mobile) {
    const W = 720, H = 1120;
    return svg("Nodepact architecture", W, H, t, `  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  ${glowDefs(t)}
  ${backdrop(t, W, H, 3)}
  <text x="40" y="58" font-size="27" font-weight="600" fill="${t.ink}">两个进程 <tspan fill="${t.muted}" font-size="17">· 扁平文件</tspan></text>

  ${node(t, 40, 96, 640, 168, { hot: true })}
  <text x="64" y="130" font-size="15" fill="${t.muted}">开发者已开的 Chrome</text>
  <text x="64" y="160" font-size="19" class="mono" fill="${t.ink}">dev server 页面</text>
  <text x="64" y="196" font-size="14" fill="${t.muted}">overlay.js 注入浮层，只负责点选</text>
  <text x="64" y="224" font-size="14" class="mono" fill="${t.muted}">getBoundingClientRect · getComputedStyle</text>

  <path d="M 360 264 L 360 328" stroke="${t.primary}" stroke-width="2" class="flow" fill="none"/>
  <text x="380" y="302" font-size="14" class="mono" fill="${t.primary}">CDP · 127.0.0.1:9222</text>

  ${node(t, 40, 328, 640, 470, { hot: true })}
  <text x="64" y="362" font-size="15" fill="${t.muted}">nodepact CLI · 单进程（node）</text>
  ${[
    ["anchor/", "指纹 + 存储 → steer.yaml + baseline/*.png"],
    ["oracle/", "assert.eval + pixelmatch diff + verdict"],
    ["annotate/", "中文批注 → 断言草稿（可选模型）"],
    ["mcp/", "nodepact.check / nodepact.list → agent"],
  ].map(([name, sub], i) => {
    const y = 388 + i * 100;
    return `<g>
      ${node(t, 64, y, 592, 82, { dashed: name === "annotate/" })}
      <text x="84" y="${y + 34}" font-size="17" class="mono" fill="${t.primary}">${name}</text>
      <text x="84" y="${y + 62}" font-size="13.5" fill="${t.muted}">${esc(sub)}</text>
    </g>`;
  }).join("\n")}

  <path d="M 360 798 L 360 856" stroke="${t.primary}" stroke-width="2" class="flow" fill="none"/>
  <text x="380" y="834" font-size="14" class="mono" fill="${t.muted}">全部状态落在本地</text>
  ${node(t, 40, 856, 640, 200, { hot: false })}
  <text x="64" y="890" font-size="15" fill="${t.muted}">.nodepact/ · 扁平文件，可私有化</text>
  ${[
    "steer.yaml — 锚点 + 批注 + 断言",
    "baseline/submit.png — 修复前裁剪",
    "diffs/submit.after.png · submit.diff.png",
  ].map((s, i) => `<text x="84" y="${928 + i * 40}" font-size="15" class="mono" fill="${t.ink}">${esc(s)}</text>`).join("\n")}
  <text x="40" y="${H - 22}" font-size="13.5" fill="${t.muted}">没有守护进程、没有数据库、没有云端。</text>
`);
  }
  const W = 1200, H = 648;
  const box = (x, y, w, h, hot, dashed) => node(t, x, y, w, h, { hot, dashed });
  return svg("Nodepact architecture", W, H, t, `  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  ${glowDefs(t)}
  ${backdrop(t, W, H, 3)}
  <text x="40" y="50" font-size="24" font-weight="600" fill="${t.ink}">架构 <tspan fill="${t.muted}" font-size="16">· 最多两个进程，状态全是扁平文件</tspan></text>

  <!-- browser zone -->
  ${box(40, 78, 300, 190, true, false)}
  <text x="60" y="108" font-size="14" fill="${t.muted}">开发者已开的 Chrome</text>
  <text x="60" y="140" font-size="18" class="mono" fill="${t.ink}">dev server 页面</text>
  <text x="60" y="174" font-size="13" fill="${t.muted}">overlay.js · 注入浮层，只负责点选</text>
  <text x="60" y="200" font-size="12.5" class="mono" fill="${t.muted}">getBoundingClientRect</text>
  <text x="60" y="222" font-size="12.5" class="mono" fill="${t.muted}">getComputedStyle</text>
  <text x="60" y="250" font-size="12.5" fill="${t.secondary}">Nodepact 从不启动浏览器</text>

  <!-- CDP -->
  <path d="M 340 158 L 400 158" stroke="${t.primary}" stroke-width="2" class="flow" fill="none"/>
  <text x="370" y="144" text-anchor="middle" font-size="12.5" class="mono" fill="${t.primary}">CDP</text>
  <text x="370" y="182" text-anchor="middle" font-size="11.5" class="mono" fill="${t.muted}">9222</text>
  <path d="M 400 200 L 340 200" stroke="${t.secondary}" stroke-width="1.4" class="flow-slow" fill="none"/>

  <!-- assertion kinds -->
  ${box(40, 296, 300, 180, false, false)}
  <text x="60" y="326" font-size="14" fill="${t.muted}">断言只有三类，一行一条</text>
  <text x="60" y="358" font-size="13" class="mono" fill="${t.ink}">gap(#email, #submit) >= 12px</text>
  <text x="60" y="386" font-size="13" class="mono" fill="${t.ink}">style(display) == flex</text>
  <text x="60" y="414" font-size="13" class="mono" fill="${t.ink}">changed()</text>
  <text x="60" y="446" font-size="12.5" fill="${t.muted}">gap 取两盒边缘距离，style 读 computed</text>
  <text x="60" y="466" font-size="12.5" fill="${t.muted}">style，changed 看相对基线是否变了</text>

  <!-- CLI zone -->
  ${box(400, 78, 760, 430, true, false)}
  <text x="424" y="108" font-size="14" fill="${t.muted}">nodepact CLI · 单进程（node）</text>

  ${box(424, 118, 336, 84, false, false)}
  <text x="444" y="148" font-size="17" class="mono" fill="${t.primary}">anchor/</text>
  <text x="444" y="172" font-size="13" fill="${t.muted}">结构指纹 + 存储</text>
  <text x="444" y="192" font-size="12" class="mono" fill="${t.muted}">selector + fp + baseline crop</text>

  ${box(424, 214, 336, 102, true, false)}
  <text x="444" y="244" font-size="17" class="mono" fill="${t.primary}">oracle/</text>
  <text x="444" y="268" font-size="13" fill="${t.muted}">assert.eval + diff + verdict</text>
  <text x="444" y="290" font-size="12" class="mono" fill="${t.muted}">pixelmatch · includeAA:false</text>
  <text x="444" y="309" font-size="12" class="mono" fill="${t.primary}">DONE / NOT_DONE / UNSTABLE</text>

  ${box(800, 118, 336, 84, false, true)}
  <text x="820" y="148" font-size="17" class="mono" fill="${t.secondary}">annotate/</text>
  <text x="820" y="172" font-size="13" fill="${t.muted}">中文批注 → 断言草稿</text>
  <text x="820" y="192" font-size="12" fill="${t.muted}">可选：仅起草，判定不依赖它</text>

  ${box(800, 214, 336, 84, false, false)}
  <text x="820" y="244" font-size="17" class="mono" fill="${t.primary}">mcp/</text>
  <text x="820" y="268" font-size="13" fill="${t.muted}">nodepact.check / nodepact.list</text>
  <text x="820" y="288" font-size="12" fill="${t.muted}">coding agent 的最后一公里</text>

  ${box(800, 314, 336, 74, false, true)}
  <text x="820" y="340" font-size="12.5" fill="${t.muted}">providers · draft only</text>
  ${["deepseek", "qwen", "glm", "kimi"].map((p, i) => chip(t, 820 + i * 80, 350, 74, 26, p, { mono: true })).join("\n")}

  ${box(424, 328, 356, 152, false, false)}
  <text x="444" y="356" font-size="13.5" fill="${t.muted}">.nodepact/ · 全部状态落在本地，可私有化</text>
  <text x="444" y="386" font-size="13.5" class="mono" fill="${t.ink}">steer.yaml</text>
  <text x="444" y="410" font-size="13.5" class="mono" fill="${t.ink}">baseline/submit.png</text>
  <text x="444" y="434" font-size="13.5" class="mono" fill="${t.ink}">diffs/submit.after.png</text>
  <text x="444" y="462" font-size="12" fill="${t.muted}">锚点 + 批注 + 断言　　修复前裁剪　　差异图</text>

  <text x="40" y="540" font-size="13.5" fill="${t.muted}">没有守护进程、没有数据库、没有云端；判定读的是节点框内像素占比，截图会在节点四周多裁 capture_margin（默认 16px）。</text>
  <text x="40" y="570" font-size="13.5" fill="${t.muted}">DOM 漂移时选择器可能失效，结构指纹把节点找回来；两个候选打平就报 anchor_not_found，绝不猜。</text>
`);
}

// ------------------------------------------------------- capabilities / sit
function integrationsSvg(t, mobile = false) {
  const peers = [
    { zh: "spotnote", en: "把批注投递给 agent" },
    { zh: "reticle 一类", en: "让 agent 自证" },
    { zh: "Playwright / Percy", en: "CI 里比整页基线" },
    { zh: "chrome-devtools-mcp", en: "agent 读 DOM、截图" },
  ];
  if (mobile) {
    const W = 720, H = 890;
    return svg("Nodepact capabilities and integration", W, H, t, `  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  ${glowDefs(t)}
  ${backdrop(t, W, H, 23)}
  <text x="40" y="58" font-size="27" font-weight="600" fill="${t.ink}">它站在哪一层</text>

  <g filter="url(#glow)">
    <rect x="40" y="92" width="640" height="150" rx="16" fill="${t.panel}" stroke="${t.primary}" stroke-width="2.2"/>
  </g>
  <text x="360" y="140" text-anchor="middle" font-size="30" font-weight="700" fill="${t.ink}">Node<tspan fill="${t.primary}">pact</tspan></text>
  <text x="360" y="176" text-anchor="middle" font-size="15" fill="${t.muted}">你指的那个节点自己的渲染差异，就是验收信号</text>
  <text x="360" y="206" text-anchor="middle" font-size="13" class="mono" fill="${t.primary}">node-scoped diff · no model in the verdict</text>

  <text x="40" y="292" font-size="15" fill="${t.muted}">相邻工具各自负责的那一半</text>
  ${peers.map((p, i) => {
    const y = 312 + i * 128;
    return `<g>
      ${node(t, 40, y, 640, 104, { dashed: true })}
      <text x="64" y="${y + 44}" font-size="20" class="mono" fill="${t.ink}">${esc(p.zh)}</text>
      <text x="64" y="${y + 76}" font-size="14" fill="${t.muted}">${esc(p.en)}</text>
    </g>`;
  }).join("\n")}
  <text x="40" y="${H - 56}" font-size="14" fill="${t.muted}">检查面走同一条 CDP 通路，用 chrome-remote-interface 直接连上去。</text>
  <text x="40" y="${H - 26}" font-size="14" fill="${t.muted}">不做投递、不做整页回归、不做 agent 自证。</text>
`);
  }
  const W = 1200, H = 564, cx = 600, cy = 288;
  const angle = (i, n) => (i / n) * Math.PI * 2 - Math.PI / 2;
  const spokes = peers.map((p, i) => {
    const a = angle(i, peers.length);
    const nx = cx + Math.cos(a) * 330;
    const ny = cy + Math.sin(a) * 180;
    const mx = (cx + nx) / 2, my = (cy + ny) / 2;
    const dx = nx - cx, dy = ny - cy, len = Math.hypot(dx, dy);
    const ox = (-dy / len) * 24, oy = (dx / len) * 24;
    return { nx, ny, d: `M ${cx} ${cy} Q ${mx + ox} ${my + oy} ${nx} ${ny}`, i };
  });
  const nodes = spokes.map((s) => `<g>
    <rect x="${s.nx - 150}" y="${s.ny - 36}" width="300" height="72" rx="12" fill="${t.panel}" stroke="${t.line}" stroke-width="1.4"/>
    <text x="${s.nx}" y="${s.ny - 6}" text-anchor="middle" font-size="17" fill="${t.ink}">${esc(peers[s.i].zh)}</text>
    <text x="${s.nx}" y="${s.ny + 20}" text-anchor="middle" font-size="12.5" fill="${t.muted}">${esc(peers[s.i].en)}</text>
  </g>`).join("\n");
  return svg("Nodepact capabilities and integration", W, H, t, `  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  ${glowDefs(t)}
  ${backdrop(t, W, H, 23)}
  <text x="40" y="50" font-size="24" font-weight="600" fill="${t.ink}">能力与集成 <tspan fill="${t.muted}" font-size="16">· 相邻工具各占一半，Nodepact 补的是验收信号</tspan></text>

  ${spokes.map((s, i) => `<path d="${s.d}" fill="none" stroke="${i % 2 ? t.secondary : t.primary}" stroke-width="1.5" class="${i % 2 ? "flow-slow" : "flow"}" opacity="0.9"/>`).join("\n")}
  ${nodes}

  <g filter="url(#glow)">
    <circle cx="${cx}" cy="${cy}" r="112" fill="${t.panel}" stroke="${t.primary}" stroke-width="2.2"/>
    <circle cx="${cx}" cy="${cy}" r="140" fill="none" stroke="${t.line}" stroke-width="1" class="pulse"/>
  </g>
  <text x="${cx}" y="${cy - 18}" text-anchor="middle" font-size="27" font-weight="700" fill="${t.ink}">Node<tspan fill="${t.primary}">pact</tspan></text>
  <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="13" fill="${t.muted}">节点级验收信号</text>
  <text x="${cx}" y="${cy + 38}" text-anchor="middle" font-size="12.5" class="mono" fill="${t.primary}">node-scoped diff</text>
  <text x="${cx}" y="${cy + 58}" text-anchor="middle" font-size="12.5" class="mono" fill="${t.secondary}">no model in the verdict</text>

  <text x="40" y="${H - 20}" font-size="13" fill="${t.muted}">检查面走同一条 CDP 通路，用 chrome-remote-interface 直接连上去；不做投递、不做整页回归、不做 agent 自证。</text>
`);
}

// -------------------------------------------------------------- demo figures
function demoFigure(t, kind) {
  const W = 760, H = 300;
  const head = `  <rect width="${W}" height="${H}" fill="${t.bg}"/>
  ${glowDefs(t)}
  ${backdrop(t, W, H, 17)}
  <text x="30" y="42" font-size="19" font-weight="600" fill="${t.ink}">${esc(kind.title)}</text>
  <text x="30" y="66" font-size="13" class="mono" fill="${t.muted}">${esc(kind.en)}</text>`;

  if (kind.id === "init") {
    return svg("Nodepact demo: init", W, H, t, `${head}
  ${node(t, 30, 96, 300, 150, { hot: true })}
  <text x="50" y="128" font-size="15" fill="${t.muted}">开发者已开的 Chrome</text>
  <text x="50" y="158" font-size="16" class="mono" fill="${t.ink}">dev server 页面</text>
  <text x="50" y="190" font-size="12.5" class="mono" fill="${t.muted}">Nodepact 不启动浏览器</text>
  <text x="50" y="214" font-size="12.5" class="mono" fill="${t.secondary}">overlay.js 注入浮层</text>

  <path d="M 330 171 L 430 171" stroke="${t.primary}" stroke-width="2" class="flow" fill="none"/>
  <text x="380" y="156" text-anchor="middle" font-size="12.5" class="mono" fill="${t.primary}">CDP 9222</text>

  ${node(t, 430, 96, 300, 150, { hot: true })}
  <text x="450" y="128" font-size="15" fill="${t.muted}">本地 store</text>
  <text x="450" y="160" font-size="14" class="mono" fill="${t.ink}">nodepact.yaml</text>
  <text x="450" y="188" font-size="14" class="mono" fill="${t.ink}">.nodepact/</text>
  <text x="450" y="218" font-size="12.5" fill="${t.muted}">next: nodepact annotate</text>
`);
  }
  if (kind.id === "annotate") {
    return svg("Nodepact demo: annotate", W, H, t, `${head}
  ${formFragment(t, 40, 120, 4, { highlight: true })}
  <g>
    <rect x="410" y="104" width="320" height="70" rx="12" fill="${t.panel}" stroke="${t.primary}" stroke-width="1.6"/>
    <text x="428" y="132" font-size="13" fill="${t.muted}">annotation (zh)</text>
    <text x="428" y="158" font-size="14" fill="${t.ink}">提交按钮和上面的邮箱输入框太近了</text>
  </g>
  <g>
    <rect x="410" y="190" width="320" height="76" rx="12" fill="${t.code}" stroke="${t.secondary}" stroke-width="1.6"/>
    <text x="428" y="216" font-size="13" fill="${t.muted}">draft assertion · [y / edit / n]</text>
    <text x="428" y="246" font-size="14.5" class="mono" fill="${t.primary}">gap(#email, #submit) >= 12px</text>
  </g>
  <text x="40" y="272" font-size="12.5" class="mono" fill="${t.muted}">picked #submit  fp 99ceb4  ·  baseline 68x46</text>
`);
  }
  if (kind.id === "notdone" || kind.id === "stale") {
    const stale = kind.id === "stale";
    return svg(`Nodepact demo: ${kind.id}`, W, H, t, `${head}
  ${formFragment(t, 40, 120, 4, { highlight: true })}
  <g>
    <rect x="410" y="104" width="320" height="72" rx="12" fill="${t.code}" stroke="${t.line}" stroke-width="1.4"/>
    <text x="428" y="132" font-size="13" fill="${t.muted}">assertion · gap(#email, #submit) >= 12px</text>
    <text x="428" y="160" font-size="15" class="mono" fill="${t.ink}">before 4  after 4  ·  FAIL</text>
  </g>
  <g>
    <rect x="410" y="190" width="320" height="76" rx="12" fill="${t.panel}" stroke="${t.line}" stroke-width="1.4"/>
    <text x="428" y="218" font-size="13" fill="${t.muted}">render diff 0px (0.00%) · epsilon 1.00%</text>
    <text x="428" y="248" font-size="19" font-weight="600" class="mono" fill="${t.primary}">NOT_DONE</text>
  </g>
  <text x="40" y="272" font-size="12.5" class="mono" fill="${t.muted}">${stale ? "源码已改成 14px，但页面没有 HMR：Chrome 里还是旧的 4px" : "断言不成立：gap 4px >= 12px -> fail"}</text>
${stale ? `  <text x="410" y="288" font-size="12" fill="${t.secondary}">在 Chrome 里 Cmd-R / F5 刷新后再 check</text>` : ""}
`);
  }
  // done
  return svg("Nodepact demo: done", W, H, t, `${head}
  ${formFragment(t, 40, 108, 14, { highlight: true })}
  <g>
    <rect x="410" y="104" width="320" height="72" rx="12" fill="${t.code}" stroke="${t.line}" stroke-width="1.4"/>
    <text x="428" y="132" font-size="13" fill="${t.muted}">assertion · gap(#email, #submit) >= 12px</text>
    <text x="428" y="160" font-size="15" class="mono" fill="${t.ink}">before 4  after 14  ·  PASS</text>
  </g>
  <g>
    <rect x="410" y="190" width="320" height="76" rx="12" fill="${t.panel}" stroke="${t.primary}" stroke-width="1.8"/>
    <text x="428" y="218" font-size="13" fill="${t.muted}">render diff 165px / 7900px = 2.09%</text>
    <text x="428" y="248" font-size="19" font-weight="600" class="mono" fill="${t.primary}">DONE  ·  exit 0</text>
  </g>
  <text x="40" y="272" font-size="12.5" class="mono" fill="${t.muted}">断言成立，且这个节点相对基线变了 2.09%（≥ ε 1.00%）</text>
`);
}

// ----------------------------------------------------------------- main
const themes = { dark: palette.dark, light: palette.light };
const demoKinds = [
  { id: "init", title: "init：挂上你已开的 Chrome", en: "attach over CDP, write the local store" },
  { id: "annotate", title: "annotate：点选 + 中文批注 → 断言", en: "pick a node, annotate, confirm the assertion" },
  { id: "notdone", title: "check：还没改，NOT_DONE", en: "assertion FAIL, render diff 0px" },
  { id: "stale", title: "改完 CSS 但未刷新：仍是 NOT_DONE", en: "static server has no HMR; the page is still old" },
  { id: "done", title: "刷新后再 check：DONE", en: "assertion PASS and the node changed by 2.09%" },
];

fs.mkdirSync(OUT, { recursive: true });
const written = [];
const w = (name, content) => {
  fs.writeFileSync(path.join(OUT, name), content);
  written.push(name);
};
for (const [suffix, t] of Object.entries(themes)) {
  w(`hero-static-${suffix}.svg`, heroStill(t));
  w(`process-${suffix}.svg`, processSvg(t, false));
  w(`process-mobile-${suffix}.svg`, processSvg(t, true));
  w(`architecture-${suffix}.svg`, architectureSvg(t, false));
  w(`architecture-mobile-${suffix}.svg`, architectureSvg(t, true));
  w(`integrations-${suffix}.svg`, integrationsSvg(t, false));
  w(`integrations-mobile-${suffix}.svg`, integrationsSvg(t, true));
  for (const k of demoKinds) w(`demo-${k.id}-${suffix}.svg`, demoFigure(t, k));
}
console.log(`wrote ${written.length} SVGs to web/assets/presentation/`);
