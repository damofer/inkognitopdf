// Spec 030: geometry of the straightening animation.
import { describe, expect, it } from "vitest";
import type { Point, Quad } from "../../src/scan/homography";
import {
  cornersAt,
  cssMatrix,
  ease,
  fitIn,
  morphEnds,
  pageAspect,
} from "../../src/scan/morph";

const photo = { width: 4000, height: 3000 };
const quad: Quad = [
  { x: 1500, y: 700 },
  { x: 2900, y: 760 },
  { x: 3300, y: 2600 },
  { x: 600, y: 2300 },
];
const box = { width: 400, height: 700 };

/** Applies a CSS matrix3d (column-major) to a point of the plane. */
function apply(css: string, p: Point): Point {
  const m = css.slice("matrix3d(".length, -1).split(",").map(Number);
  const w = m[3]! * p.x + m[7]! * p.y + m[15]!;
  expect(w).toBeGreaterThan(0);
  return {
    x: (m[0]! * p.x + m[4]! * p.y + m[12]!) / w,
    y: (m[1]! * p.x + m[5]! * p.y + m[13]!) / w,
  };
}

const close = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("straightening animation (spec 030)", () => {
  it("starts where the crop screen shows the sheet (CA1)", () => {
    const { photo: shown, start } = morphEnds(quad, photo, box, 0.7, 0);
    expect(shown).toEqual({ x: 0, y: 200, width: 400, height: 300 });
    close(start[0], { x: 150, y: 270 });
    close(start[2], { x: 330, y: 460 });
  });

  it("ends on the page's rectangle, turned with the page (CA1, CA4)", () => {
    const { end } = morphEnds(quad, photo, box, 0.5, 0);
    expect(end).toEqual([
      { x: 25, y: 0 },
      { x: 375, y: 0 },
      { x: 375, y: 700 },
      { x: 25, y: 700 },
    ]);
    // One turn clockwise: the page's top-left corner is at the top right.
    const turned = morphEnds(quad, photo, box, 2, 1).end;
    expect(turned[0]).toEqual({ x: 400, y: 250 });
    expect(turned[3]).toEqual({ x: 0, y: 250 });
  });

  it("moves the corners in straight lines, slow at both ends", () => {
    const { start, end } = morphEnds(quad, photo, box, 0.7, 0);
    expect(cornersAt(start, end, 0)).toEqual(start);
    expect(cornersAt(start, end, 1)).toEqual(end);
    const mid = cornersAt(start, end, 0.5);
    for (let i = 0; i < 4; i++) {
      close(mid[i]!, {
        x: (start[i]!.x + end[i]!.x) / 2,
        y: (start[i]!.y + end[i]!.y) / 2,
      });
    }
    expect(ease(0.1)).toBeLessThan(0.1);
    expect(ease(0.9)).toBeGreaterThan(0.9);
  });

  it("puts each corner of the photo's sheet where the frame says", () => {
    const { start, end } = morphEnds(quad, photo, box, 0.7, 0);
    const k = 0.1;
    const local = quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad;
    for (const t of [0, 0.3, 0.7, 1]) {
      const to = cornersAt(start, end, t);
      const css = cssMatrix(local, to)!;
      for (let i = 0; i < 4; i++) close(apply(css, local[i]!), to[i]!);
    }
  });

  it("knows the page's shape before it is processed", () => {
    // A4 portrait seen straight on.
    const a4: Quad = [
      { x: 0, y: 0 },
      { x: 2100, y: 0 },
      { x: 2100, y: 2970 },
      { x: 0, y: 2970 },
    ];
    const size = { width: 2100, height: 2970 };
    expect(pageAspect(a4, size, "auto", 0)).toBeCloseTo(595.28 / 841.89, 3);
    expect(pageAspect(a4, size, "auto", 1)).toBeCloseTo(841.89 / 595.28, 3);
    expect(fitIn({ width: 100, height: 100 }, 2)).toEqual({
      x: 0,
      y: 25,
      width: 100,
      height: 50,
    });
  });
});
