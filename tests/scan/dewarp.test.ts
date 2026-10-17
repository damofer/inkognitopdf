// Spec 029: straightening curved pages, on synthetic photos of a bent sheet.
import { describe, expect, it } from "vitest";
import { detectPage } from "../../src/scan/detect";
import { fitCurl, isCurled } from "../../src/scan/dewarp";
import { toGray, type Gray } from "../../src/scan/image";
import { rectify } from "../../src/scan/pipeline";
import {
  synthPhoto,
  testPage,
  type PhotoOptions,
  type TestPage,
} from "./synthPhoto";

const page = testPage(100);

/** y of a dark horizontal rule, followed from the middle of [x0, x1]. */
function traceRule(out: Gray, x0: number, x1: number, y0: number) {
  const { width: w, height: h, data } = out;
  const dark = (x: number, y: number) => 255 - data[y * w + x]!;
  const xm = Math.round((x0 + x1) / 2);
  // Start on the row near the guess with the longest unbroken dark run (text
  // has gaps).
  let best = -1;
  let start = y0;
  for (
    let y = Math.max(0, Math.round(y0 - 40));
    y < Math.min(h, y0 + 40);
    y++
  ) {
    let v = 0;
    let run = 0;
    for (let x = xm - 30; x <= xm + 30; x++) {
      run = dark(x, y) > 80 ? run + 1 : 0;
      v = Math.max(v, run);
    }
    if (v > best) [best, start] = [v, y];
  }
  const points: { x: number; y: number }[] = [];
  for (const dir of [1, -1]) {
    let y = start;
    for (let x = xm; dir > 0 ? x < x1 : x > x0; x += 2 * dir) {
      let sum = 0;
      let weight = 0;
      for (let yy = Math.floor(y - 3); yy <= y + 3; yy++) {
        const v = yy >= 0 && yy < h ? dark(x, yy) : 0;
        if (v > 80) {
          sum += (yy + 0.5) * v;
          weight += v;
        }
      }
      if (weight > 0) {
        y = sum / weight;
        points.push({ x, y });
      }
    }
  }
  return points;
}

/** Largest distance of the points from their straight-line fit. */
function deviation(points: { x: number; y: number }[]): number {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  const k = num / den;
  return Math.max(...points.map((p) => Math.abs(p.y - (my + k * (p.x - mx)))));
}

/** Worst deviation of the test page's rules in a page image. */
function worstRule(out: Gray, ideal: TestPage): number {
  const sx = out.width / ideal.page.width;
  const sy = out.height / ideal.page.height;
  return Math.max(
    ...ideal.rules.map((r) => {
      const points = traceRule(
        out,
        Math.ceil(r.x0 * sx + 12),
        Math.floor(r.x1 * sx - 12),
        r.y * sy,
      ).filter(
        // The table's vertical rules start or end on this one.
        (p) => !ideal.columns.some((c) => Math.abs(c.x * sx - p.x) < 8),
      );
      expect(points.length, `rule at ${r.y}`).toBeGreaterThan(100);
      return deviation(points);
    }),
  );
}

/** How far each column of the table is from its place on the ideal page. */
function columnErrors(out: Gray, ideal: TestPage): number[] {
  const sx = out.width / ideal.page.width;
  const sy = out.height / ideal.page.height;
  return ideal.columns.map((c) => {
    const y = Math.round(((c.y0 + c.y1) / 2) * sy);
    let best = -1;
    let found = 0;
    for (
      let x = Math.max(1, Math.round(c.x * sx - 60));
      x < Math.min(out.width - 1, c.x * sx + 60);
      x++
    ) {
      let v = 0;
      for (let yy = y - 20; yy <= y + 20; yy++)
        v += 255 - out.data[yy * out.width + x]!;
      if (v > best) [best, found] = [v, x];
    }
    return Math.abs(found - c.x * sx) / out.width;
  });
}

const CURLED: PhotoOptions[] = [
  { seed: 301, tilt: 20, curl: 25, curlShape: "arch" },
  { seed: 303, tilt: 15, curl: 35, curlShape: "spine" },
  { seed: 304, tilt: 25, curl: 15, curlShape: "arch" },
  { seed: 305, tilt: 20, curl: 30, curlShape: "spine" },
];

