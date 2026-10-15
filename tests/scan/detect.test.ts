// Spec 002, CA2: automatic page detection on synthetic photos.
import { describe, expect, it } from "vitest";
import { detectPage } from "../../src/scan/detect";
import { toGray } from "../../src/scan/image";
import { synthPhoto, testPage } from "./synthPhoto";

const page = testPage();

describe("page detection (CA2)", () => {
  const cases = Array.from({ length: 24 }, (_, i) => ({
    seed: 100 + i,
    background: (i % 2 ? "texture" : "plain") as "texture" | "plain",
    tilt: 30,
    shadow: i % 3 === 0 ? 0.4 : 0.2,
  }));
  const errors: number[] = [];

  it(
    "finds each corner within 2% of the diagonal in at least 90% of photos",
    { timeout: 120_000 },
    () => {
      let good = 0;
      const report: string[] = [];
      for (const c of cases) {
        const { photo, corners } = synthPhoto({ ...c, page });
        const found = detectPage(toGray(photo));
        const diag = Math.hypot(photo.width, photo.height);
        const err = found
          ? Math.max(
              ...found.quad.map((p, i) =>
                Math.hypot(p.x - corners[i]!.x, p.y - corners[i]!.y),
              ),
            ) / diag
          : Infinity;
        errors.push(err);
        if (err < 0.02) good++;
        report.push(`${c.seed}:${c.background}:${(err * 100).toFixed(2)}%`);
      }
      console.log(report.join(" "));
      expect(good / cases.length).toBeGreaterThanOrEqual(0.9);
    },
  );

  it("returns null when there is no page", () => {
    for (const background of ["plain", "texture"] as const) {
      const { photo } = synthPhoto({ seed: 7, background, empty: true, page });
      expect(detectPage(toGray(photo))).toBeNull();
    }
  });
});
