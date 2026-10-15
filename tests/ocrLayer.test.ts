// Spec 003, O003: the invisible text layer (CA4, CA5), not editable once
// saved (CA7), and the .txt export (CA8).
import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/engine/applyEdits";
import { ocrText } from "../src/ocr/ocrText";
import type {
  EditorState,
  OcrItem,
  OcrLine,
  OcrWord,
  PageEntry,
} from "../src/model/document";
import { applyOperation } from "../src/model/operations";
import { textBoxes } from "../src/editor/textBoxes";
import { probeTextStyle } from "../src/editor/textStyleProbe";
import { createPdfFile } from "../src/storage/pdfFile";
import { openPdf, qpdfCheck, qpdfPath, testDeps } from "./helpers";
import { diffShare, renderPage } from "./renderHelpers";

// A 200 × 100 pt page whose image is white paper with a dark bar (y 40–50 pt)
// where the old text is.
function scanPageEntry(): PageEntry {
  const width = 400;
  const height = 200;
  const stride = Math.ceil(width / 8);
  const data = new Uint8Array(stride * height).fill(0xff);
  for (let y = 100; y < 120; y++)
    for (let x = 40; x < 300; x++)
      data[y * stride + (x >> 3)]! &= ~(0x80 >> (x & 7));
  return {
    id: "p0",
    source: { kind: "scan", image: { format: "bw", data, width, height } },
    box: [0, 0, 200, 100],
    baseRotation: 0,
    extraRotation: 0,
  };
}

const word = (text: string, x: number, width: number): OcrWord => ({
  text,
  at: { x, y: 70 },
  width,
  height: 10,
  confidence: 90,
});

const line = (words: OcrWord[], extra: Partial<OcrLine> = {}): OcrLine => ({
  words,
  at: words[0]!.at,
  width: words.at(-1)!.at.x + words.at(-1)!.width - words[0]!.at.x,
  height: 10,
  ...extra,
});

const ocr = (lines: OcrLine[]): OcrItem => ({
  id: "ocr-1",
  pageId: "p0",
  kind: "ocr",
  lang: "spa",
  rotate: 0,
  lines,
});

const WORDS = [
  word("Factura", 20, 50),
  word("2026-0142", 76, 64),
  word("Ñandú", 146, 40),
];

async function save(state: EditorState) {
  const { bytes } = await applyEdits(new Uint8Array(), state, testDeps);
  if (qpdfPath) await qpdfCheck(bytes);
  return bytes;
}

async function extracted(bytes: Uint8Array) {
  const doc = await openPdf(bytes);
  const content = await (await doc.getPage(1)).getTextContent();
  await doc.loadingTask.destroy();
  return content.items.flatMap((i) =>
    "str" in i && i.str.trim()
      ? [
          {
            str: i.str,
            x: i.transform[4] as number,
            y: i.transform[5] as number,
            width: i.width,
            height: i.height,
          },
        ]
      : [],
  );
}

describe("OCR text layer (CA4)", () => {
  it("is invisible, extractable and aligned with the OCR boxes", async () => {
    const page = scanPageEntry();
    const plain = await save({ pages: [page], items: [] });
    const withText = await save({ pages: [page], items: [ocr([line(WORDS)])] });

    // The render does not change at all.
    const a = await renderPage(plain);
    const b = await renderPage(withText);
    expect(diffShare(a, b, { x: 0, y: 0, width: 200, height: 100 }, 0)).toBe(0);

    const runs = await extracted(withText);
    const text = runs.map((r) => r.str).join(" ");
    for (const w of WORDS) expect(text).toContain(w.text);
    // Each word's extracted box covers at least 80% of its OCR box.
    for (const w of WORDS) {
      const run = runs.find((r) => r.str.includes(w.text))!;
      const x0 = Math.max(run.x, w.at.x);
      const x1 = Math.min(run.x + run.width, w.at.x + w.width);
      // pdf.js gives the baseline and the font size; the box spans the font's
      // descender to its ascender around it.
      const y0 = Math.max(run.y - 0.212 * run.height, w.at.y);
      const y1 = Math.min(run.y + 0.905 * run.height, w.at.y + w.height);
      const cover =
        (Math.max(0, x1 - x0) * Math.max(0, y1 - y0)) / (w.width * w.height);
      expect(cover, w.text).toBeGreaterThanOrEqual(0.8);
    }
  });

  it("running OCR again replaces the layer (CA5)", async () => {
    const page = scanPageEntry();
    let state: EditorState = { pages: [page], items: [] };
    state = applyOperation(state, {
      kind: "addItem",
      item: ocr([line(WORDS)]),
    });
    state = applyOperation(state, {
      kind: "updateItem",
      item: ocr([line([word("Otra", 20, 30)])]),
    });
    const text = (await extracted(await save(state)))
      .map((r) => r.str)
      .join(" ");
    expect(text).toContain("Otra");
    expect(text).not.toContain("Factura");
  });
});

describe("saved OCR text (CA7)", () => {
  it("is reported invisible, so Editar texto does not open it", async () => {
    const bytes = await save({
      pages: [scanPageEntry()],
      items: [ocr([line(WORDS)])],
    });
    const doc = await openPdf(bytes);
    const boxes = textBoxes(await (await doc.getPage(1)).getTextContent());
    await doc.loadingTask.destroy();
    const box = boxes.find((b) => b.text.includes("Factura"))!;
    const style = await probeTextStyle(createPdfFile("ocr.pdf", bytes), 0, box);
    expect(style?.invisible).toBe(true);
  });
});

describe("OCR text export (CA8)", () => {
  it("keeps the reading order and splits pages with a form feed", () => {
    const a = ocr([line(WORDS), line([word("fin", 20, 20)])]);
    expect(ocrText([a, undefined, a])).toBe(
      "Factura 2026-0142 Ñandú\nfin\n\f\n\fFactura 2026-0142 Ñandú\nfin",
    );
  });
});