describe("curved pages (spec 029)", () => {
  it(
    "straightens the lines of a bent sheet (CA1, CA2)",
    { timeout: 120_000 },
    () => {
      const steep = {
        seed: 302,
        tilt: 20,
        curl: 50,
        curlShape: "spine",
      } as const;
      for (const options of [...CURLED, steep]) {
        const { photo, corners } = synthPhoto({ page, ...options });
        const flat = rectify(photo, corners, "auto", 100, false);
        const fixed = rectify(photo, corners, "auto", 100);
        expect(fixed.curved, `seed ${options.seed}`).toBe(true);
        const before = worstRule(toGray(flat.image), page);
        const after = worstRule(toGray(fixed.image), page);
        expect(after, `seed ${options.seed}`).toBeLessThan(3);
        expect(after, `seed ${options.seed}`).toBeLessThan(before / 2);
        // CA2 is for curls up to 35°.
        if (options === steep) continue;
        for (const error of columnErrors(toGray(fixed.image), page))
          expect(error, `seed ${options.seed}`).toBeLessThan(0.02);
      }
    },
  );

  it(
    "still helps with the corners the detector finds",
    { timeout: 60_000 },
    () => {
      for (const options of CURLED) {
        const { photo } = synthPhoto({ page, ...options });
        const quad = detectPage(toGray(photo))!.quad;
        const flat = rectify(photo, quad, "auto", 100, false);
        const fixed = rectify(photo, quad, "auto", 100);
        expect(fixed.curved).toBe(true);
        expect(worstRule(toGray(fixed.image), page)).toBeLessThan(
          worstRule(toGray(flat.image), page),
        );
      }
    },
  );

  it("leaves flat sheets exactly as before (CA3)", { timeout: 120_000 }, () => {
    for (const seed of [201, 202, 203, 204, 205, 206, 207, 208, 211]) {
      const { photo, corners } = synthPhoto({ seed, page, tilt: 30 });
      const found = detectPage(toGray(photo))!.quad;
      for (const quad of [corners, found]) {
        const plain = rectify(photo, quad, "auto", 100, false);
        const fixed = rectify(photo, quad, "auto", 100);
        expect(fixed.curved, `seed ${seed}`).toBe(false);
        expect(
          Buffer.from(fixed.image.data).equals(Buffer.from(plain.image.data)),
        ).toBe(true);
      }
    }
  });

  it("needs lines of text (CA4)", { timeout: 60_000 }, () => {
    const blank: TestPage = {
      ...page,
      page: {
        ...page.page,
        data: new Float32Array(page.page.data.length).fill(255),
      },
      rules: [],
      columns: [],
    };
    const { photo, corners } = synthPhoto({ ...CURLED[0]!, page: blank });
    expect(rectify(photo, corners, "auto", 100).curved).toBe(false);
  });

  it("never bends an ID card", { timeout: 60_000 }, () => {
    const { photo, corners } = synthPhoto({ page, ...CURLED[0]! });
    expect(rectify(photo, corners, "card", 100).curved).toBe(false);
  });
});

describe("fitCurl", () => {
  it("recovers the bend of known lines", () => {
    // Lines seen as v = V + P(u) + Q(u)·v with a known arch.
    const width = 800;
    const height = 1100;
    const bend = (u: number) => 0.03 * (1 - 4 * u * u);
    const lines = [-0.35, -0.2, -0.05, 0.1, 0.25, 0.4].map((V) =>
      Array.from({ length: 60 }, (_, i) => {
        const u = -0.4 + (0.8 * i) / 59;
        const q = bend(u);
        const v = (V - 0.2 * q) / (1 - q);
        return { x: (u + 0.5) * width, y: (v + 0.5) * height };
      }),
    );
    const curl = fitCurl(lines, width, height)!;
    expect(isCurled(curl)).toBe(true);
    expect(curl.after).toBeLessThan(1e-4);
    expect(curl.bend).toBeGreaterThan(0.01);
  });

  it("finds no bend in straight lines", () => {
    const lines = [100, 300, 500, 700].map((y) =>
      Array.from({ length: 50 }, (_, i) => ({
        x: 80 + i * 12,
        y: y + (i % 3) * 0.4,
      })),
    );
    expect(isCurled(fitCurl(lines, 800, 1100))).toBe(false);
  });
});
