/**
 * Pixel diff between the baseline crop and the current crop of the same node.
 *
 * Both crops come from `Page.captureScreenshot` with a clip rounded outward to whole pixels,
 * so sizes normally match. When they do not — the node grew or shrank, which is itself a
 * change — both images are padded onto the union canvas before comparing, so a resize can
 * never be mistaken for "nothing happened".
 *
 * Antialiasing is not treated as a change (`includeAA: false`): the pixel diff is corroboration
 * that the node was touched, not the primary signal.
 */
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export type DiffResult = {
  changedPx: number;
  totalPx: number;
  /** Fraction of the union canvas that changed, 0..1. */
  ratio: number;
  /** PNG of the diff mask, written next to the crop as the visual artifact. */
  maskPng: Buffer;
  width: number;
  height: number;
};

export type DiffOptions = {
  /** pixelmatch per-pixel colour tolerance (0..1). */
  pixelThreshold?: number;
};

function padTo(png: PNG, width: number, height: number): Uint8Array {
  if (png.width === width && png.height === height) return png.data;
  const padded = Buffer.alloc(width * height * 4);
  for (let y = 0; y < png.height; y++) {
    png.data.copy(padded, y * width * 4, y * png.width * 4, (y + 1) * png.width * 4);
  }
  return padded;
}

export function diffPng(baselinePng: Buffer, afterPng: Buffer, options: DiffOptions = {}): DiffResult {
  const baseline = PNG.sync.read(baselinePng);
  const after = PNG.sync.read(afterPng);
  const width = Math.max(baseline.width, after.width);
  const height = Math.max(baseline.height, after.height);
  const mask = new PNG({ width, height });

  const changedPx = pixelmatch(
    padTo(baseline, width, height),
    padTo(after, width, height),
    mask.data,
    width,
    height,
    { threshold: options.pixelThreshold ?? 0.1, includeAA: false },
  );

  const totalPx = width * height;
  return {
    changedPx,
    totalPx,
    ratio: totalPx === 0 ? 0 : changedPx / totalPx,
    maskPng: PNG.sync.write(mask),
    width,
    height,
  };
}
