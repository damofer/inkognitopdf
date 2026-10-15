import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { PageGeometry, normalizeRotation, type Rotation } from "./geometry";

const fixtures = join(import.meta.dirname, "..", "..", "tests", "fixtures");
const pdfjsRoot = join(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
  "..",
);

describe("normalizeRotation", () => {
  it("wraps any multiple of 90 into 0..270", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
  });
});

describe("PageGeometry", () => {
  const box = [10, 20, 610, 820] as const; // 600 x 800, offset origin
  const rotations: Rotation[] = [0, 90, 180, 270];

  it.each(rotations)("round-trips points at rotation %i", (rotation) => {
    const g = new PageGeometry(box, rotation, 1.5);
    for (const p of [
      { x: 10, y: 20 },
      { x: 300, y: 400 },
      { x: 610, y: 820 },
    ]) {
      const back = g.toPdf(g.toView(p));
      expect(back.x).toBeCloseTo(p.x);
      expect(back.y).toBeCloseTo(p.y);
    }
  });

  it("swaps width and height for 90 and 270", () => {
    expect(new PageGeometry(box, 0, 2).viewWidth).toBe(1200);
    expect(new PageGeometry(box, 90, 2).viewWidth).toBe(1600);
    expect(new PageGeometry(box, 270, 1).viewHeight).toBe(600);
  });

  it("maps rects to an axis-aligned view rect and back", () => {
    const g = new PageGeometry(box, 90, 1);
    const r = { x: 100, y: 200, width: 50, height: 30 };
    const back = g.rectToPdf(g.rectToView(r));
    expect(back.x).toBeCloseTo(r.x);
    expect(back.y).toBeCloseTo(r.y);
    expect(back.width).toBeCloseTo(r.width);
    expect(back.height).toBeCloseTo(r.height);
  });

  it.each(rotations)(
    "matches pdf.js viewport math at rotation %i",
    async (rotation) => {
      const data = new Uint8Array(await readFile(join(fixtures, "table.pdf")));
      const doc = await getDocument({
        data,
        standardFontDataUrl: join(pdfjsRoot, "standard_fonts") + "/",
      }).promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1.25, rotation });
      const [x0, y0, x1, y1] = page.view as [number, number, number, number];
      const g = new PageGeometry([x0, y0, x1, y1], rotation, 1.25);
      for (const p of [
        { x: 56, y: 760 },
        { x: 300, y: 100 },
      ]) {
        const [vx, vy] = viewport.convertToViewportPoint(p.x, p.y) as [
          number,
          number,
        ];
        const ours = g.toView(p);
        expect(ours.x).toBeCloseTo(vx, 6);
        expect(ours.y).toBeCloseTo(vy, 6);
      }
      expect(g.viewWidth).toBeCloseTo(viewport.width, 6);
      await doc.loadingTask.destroy();
    },
  );
});
