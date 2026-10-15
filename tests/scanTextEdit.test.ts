// Spec 010: which part of a recognized line is edited; bold seen in strokes.
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import type { OcrLine, OcrWord } from "../src/model/document";
import { PageGeometry, type Rect } from "../src/model/geometry";
import { boldByStrokes, ocrImageLine } from "../src/editor/scanTextEdit";
import { bundledFontPath } from "./helpers";

GlobalFonts.registerFromPath(bundledFontPath("Arimo", "Regular"), "Arimo");
GlobalFonts.registerFromPath(bundledFontPath("Arimo", "Bold"), "ArimoBold");

const word = (text: string, x: number, width: number, confidence = 90) =>
  ({ text, at: { x, y: 500 }, width, height: 10, confidence }) as OcrWord;

/** A table row as OCR reads it: three cells in one line. */
const row: OcrLine = {
  at: { x: 50, y: 500 },
  width: 400,
  height: 10,
  words: [
    word("Restore", 50, 40),
    word("fonts", 94, 28),
    word("Yes", 300, 20),
    word("No", 420, 14, 30),
  ],
};

describe("ocrImageLine", () => {
  it("edits only the cell that was clicked", () => {
    const first = ocrImageLine("p", 0, row, { x: 70, y: 505 });
    expect(first.text).toBe("Restore fonts");
    expect(first.box.at.x).toBe(50);
    expect(first.box.width).toBe(72);
    expect(first.lowConfidence).toBe(false);

    const middle = ocrImageLine("p", 0, row, { x: 310, y: 505 });
    expect(middle.text).toBe("Yes");
    expect(middle.box.at.x).toBe(300);
  });

  it("a click between cells picks the nearest one", () => {
    expect(ocrImageLine("p", 0, row, { x: 400, y: 505 }).text).toBe("No");
  });

  it("marks doubtful words", () => {
    expect(ocrImageLine("p", 0, row, { x: 425, y: 505 }).lowConfidence).toBe(
      true,
    );
  });

  it("follows rotated text", () => {
    // Text running up the page: along the line is +y.
    const up: OcrLine = {
      at: { x: 100, y: 50 },
      width: 300,
      height: 10,
      words: [
        {
          text: "Uno",
          at: { x: 100, y: 50 },
          width: 30,
          height: 10,
          confidence: 90,
        },
        {
          text: "dos",
          at: { x: 100, y: 84 },
          width: 30,
          height: 10,
          confidence: 90,
        },
        {
          text: "Tres",
          at: { x: 100, y: 250 },
          width: 40,
          height: 10,
          confidence: 90,
        },
      ],
    };
    const line = ocrImageLine("p", 90, up, { x: 95, y: 260 });
    expect(line.text).toBe("Tres");
    expect(line.box.at.y).toBeCloseTo(250, 6);
  });
});

describe("boldByStrokes", () => {
  /** A page rendered at 300 ppi: a title and lines of body text. */
  function page(titleFamily: string) {
    const scale = 300 / 72;
    const geometry = new PageGeometry([0, 0, 595, 842], 0, scale);
    const canvas = createCanvas(
      Math.round(geometry.viewWidth),
      Math.round(geometry.viewHeight),
    );
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";
    const areas: Rect[] = [];
    const line = (text: string, size: number, y: number, family: string) => {
      ctx.font = `${size * scale}px ${family}`;
      const m = ctx.measureText(text);
      ctx.fillText(text, 56 * scale, (842 - y) * scale);
      areas.push({
        x: 56,
        y: y - 0.25 * size,
        width: m.width / scale,
        height: 1.2 * size,
      });
    };
    line("Resumen de la cuenta", 18, 770, titleFamily);
    for (let i = 0; i < 6; i++)
      line(
        "Texto normal de la cuenta con importes y fechas",
        11,
        740 - i * 16,
        "Arimo",
      );
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = {
      image: { width: data.width, height: data.height, data: data.data },
      geometry,
    };
    return { pixels, title: areas[0]!, body: areas.slice(1) };
  }

  it("sees a bold title among regular lines", () => {
    const { pixels, title, body } = page("ArimoBold");
    expect(boldByStrokes(pixels, title, body)).toBe(true);
    expect(boldByStrokes(pixels, body[0]!, [title, ...body.slice(1)])).toBe(
      false,
    );
  });

  it("a regular title is not bold", () => {
    const { pixels, title, body } = page("Arimo");
    expect(boldByStrokes(pixels, title, body)).toBe(false);
  });

  it("without other text to compare, says nothing", () => {
    const { pixels, title, body } = page("ArimoBold");
    expect(boldByStrokes(pixels, title, body.slice(0, 2))).toBe(false);
  });
});
