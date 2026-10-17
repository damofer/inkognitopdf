// Spec 020: when the live camera takes a page, and the ID card page.
import { describe, expect, it } from "vitest";
import type { Quad } from "../../src/scan/homography";
import type { Rgba } from "../../src/scan/image";
import {
  CARD_SIZE,
  composeIdPage,
  pageSignature,
  pageSize,
  rectify,
  rgbaToBitmap,
  type Enhanced,
} from "../../src/scan/pipeline";
import {
  SteadyTracker,
  cornerMove,
  signatureDistance,
} from "../../src/scan/steady";
import { synthPhoto, testPage, type TestPage } from "./synthPhoto";

const square = (x: number, y: number, size = 100): Quad => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];
const DIAGONAL = 800;
const frame = (quad: Quad | null, signature?: Float32Array) => ({
  quad,
  diagonal: DIAGONAL,
  signature,
});

describe("SteadyTracker", () => {
  it("takes a page once it has held still, then waits for the next", () => {
    const tracker = new SteadyTracker();
    expect(tracker.feed(frame(null), 0)).toEqual({ state: "searching" });
    expect(tracker.feed(frame(square(10, 10)), 100)).toEqual({
      state: "steadying",
      progress: 0,
    });
    // A few pixels of hand shake still count as still.
    const shaking = tracker.feed(frame(square(13, 8)), 500);
    expect(shaking.state).toBe("steadying");
    expect((shaking as { progress: number }).progress).toBeCloseTo(0.5);
    expect(tracker.feed(frame(square(11, 11)), 900)).toEqual({
      state: "capture",
    });
    // The same sheet, however long it stays, is not taken again.
    for (let t = 1000; t < 5000; t += 200)
      expect(tracker.feed(frame(square(11, 11)), t).state).toBe("waiting");
    // Taken away and a new sheet put down: taken after holding still.
    expect(tracker.feed(frame(null), 5000).state).toBe("searching");
    expect(tracker.feed(frame(square(30, 20)), 5100).state).toBe("steadying");
    expect(tracker.feed(frame(square(30, 20)), 5950).state).toBe("capture");
  });

  it("starts again when the page moves", () => {
    const tracker = new SteadyTracker();
    tracker.feed(frame(square(10, 10)), 0);
    expect(tracker.feed(frame(square(60, 10)), 700)).toEqual({
      state: "steadying",
      progress: 0,
    });
    expect(tracker.feed(frame(square(60, 10)), 1400).state).toBe("steadying");
    expect(tracker.feed(frame(square(60, 10)), 1500).state).toBe("capture");
  });

  it("notices a new sheet put down in the same place", () => {
    const tracker = new SteadyTracker();
    const a = Float32Array.from({ length: 16 }, (_, i) => (i % 2 ? 1 : -1));
    const b = Float32Array.from({ length: 16 }, (_, i) => (i < 8 ? 1 : -1));
    tracker.feed(frame(square(10, 10), a), 0);
    expect(tracker.feed(frame(square(10, 10), a), 800).state).toBe("capture");
    expect(tracker.feed(frame(square(10, 10), a), 1500).state).toBe("waiting");
    expect(tracker.feed(frame(square(10, 10), b), 2000).state).toBe(
      "steadying",
    );
    expect(tracker.feed(frame(square(10, 10), b), 2800).state).toBe("capture");
  });

  it("a page moved far counts as a new one", () => {
    const tracker = new SteadyTracker();
    tracker.feed(frame(square(10, 10)), 0);
    tracker.feed(frame(square(10, 10)), 800);
    expect(tracker.feed(frame(square(20, 10)), 1000).state).toBe("waiting");
    expect(tracker.feed(frame(square(300, 10)), 1200).state).toBe("steadying");
  });

  it("without the automatic shutter, only shows that the page is still", () => {
    const tracker = new SteadyTracker();
    tracker.feed(frame(square(10, 10)), 0, false);
    expect(tracker.feed(frame(square(10, 10)), 2000, false)).toEqual({
      state: "steadying",
      progress: 1,
    });
    // A photo taken by hand also waits for the next sheet.
    tracker.took(square(10, 10), null, 2100);
    expect(tracker.feed(frame(square(10, 10)), 2200).state).toBe("waiting");
  });

  it("leaves a gap between two pages", () => {
    const tracker = new SteadyTracker({ gapMs: 1500 });
    tracker.feed(frame(square(10, 10)), 0);
    expect(tracker.feed(frame(square(10, 10)), 800).state).toBe("capture");
    tracker.feed(frame(null), 850);
    tracker.feed(frame(square(10, 10)), 900);
    expect(tracker.feed(frame(square(10, 10)), 1700).state).toBe("steadying");
    expect(tracker.feed(frame(square(10, 10)), 2300).state).toBe("capture");
  });

  it("measures corner moves and signature differences", () => {
    expect(cornerMove(square(0, 0), square(3, 4))).toBe(5);
    const a = Float32Array.from([1, -1, 1, -1]);
    expect(signatureDistance(a, a)).toBe(0);
    expect(signatureDistance(a, Float32Array.from([-1, 1, -1, 1]))).toBe(2);
  });
});

