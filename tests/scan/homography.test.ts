// Spec 002, CA4: perspective correction on synthetic photos.
import { describe, expect, it } from "vitest";
import { detectPage } from "../../src/scan/detect";
import {
  aspectRatio,
  homography,
  isConvex,
  project,
  warp,
  type Quad,
} from "../../src/scan/homography";
import { toGray } from "../../src/scan/image";
import { synthPhoto, testPage } from "./synthPhoto";

const page = testPage(100);
const realRatio = page.widthPt / page.heightPt;

describe("homography", () => {
  it("maps the four points exactly", () => {
    const from: Quad = [
      { x: 10, y: 20 },
      { x: 300, y: 5 },
      { x: 320, y: 400 },
      { x: 0, y: 380 },
    ];
    const to: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 140 },
      { x: 0, y: 140 },
    ];
    const h = homography(from, to)!;
    from.forEach((p, i) => {
      const q = project(h, p);
      expect(q.x).toBeCloseTo(to[i]!.x, 6);
      expect(q.y).toBeCloseTo(to[i]!.y, 6);
    });
  });

  it("rejects self-intersecting quads", () => {
    expect(
      isConvex([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toBe(false);
  });
});

describe("perspective correction (CA4)", () => {
  const seeds = [201, 202, 203, 204, 205, 206, 207, 208];

  it("estimates the real aspect ratio within 3%", { timeout: 60_000 }, () => {
    const errors: string[] = [];
    for (const seed of seeds) {
      const { photo, corners } = synthPhoto({ seed, page, tilt: 30 });
      const found = detectPage(toGray(photo))!;
      for (const quad of [corners, found.quad]) {
        const ratio = aspectRatio(quad, photo.width, photo.height);
        const err = Math.abs(ratio / realRatio - 1);
        errors.push(`${seed}:${(err * 100).toFixed(2)}%`);
        expect(err, `seed ${seed}`).toBeLessThan(0.03);
      }
    }
    console.log(errors.join(" "));
  });

  it(
    "keeps straight lines straight (< 2 px at 150 ppi)",
    { timeout: 60_000 },
    () => {
      for (const seed of [211, 212, 213]) {
        const { photo } = synthPhoto({
          seed,
          page,
          tilt: 30,
          width: 2400,
          height: 1800,
        });
        const found = detectPage(toGray(photo))!;
        const width = Math.round((page.widthPt / 72) * 150);
        const height = Math.round((page.heightPt / 72) * 150);
        const out = toGray(warp(photo, found.quad, width, height));
        const sx = width / page.page.width;
        const sy = height / page.page.height;
        for (const rule of page.rules) {
          // Centre of the dark run near the rule, column by column.
          const ys: number[] = [];
          const xs: number[] = [];
          const y0 = rule.y * sy;
          for (
            let x = Math.ceil(rule.x0 * sx + 10);
            x < rule.x1 * sx - 10;
            x += 4
          ) {
            // Skip the table's vertical rules, which start or end on this one.
            if (page.columns.some((c) => Math.abs(c.x * sx - x) < 8)) continue;
            let sum = 0;
            let weight = 0;
            for (let y = Math.floor(y0 - 8); y <= y0 + 8; y++) {
              const v = 255 - out.data[y * width + x]!;
              if (v > 80) {
                sum += (y + 0.5) * v;
                weight += v;
              }
            }
            if (weight > 0) {
              xs.push(x);
              ys.push(sum / weight);
            }
          }
          expect(xs.length).toBeGreaterThan(50);
          // Straight-line fit, then the largest deviation.
          const n = xs.length;
          const mx = xs.reduce((s, v) => s + v, 0) / n;
          const my = ys.reduce((s, v) => s + v, 0) / n;
          let num = 0;
          let den = 0;
          for (let i = 0; i < n; i++) {
            num += (xs[i]! - mx) * (ys[i]! - my);
            den += (xs[i]! - mx) ** 2;
          }
          const slope = num / den;
          const dev = Math.max(
            ...xs.map((x, i) => Math.abs(ys[i]! - (my + slope * (x - mx)))),
          );
          expect(dev, `seed ${seed}, rule at ${rule.y}`).toBeLessThan(2);
        }
      }
    },
  );
});
