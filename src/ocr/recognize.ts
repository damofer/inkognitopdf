/**
 * Recognizes the text of one page (spec 003, HU2): the page is drawn at
 * 300 ppi as the user sees it, cleaned up, read by Tesseract, and the words
 * are mapped back to PDF user space.
 */
import type { Worker } from "tesseract.js";
import {
  effectiveRotation,
  type OcrLine,
  type OcrWord,
  type PageEntry,
} from "../model/document";
import { PageGeometry, type Point } from "../model/geometry";
import { bitmapToRgba } from "../scan/enhance";
import type { Rgba } from "../scan/image";
import type { PDFDocumentProxy } from "../viewer/pdfjs";
import { drawScanPage } from "../viewer/scanBitmap";
import { prepareForOcr } from "./preprocess";

export const OCR_PPI = 300;
const MAX_SIDE = 4000;

export interface PageImage {
  image: Rgba;
  geometry: PageGeometry;
}

/** The page as pixels (300 ppi, at most 4000 px a side), rotated as shown. */
export async function pageImage(
  doc: PDFDocumentProxy | null,
  entry: PageEntry,
): Promise<PageImage> {
  const rotation = effectiveRotation(entry);
  const base = new PageGeometry(entry.box, rotation, 1);
  const scale = Math.min(
    OCR_PPI / 72,
    MAX_SIDE / Math.max(base.viewWidth, base.viewHeight),
  );
  const geometry = new PageGeometry(entry.box, rotation, scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(geometry.viewWidth);
  canvas.height = Math.round(geometry.viewHeight);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (entry.source.kind === "scan")
    await drawScanPage(canvas, entry.source.image, rotation);
  else if (entry.source.kind === "original" && doc) {
    const page = await doc.getPage(entry.source.index + 1);
    await page.render({
      canvas,
      viewport: page.getViewport({ scale, rotation }),
    }).promise;
  }
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    image: { width: data.width, height: data.height, data: data.data },
    geometry,
  };
}

interface PixelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Text direction in user space, in degrees counter-clockwise. */
export function textRotation(geometry: PageGeometry): number {
  const a = geometry.toPdf({ x: 0, y: 0 });
  const b = geometry.toPdf({ x: 1, y: 0 });
  return Math.round((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
}

function toUser(geometry: PageGeometry, box: PixelBox) {
  const at: Point = geometry.toPdf({ x: box.x0, y: box.y1 });
  return {
    at,
    width: (box.x1 - box.x0) / geometry.scale,
    height: (box.y1 - box.y0) / geometry.scale,
  };
}

/** Recognized lines of a page image, in user space. */
export async function recognizeImage(
  worker: Worker,
  { image, geometry }: PageImage,
): Promise<OcrLine[]> {
  const clean = bitmapToRgba(prepareForOcr(image));
  const canvas = document.createElement("canvas");
  canvas.width = clean.width;
  canvas.height = clean.height;
  canvas
    .getContext("2d")!
    .putImageData(
      new ImageData(
        clean.data as Uint8ClampedArray<ArrayBuffer>,
        clean.width,
        clean.height,
      ),
      0,
      0,
    );
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? [])
    for (const paragraph of block.paragraphs)
      for (const line of paragraph.lines) {
        const words: OcrWord[] = line.words
          .filter((w) => w.text.trim() !== "")
          .map((w) => ({
            ...toUser(geometry, w.bbox),
            text: w.text,
            confidence: w.confidence,
          }));
        if (words.length === 0) continue;
        lines.push({ ...toUser(geometry, line.bbox), words });
      }
  return lines;
}