/** The test page with a different block of content: another sheet. */
function otherPage(page: TestPage): TestPage {
  const data = Float32Array.from(page.page.data);
  const { width, height } = page.page;
  for (let y = Math.round(height * 0.35); y < height * 0.75; y++)
    for (let x = Math.round(width * 0.15); x < width * 0.85; x++)
      data[y * width + x] = (x >> 4) % 2 ? 20 : 255 - data[y * width + x]!;
  return { ...page, page: { width, height, data } };
}

describe("page signature", () => {
  const page = testPage(60);
  it("is alike for the same sheet in another light, unlike for another sheet", () => {
    const one = synthPhoto({ seed: 11, page, width: 640, height: 480 });
    const again = synthPhoto({
      seed: 11,
      page,
      width: 640,
      height: 480,
      shadow: 0.5,
      paper: 210,
      noise: 8,
    });
    const other = synthPhoto({
      seed: 11,
      page: otherPage(page),
      width: 640,
      height: 480,
    });
    const sig = (p: typeof one) => pageSignature(p.photo, p.corners);
    const same = signatureDistance(sig(one), sig(again));
    const different = signatureDistance(sig(one), sig(other));
    expect(same).toBeLessThan(0.3);
    expect(different).toBeGreaterThan(1);
  });
});

const solid = (width: number, height: number, value: number): Rgba => ({
  width,
  height,
  data: new Uint8ClampedArray(width * height * 4).fill(value),
});

describe("ID card mode", () => {
  it("rectifies a card at its real size, landscape or portrait", () => {
    expect(pageSize(1.6, "card")).toEqual({
      widthPt: CARD_SIZE[1],
      heightPt: CARD_SIZE[0],
    });
    expect(pageSize(0.63, "card")).toEqual({
      widthPt: CARD_SIZE[0],
      heightPt: CARD_SIZE[1],
    });
    const photo = solid(400, 300, 200);
    const card = rectify(
      photo,
      [
        { x: 40, y: 50 },
        { x: 360, y: 50 },
        { x: 360, y: 250 },
        { x: 40, y: 250 },
      ],
      "card",
    );
    // 85.6 × 53.98 mm at 200 pixels per inch.
    expect(card.image.width).toBe(674);
    expect(card.image.height).toBe(425);
  });

  it("puts both sides on one A4 page, centred, at their real size", () => {
    const front: Enhanced = { mode: "original", image: solid(674, 425, 0) };
    const back: Enhanced = { mode: "original", image: solid(674, 425, 100) };
    const page = composeIdPage([front, back]);
    expect(page.mode).toBe("original");
    expect(page.image.width).toBe(1654);
    expect(page.image.height).toBe(2339);
    const at = (x: number, y: number) =>
      page.image.data[(y * page.image.width + x) * 4];
    const left = Math.round((1654 - 674) / 2);
    const top = Math.round((30 / 25.4) * 200);
    expect(at(left - 1, top + 10)).toBe(255);
    expect(at(left, top)).toBe(0);
    expect(at(left + 673, top + 424)).toBe(0);
    expect(at(left + 674, top + 10)).toBe(255);
    // 15 mm below the front, the back.
    const gap = Math.round((15 / 25.4) * 200);
    expect(at(left + 10, top + 425 + gap - 1)).toBe(255);
    expect(at(left + 10, top + 425 + gap)).toBe(100);
    expect(at(800, 2300)).toBe(255);
  });

  it("stays black and white only when every side is", () => {
    const bw = (value: number): Enhanced => {
      const image = solid(16, 8, value);
      return { mode: "bw", image, bitmap: rgbaToBitmap(image) };
    };
    const page = composeIdPage([bw(0), bw(255)]);
    expect(page.mode).toBe("bw");
    const gray: Enhanced = {
      mode: "gray",
      image: solid(16, 8, 90),
      gray: { width: 16, height: 8, data: new Float32Array(128).fill(90) },
    };
    expect(composeIdPage([bw(0), gray]).mode).toBe("gray");
    expect(
      composeIdPage([gray, { mode: "original", image: solid(16, 8, 3) }]).mode,
    ).toBe("original");
    // A single side (an odd photo) is fine too.
    expect(composeIdPage([gray]).image.width).toBe(1654);
  });

  it("packs a black and white image as a PDF bitmap (1 = white)", () => {
    const image = solid(10, 2, 255);
    image.data.fill(0, 0, 4); // first pixel black
    const bitmap = rgbaToBitmap(image);
    expect(bitmap.width).toBe(10);
    expect(Array.from(bitmap.data)).toEqual([0x7f, 0xc0, 0xff, 0xc0]);
  });
});
