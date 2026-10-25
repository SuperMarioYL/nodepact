/**
 * Nodepact annotation overlay.
 *
 * Plain browser JavaScript, no bundler and no build step: the CLI reads this file and evaluates
 * it in the page over CDP (`nodepact annotate`). It is deliberately dumb about identity — it
 * tags the clicked element with `data-nodepact-pick` and hands the id back to the CLI, which
 * then computes the stable selector and the structural fingerprint with its own code, so the
 * fingerprint algorithm exists in exactly one place.
 *
 * Page -> CLI messages (JSON strings over the `__nodepactSend` binding):
 *   { type: "ready" }
 *   { type: "pick",   pick_id: "1" }
 *   { type: "submit", pick_id: "1", annotation: "提交按钮和上面的邮箱输入框太近了" }
 *   { type: "cancel" }
 *
 * CLI -> page calls: window.__nodepactOverlay.confirmPick({...}) / fail(text) / finish(text) /
 * release(pickId) / destroy().
 */
(function () {
  "use strict";

  var PANEL_ID = "nodepact-panel";
  var HIGHLIGHT_ID = "nodepact-highlight";
  var PICK_ATTR = "data-nodepact-pick";
  var PANEL_FONT =
    "13px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif";

  var previous = window.__nodepactOverlay;
  if (previous && typeof previous.destroy === "function") {
    try {
      previous.destroy();
    } catch (error) {
      /* a half-torn-down overlay must not block a new one */
    }
  }

  function send(payload) {
    if (typeof window.__nodepactSend === "function") {
      window.__nodepactSend(JSON.stringify(payload));
      return;
    }
    // Fallback for a page where the binding was not installed: the CLI can still drain this.
    window.__nodepactOutbox = window.__nodepactOutbox || [];
    window.__nodepactOutbox.push(payload);
  }

  function element(tag, styleText, text) {
    var el = document.createElement(tag);
    if (styleText) el.setAttribute("style", styleText);
    if (text) el.textContent = text;
    return el;
  }

  var highlight = element(
    "div",
    "position:fixed;z-index:2147483646;pointer-events:none;box-sizing:border-box;" +
      "border:2px solid #2563eb;background:rgba(37,99,235,0.12);border-radius:3px;display:none",
  );
  highlight.id = HIGHLIGHT_ID;

  var panel = element(
    "div",
    "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;box-sizing:border-box;" +
      "padding:12px 12px 10px;border-radius:10px;background:#111827;color:#e5e7eb;" +
      "box-shadow:0 12px 32px rgba(0,0,0,0.38);font:" +
      PANEL_FONT,
  );
  panel.id = PANEL_ID;

  var title = element("div", "font-weight:600;color:#f9fafb;margin-bottom:6px", "Nodepact");
  var status = element("div", "color:#9ca3af;margin-bottom:8px;white-space:pre-wrap;word-break:break-all", "click a node ...");
  var textarea = element(
    "textarea",
    "width:100%;box-sizing:border-box;height:64px;resize:vertical;border-radius:6px;border:1px solid #374151;" +
      "background:#0b1220;color:#e5e7eb;padding:6px 8px;font:" +
      PANEL_FONT,
  );
  textarea.setAttribute("placeholder", "写下你对这个节点的意见，例如：提交按钮和上面的邮箱输入框太近了");
  textarea.disabled = true;

  var actions = element("div", "display:flex;gap:8px;margin-top:8px;align-items:center");
  var submit = element(
    "button",
    "flex:0 0 auto;border:0;border-radius:6px;padding:6px 12px;background:#2563eb;color:#fff;cursor:pointer;font:" +
      PANEL_FONT,
    "提交 (Enter)",
  );
  var cancel = element(
    "button",
    "flex:0 0 auto;border:1px solid #374151;border-radius:6px;padding:6px 12px;background:transparent;color:#9ca3af;cursor:pointer;font:" +
      PANEL_FONT,
    "取消 (Esc)",
  );
  submit.disabled = true;

  actions.appendChild(submit);
  actions.appendChild(cancel);
  panel.appendChild(title);
  panel.appendChild(status);
  panel.appendChild(textarea);
  panel.appendChild(actions);
  document.body.appendChild(highlight);
  document.body.appendChild(panel);

  var pickSeq = 0;
  var pickId = null;
  var pickedElement = null;
  var done = false;

  function describe(el) {
    var label = el.tagName.toLowerCase();
    if (el.id) label += "#" + el.id;
    var text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 32);
    return text ? label + ' "' + text + '"' : label;
  }

  function setStatus(text, color) {
    status.textContent = text;
    status.style.color = color || "#9ca3af";
  }

  function insidePanel(target) {
    if (!target || target.nodeType !== 1) return true;
    if (target === highlight) return true;
    return !!(target.closest && target.closest("#" + PANEL_ID));
  }

  function paintHighlight(el) {
    if (!el || el === document.documentElement || el === document.body) {
      highlight.style.display = "none";
      return;
    }
    var rect = el.getBoundingClientRect();
    highlight.style.display = "block";
    highlight.style.left = rect.left + "px";
    highlight.style.top = rect.top + "px";
    highlight.style.width = rect.width + "px";
    highlight.style.height = rect.height + "px";
  }

  function onMouseMove(event) {
    if (done || pickedElement) return;
    if (insidePanel(event.target)) {
      highlight.style.display = "none";
      return;
    }
    paintHighlight(event.target);
  }

  function onMouseDown(event) {
    if (insidePanel(event.target)) return;
    // Keep the page from stealing focus or starting a text selection while picking.
    event.preventDefault();
    event.stopPropagation();
  }

  function onMouseUp(event) {
    if (insidePanel(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      send({ type: "cancel" });
      setStatus("cancelled");
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && event.target === textarea) {
      event.preventDefault();
      event.stopPropagation();
      onSubmit();
    }
  }

  function pick(target) {
    if (done || pickedElement || insidePanel(target)) return;
    if (target === document.documentElement || target === document.body) return;
    pickSeq += 1;
    pickId = String(pickSeq);
    pickedElement = target;
    target.setAttribute(PICK_ATTR, pickId);
    paintHighlight(target);
    setStatus("resolving " + describe(target) + " ...");
    send({ type: "pick", pick_id: pickId });
  }

  function onClick(event) {
    if (insidePanel(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    pick(event.target);
  }

  function onSubmit() {
    if (done || !pickedElement) return;
    var annotation = textarea.value.replace(/\s+/g, " ").trim();
    if (!annotation) {
      setStatus("写一句批注再提交（Enter），或按 Esc 取消", "#fca5a5");
      textarea.focus();
      return;
    }
    send({ type: "submit", pick_id: pickId, annotation: annotation });
    finish(annotation);
  }

  function finish(annotation) {
    done = true;
    textarea.disabled = true;
    submit.disabled = true;
    highlight.style.display = "none";
    setStatus('已提交：' + annotation + "\n回到终端确认断言", "#86efac");
  }

  function releasePick(id) {
    var el = document.querySelector("[" + PICK_ATTR + '="' + String(id) + '"]');
    if (el) el.removeAttribute(PICK_ATTR);
  }

  function removeListeners() {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("mousedown", onMouseDown, true);
    document.removeEventListener("mouseup", onMouseUp, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    submit.removeEventListener("click", onSubmit);
    cancel.removeEventListener("click", onCancel);
  }

  function onCancel() {
    send({ type: "cancel" });
    setStatus("cancelled");
  }

  function destroy() {
    removeListeners();
    var leftovers = document.querySelectorAll("[" + PICK_ATTR + "]");
    for (var i = 0; i < leftovers.length; i++) leftovers[i].removeAttribute(PICK_ATTR);
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    if (highlight.parentNode) highlight.parentNode.removeChild(highlight);
    window.__nodepactOverlay = null;
  }

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("mousedown", onMouseDown, true);
  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  submit.addEventListener("click", onSubmit);
  cancel.addEventListener("click", onCancel);

  window.__nodepactOverlay = {
    alive: true,
    confirmPick: function (info) {
      if (!info) return;
      var size = info.width && info.height ? " (" + info.width + "x" + info.height + ")" : "";
      setStatus(
        "picked " + info.selector + size + (info.fp_hash ? "  fp " + info.fp_hash : "") + "\n写下批注，Enter 提交",
        "#86efac",
      );
      textarea.disabled = false;
      submit.disabled = false;
      textarea.focus();
    },
    fail: function (text) {
      setStatus(String(text), "#fca5a5");
      textarea.disabled = false;
      submit.disabled = false;
    },
    finish: finish,
    release: releasePick,
    destroy: destroy,
  };

  send({ type: "ready", anchors: (window.__nodepactBoot && window.__nodepactBoot.anchors) || [] });
})();
