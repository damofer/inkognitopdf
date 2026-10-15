import { PDFDocument } from "pdf-lib";
import { pageTextShows } from "../engine/textEdit";
import type { TextShow } from "../engine/textShows";
import type { SubstituteFamily } from "../engine/fonts";
import type { PdfFile } from "../storage/pdfFile";
import type { TextBox } from "./textBoxes";

/**
 * Style of existing page text, read from the content stream (spec 001, CA3b):
 * the editing preview shows the color, weight and style that the saved text
 * will have. Loaded on demand, as it needs pdf-lib.
 */
export interface ProbedStyle {
  color: string;
  bold: boolean;
  italic: boolean;
  /** Open font that completes characters the original font lacks. */
  substitute: SubstituteFamily;
  /**
   * Drawn invisibly (3 or 7 Tr), like an OCR text layer: editing it would
   * change hidden text, not what the page shows.
   */
  invisible: boolean;
}

const docs = new WeakMap<PdfFile, Promise<PDFDocument>>();
const pages = new WeakMap<PDFDocument, Map<number, TextShow[]>>();

/** Text operations of a page of the file, read once and cached. */
export async function showsOf(
  file: PdfFile,
  pageIndex: number,
): Promise<TextShow[]> {
  let doc = docs.get(file);
  if (!doc) {
    doc = PDFDocument.load(file.copyBytes(), { updateMetadata: false });
    docs.set(file, doc);
  }
  const loaded = await doc;
  let cache = pages.get(loaded);
  if (!cache) pages.set(loaded, (cache = new Map()));
  let shows = cache.get(pageIndex);
  if (!shows) {
    shows = pageTextShows(loaded, loaded.getPage(pageIndex));
    cache.set(pageIndex, shows);
  }
  return shows;
}

export async function probeTextStyle(
  file: PdfFile,
  pageIndex: number,
  box: TextBox,
): Promise<ProbedStyle | null> {
  const { area, at } = box;
  let best: { show: TextShow; distance: number } | null = null;
  for (const show of await showsOf(file, pageIndex))
    for (const part of show.parts) {
      if (part.kind !== "glyph") continue;
      const { x, y } = part.center;
      if (
        x < area.x ||
        x > area.x + area.width ||
        y < area.y ||
        y > area.y + area.height
      )
        continue;
      const distance = Math.hypot(part.origin.x - at.x, part.origin.y - at.y);
      if (!best || distance < best.distance) best = { show, distance };
    }
  if (!best) return null;
  const { show } = best;
  return {
    color: show.color,
    bold: show.font?.bold ?? false,
    italic: show.font?.italic ?? false,
    substitute: show.font?.substitute ?? "Arimo",
    invisible: show.state.renderMode === 3 || show.state.renderMode === 7,
  };
}
