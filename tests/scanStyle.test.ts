// Spec 010: the look of a line of text measured in a scanned image.
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { CAP_HEIGHT, measureLine } from "../src/ocr/scanStyle";
import type { Rgba } from "../src/scan/image";
import { bundledFontPath } from "./helpers";

GlobalFonts.registerFromPath(bundledFontPath("Arimo", "Regular"), "Arimo");
GlobalFonts.registerFromPath(bundledFontPath("Arimo", "Bold"), "ArimoBold");

const channels = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** A line of text on paper, and its box as OCR would give it. */
function line(options: {
  text: string;
  size: number;
  paper: string;
  ink: string;
  noise?: number;
  family?: string;
}) {
  const width = 900;
  const height = 200;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = options.paper;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = options.ink;
  ctx.font = `${options.size}px ${options.family ?? "Arimo"}`;
  const x = 60;
  const baseline = 120;
  ctx.fillText(options.text, x, baseline);
  const m = ctx.measureText(options.text);
  const data = ctx.getImageData(0, 0, width, height).data;
  if (options.noise) {
    let seed = 7;
    for (let i = 0; i < data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const n = (seed / 0x7fffffff - 0.5) * options.noise;
      for (let c = 0; c < 3; c++)
        data[i + c] = Math.max(0, Math.min(255, data[i + c]! + n));
    }
  }
  const image: Rgba = { width, height, data };
  const box = {
    x0: x + m.actualBoundingBoxLeft * -1,
    y0: baseline - m.actualBoundingBoxAscent,
    x1: x + m.actualBoundingBoxRight,
    y1: baseline + m.actualBoundingBoxDescent,
  };
  return { image, box, baseline, x };
}

const close = (a: string, b: string, tolerance: number) =>
  channels(a).every((v, i) => Math.abs(v - channels(b)[i]!) <= tolerance);

describe("measureLine", () => {
  it("finds the paper, the ink, the baseline and the size", () => {
    const { image, box, baseline, x } = line({
      text: "Factura 2026-0142 Importe",
      size: 48,
      paper: "#d9d4c7",
      ink: "#1c2b6e",
    });
    const style = measureLine(image, box);
    expect(style.measured).toBe(true);
    expect(close(style.background, "#d9d4c7", 2)).toBe(true);
    expect(close(style.color, "#1c2b6e", 40)).toBe(true);
    expect(Math.abs(style.baseline - baseline)).toBeLessThanOrEqual(2);
    expect(Math.abs(style.left - x)).toBeLessThanOrEqual(4);
    expect(style.size / 48).toBeGreaterThan(0.9);
    expect(style.size / 48).toBeLessThan(1.1);
    expect(style.bold).toBe(false);
  });

  it("tells bold from regular by the width of the strokes", () => {
    for (const size of [30, 46, 75]) {
      const bold = line({
        text: "Informe de prueba para el escaner",
        size,
        paper: "#f2f2f2",
        ink: "#111111",
        family: "ArimoBold",
      });
      expect(measureLine(bold.image, bold.box).bold).toBe(true);
      const regular = line({
        text: "La rapida zorra marron salta sobre el perro",
        size,
        paper: "#f2f2f2",
        ink: "#111111",
      });
      expect(measureLine(regular.image, regular.box).bold).toBe(false);
    }
  });

  it("works without descenders and on a noisy grey scan", () => {
    const { image, box, baseline } = line({
      text: "TOTAL 1.234,56 EUR",
      size: 30,
      paper: "#bdbdbd",
      ink: "#202020",
      noise: 30,
    });
    const style = measureLine(image, box);
    expect(close(style.background, "#bdbdbd", 8)).toBe(true);
    expect(Math.abs(style.baseline - baseline)).toBeLessThanOrEqual(2);
    expect(style.size / 30).toBeGreaterThan(0.85);
    expect(style.size / 30).toBeLessThan(1.15);
  });

  it("white text on a dark band is measured too", () => {
    const { image, box } = line({
      text: "Encabezado",
      size: 40,
      paper: "#203040",
      ink: "#ffffff",
    });
    const style = measureLine(image, box);
    expect(close(style.background, "#203040", 2)).toBe(true);
    // The darkest pixels are the band here: no ink darker than the paper.
    expect(style.measured).toBe(false);
    expect(style.color).toBe("#ffffff");
  });

  it("an empty box falls back to the box size", () => {
    const { image } = line({
      text: "",
      size: 40,
      paper: "#ffffff",
      ink: "#000000",
    });
    const style = measureLine(image, { x0: 100, y0: 50, x1: 300, y1: 100 });
    expect(style.measured).toBe(false);
    expect(style.size).toBeCloseTo(50 / (0.905 + 0.212), 3);
    expect(CAP_HEIGHT).toBeCloseTo(0.716, 3);
  });
});
