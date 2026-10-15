import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  clampZoom,
  fitWidth,
  formatZoom,
  zoomIn,
  zoomOut,
} from "./zoom";

describe("zoom", () => {
  it("steps through the zoom levels", () => {
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.75);
    expect(zoomIn(1.1)).toBe(1.25);
    expect(zoomOut(1.1)).toBe(1);
  });

  it("stops at the limits", () => {
    expect(zoomIn(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(zoomOut(MIN_ZOOM)).toBe(MIN_ZOOM);
  });

  it("clamps invalid values", () => {
    expect(clampZoom(100)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("fits a page to the container width", () => {
    expect(fitWidth(600, 632)).toBeCloseTo(1);
    expect(fitWidth(600, 1232)).toBeCloseTo(2);
    expect(fitWidth(0, 800)).toBe(1);
  });

  it("formats as a percentage", () => {
    expect(formatZoom(1.25)).toBe("125 %");
  });
});
