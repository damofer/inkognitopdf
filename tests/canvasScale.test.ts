// Spec 035: page canvases stay within the canvas pixel budget.
import { describe, expect, it } from "vitest";
import { canvasScale, MAX_CANVAS_PIXELS } from "../src/viewer/canvasScale";

describe("canvasScale", () => {
  it("keeps the screen's pixel ratio when the canvas fits", () => {
    // A Letter page at 100 % on a DPR 3 phone: 1836 × 2376 device pixels.
    expect(canvasScale(612, 792, 3)).toBe(3);
    expect(canvasScale(612, 792, 1)).toBe(1);
  });

  it("lowers it when the canvas would pass the budget", () => {
    // The same page at 400 % on that phone would need 70 million pixels.
    const scale = canvasScale(612 * 4, 792 * 4, 3);
    expect(scale).toBeLessThan(3);
    const pixels = Math.floor(612 * 4 * scale) * Math.floor(792 * 4 * scale);
    expect(pixels).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    expect(pixels).toBeGreaterThan(MAX_CANVAS_PIXELS * 0.99);
  });

  it("goes below 1 for a poster-sized page", () => {
    // A0 at 400 %, even on a DPR 1 screen.
    expect(canvasScale(2384 * 4, 3370 * 4, 1)).toBeLessThan(1);
  });
});
