/**
 * The CDP clip mapping.
 *
 * An anchor box is `{x, y, w, h}` in CSS pixels; `Page.captureScreenshot` wants a `Viewport`
 * `{x, y, width, height, scale}`. `toClip` is the only place that mapping happens, and it is what
 * makes the crop deterministic: rounded outward to whole pixels, widened by the capture margin.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { captureNode, toClip } from "../dist/cdp/snapshot.js";

const box = (x, y, w, h) => ({ x, y, w, h });

test("maps a box to a clip with no margin", () => {
  assert.deepEqual(toClip(box(100, 50, 68, 46)), { x: 100, y: 50, width: 68, height: 46, scale: 1 });
});

test("the margin widens the crop so a node that only moves is still visible", () => {
  assert.deepEqual(toClip(box(100, 50, 68, 46), 1, 16), {
    x: 84,
    y: 34,
    width: 100,
    height: 78,
    scale: 1,
  });
});

test("the documented demo crop is 100x79, the 7900 pixels the demo quotes", () => {
  // The baseline box of the demo anchor: 68x46 at (431, 226.59...), margin 16, scale 1.
  const clip = toClip(box(431, 226.59375, 68, 46), 1, 16);
  assert.deepEqual(clip, { x: 415, y: 210, width: 100, height: 79, scale: 1 });
  assert.equal(clip.width * clip.height, 7900);
});

test("fractional geometry is rounded outward, never cropped inward", () => {
  const clip = toClip(box(431.4, 226.59, 68, 46), 1, 16);
  assert.deepEqual(clip, { x: 415, y: 210, width: 101, height: 79, scale: 1 });
  // Outward rounding: the clip covers the node plus the whole margin.
  assert.ok(clip.x <= 431.4 - 16 && clip.y <= 226.59 - 16);
  assert.ok(clip.x + clip.width >= 431.4 + 68 + 16);
});

test("a node at the page origin never produces a negative or zero-size clip", () => {
  assert.deepEqual(toClip(box(5, 5, 10, 10), 1, 16), { x: 0, y: 0, width: 31, height: 31, scale: 1 });
  assert.deepEqual(toClip(box(0, 0, 0, 0)), { x: 0, y: 0, width: 1, height: 1, scale: 1 });
});

test("the scale is passed through untouched", () => {
  assert.equal(toClip(box(0, 0, 10, 10), 2, 0).scale, 2);
  assert.equal(toClip(box(0, 0, 10, 10), 0.5, 0).scale, 0.5);
});

test("captureNode sends the mapped clip and returns the decoded PNG bytes", async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let request;
  const page = {
    client: {
      Page: {
        async captureScreenshot(options) {
          request = options;
          return { data: bytes.toString("base64") };
        },
      },
    },
  };

  const captured = await captureNode(page, box(431, 226.59375, 68, 46), { scale: 1, margin: 16 });
  assert.deepEqual(request, {
    format: "png",
    clip: { x: 415, y: 210, width: 100, height: 79, scale: 1 },
    captureBeyondViewport: false,
  });
  assert.deepEqual(captured, bytes);
});

test("captureNode defaults to scale 1 and no margin", async () => {
  let request;
  const page = {
    client: {
      Page: {
        async captureScreenshot(options) {
          request = options;
          return { data: Buffer.alloc(0).toString("base64") };
        },
      },
    },
  };
  await captureNode(page, box(10, 20, 30, 40));
  assert.deepEqual(request.clip, { x: 10, y: 20, width: 30, height: 40, scale: 1 });
});
