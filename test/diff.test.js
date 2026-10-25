/**
 * The render diff: baseline crop vs current crop, and the ratio epsilon is compared against.
 *
 * The 100x79 / 165-changed-pixel case is the documented demo number (165 / 7900 = 2.09%), so the
 * test pins the arithmetic the README quotes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { diffPng } from "../dist/oracle/diff.js";

/** A solid PNG of `width` x `height`, filled with `[r, g, b, a]`. */
function solid(width, height, [r, g, b, a = 255]) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = a;
  }
  return PNG.sync.write(png);
}

/** The same PNG with the first `count` pixels repainted. */
function withChangedPixels(width, height, count, [r, g, b, a = 255]) {
  const png = new PNG.sync.read(solid(width, height, [255, 255, 255]));
  for (let i = 0; i < count; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = a;
  }
  return PNG.sync.write(png);
}

test("identical crops differ by nothing", () => {
  const png = solid(40, 20, [37, 99, 235]);
  const result = diffPng(png, png);
  assert.equal(result.changedPx, 0);
  assert.equal(result.totalPx, 800);
  assert.equal(result.ratio, 0);
  assert.equal(result.width, 40);
  assert.equal(result.height, 20);
  // The mask is a real PNG so it can be written next to the crop as the visual artifact.
  assert.equal(PNG.sync.read(result.maskPng).width, 40);
});

test("the documented demo crop: 165 changed pixels of 7900 is 2.09%", () => {
  const baseline = solid(100, 79, [255, 255, 255]);
  const after = withChangedPixels(100, 79, 165, [17, 24, 39]);
  const result = diffPng(baseline, after);
  assert.equal(result.changedPx, 165);
  assert.equal(result.totalPx, 7900);
  assert.equal(Number(result.ratio.toFixed(4)), 0.0209);
  assert.ok(result.ratio >= 0.01, "2.09% clears the default epsilon of 1%");
});

/** A `size` x `size` PNG: a white square of `core` x `core` in the top-left, `band` elsewhere. */
function framed(size, core, band) {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = x < core && y < core ? [255, 255, 255] : band;
      const i = (y * size + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

test("a crop that grew is compared on the union canvas, so the growth is not lost", () => {
  const result = diffPng(framed(4, 4, [17, 24, 39]), framed(6, 4, [17, 24, 39]));
  assert.equal(result.width, 6);
  assert.equal(result.height, 6);
  assert.equal(result.totalPx, 36);
  assert.equal(result.changedPx, 20, "the band the smaller crop never covered counts as changed");
  assert.equal(Number(result.ratio.toFixed(4)), 0.5556);
});

test("a crop that shrank is padded the same way", () => {
  const result = diffPng(framed(6, 4, [17, 24, 39]), framed(4, 4, [17, 24, 39]));
  assert.equal(result.width, 6);
  assert.equal(result.height, 6);
  assert.equal(result.totalPx, 36);
  assert.equal(result.changedPx, 20);
});

test("the padding is transparent, which pixelmatch blends over white", () => {
  // Worth pinning: a crop that only grew into white background produces no pixel diff by itself.
  // The pixel diff is corroboration; the geometry assertions (gap/style) are the primary signal.
  const result = diffPng(solid(4, 4, [255, 255, 255]), solid(6, 6, [255, 255, 255]));
  assert.equal(result.width, 6);
  assert.equal(result.totalPx, 36);
  assert.equal(result.changedPx, 0);
});

test("the per-pixel colour tolerance is honoured", () => {
  const baseline = solid(8, 8, [0, 0, 0]);
  const after = solid(8, 8, [10, 10, 10]);
  assert.equal(diffPng(baseline, after, { pixelThreshold: 0 }).changedPx, 64);
  assert.equal(diffPng(baseline, after, { pixelThreshold: 1 }).changedPx, 0);
});

test("antialiasing is not treated as a change", () => {
  // A one-pixel lightening of an edge is exactly what includeAA:false exists to ignore.
  const png = PNG.sync.read(solid(16, 16, [255, 255, 255]));
  const after = PNG.sync.read(solid(16, 16, [255, 255, 255]));
  after.data[0] = 250;
  after.data[1] = 250;
  after.data[2] = 250;
  assert.equal(diffPng(PNG.sync.write(png), PNG.sync.write(after)).changedPx, 0);
});
