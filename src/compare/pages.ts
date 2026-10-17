// Spec 018: the words of every page and page renders, with pdf.js.
import {
  wordsOf,
  type Measure,
  type TextRun,
  type Word,
} from "../model/compare";
import type { PDFDocumentProxy } from "../viewer/pdfjs";

export interface PageSize {
  width: number;
  height: number;
}

/** The words of the document and the size of each page (scale 1). */
export async function documentWords(
  doc: PDFDocumentProxy,
): Promise<{ words: Word[]; sizes: PageSize[] }> {
  const words: Word[] = [];
  const sizes: PageSize[] = [];
  // Words share their run by width in a similar font (the real one is not
  // at hand): close enough to mark them.
  const context = document.createElement("canvas").getContext("2d")!;
  for (let index = 0; index < doc.numPages; index++) {
    const page = await doc.getPage(index + 1);
    const viewport = page.getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
    const content = await page.getTextContent();
    const runs = content.items.filter(
      (item): item is TextRun & typeof item => "str" in item,
    );
    const measure: Measure = (text, run) => {
      const family = content.styles[run.fontName ?? ""]?.fontFamily;
      context.font = `100px ${family ?? "sans-serif"}`;
      return context.measureText(text).width;
    };
    words.push(...wordsOf(runs, viewport.transform, index, measure));
  }
  return { words, sizes };
}

/** Renders a page at `scale`; returns the canvas and its pixels. */
export async function renderPage(
  doc: PDFDocumentProxy,
  index: number,
  scale: number,
): Promise<{ canvas: HTMLCanvasElement; pixels: ImageData }> {
  const page = await doc.getPage(index + 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  await page.render({ canvas, viewport }).promise;
  const pixels = canvas
    .getContext("2d", { willReadFrequently: true })!
    .getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, pixels };
}
