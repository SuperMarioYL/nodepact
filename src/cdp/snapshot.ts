/**
 * Reading a node out of the page: geometry, computed style, and pixels.
 *
 * The screenshot goes through `Page.captureScreenshot` with a `clip` in the protocol's
 * `Viewport` shape (`{x, y, width, height, scale}`), which is not the same shape as the
 * anchor box (`{x, y, w, h}`) — `toClip` is the only place that mapping happens.
 *
 * Clip coordinates are page coordinates (scroll included) and the clip is rounded outward to
 * whole pixels at scale 1, so the same node always yields the same crop size and the baseline
 * and the re-check cannot drift apart by a sub-pixel.
 */
import type { PageBridge } from "./attach.js";
import type { Box } from "../anchor/fingerprint.js";
import type { MeasureSource } from "../oracle/assert.js";

/** The CDP `Viewport` shape used by `Page.captureScreenshot`. */
export type CaptureClip = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

/** Wait for fonts and one paint before reading the page, so the crop is not a half-rendered frame. */
const SETTLE_MS = 80;

/**
 * Map a node box to a CDP clip.
 *
 * `margin` widens the crop around the node, and it is not cosmetic: a crop tight to the node
 * travels with the node, so a fix that only *moves* the node (which is what a `gap` annotation
 * asks for) would produce a zero pixel diff and the verdict formula could never reach DONE.
 * The margin gives the crop enough of the node's neighbourhood to see the movement.
 */
export function toClip(box: Box, scale = 1, margin = 0): CaptureClip {
  const x = Math.floor(Math.max(0, box.x - margin));
  const y = Math.floor(Math.max(0, box.y - margin));
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(box.x + box.w + margin) - x),
    height: Math.max(1, Math.ceil(box.y + box.h + margin) - y),
    scale,
  };
}

/** Capture one node's crop as a PNG buffer. */
export async function captureNode(
  page: PageBridge,
  box: Box,
  options: { scale?: number; margin?: number } = {},
): Promise<Buffer> {
  const clip = toClip(box, options.scale ?? 1, options.margin ?? 0);
  const { data } = await page.client.Page.captureScreenshot({
    format: "png",
    clip,
    captureBeyondViewport: false,
  });
  return Buffer.from(data, "base64");
}

/**
 * Scroll a node into view, let fonts and layout settle, and return its box in page
 * coordinates. Used before every capture so a node below the fold is still croppable.
 */
export async function focusNode(page: PageBridge, selector: string): Promise<Box> {
  const box = await page.evaluate<Box | null>(`(async function () {
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "center", inline: "center" });
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (error) { /* fonts API is best effort */ }
    }
    await new Promise(function (resolve) { setTimeout(resolve, ${SETTLE_MS}); });
    var rect = el.getBoundingClientRect();
    return {
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      w: rect.width,
      h: rect.height
    };
  })()`);
  if (!box) throw new Error(`node not found in the page: ${selector}`);
  return box;
}

/**
 * The page as an assertion measurement source.
 *
 * `viewportRect` is intentionally viewport-relative (no scroll offset): a gap is a distance
 * between two boxes on screen, and mixing in the scroll position would change it. The anchor
 * box used for cropping is the document-relative one from {@link focusNode}.
 */
export function createMeasurer(page: PageBridge): MeasureSource {
  return {
    async viewportRect(selector: string): Promise<Box | null> {
      return page.evaluate<Box | null>(`(function () {
        var el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      })()`);
    },
    async computedStyle(selector: string, property: string): Promise<string | null> {
      return page.evaluate<string | null>(`(function () {
        var el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        return getComputedStyle(el).getPropertyValue(${JSON.stringify(property)}).trim();
      })()`);
    },
  };
}
