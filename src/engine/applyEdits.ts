import { BRAND } from "../brand";
import { t } from "../i18n";
import {
  PDFDocument,
  degrees,
  fill,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  type PDFPage,
} from "pdf-lib";
import type {
  EditorState,
  ImageItem,
  Item,
  PageEntry,
  TextItem,
} from "../model/document";
import { isImageTextEdit } from "../model/document";
import { addAnnotation, removeAnnotation } from "./annotations";
import { applyForms, flattenForms } from "./forms";
import { drawOcr } from "./ocrLayer";
import { drawScan } from "./scanPage";
import { detachRemovedPages } from "./organize";
import { cleanFile, redactPage, type ImageCodec } from "./redact";
import { drawSignature } from "./signature";
import { hexToRgb } from "./color";
import { FontCache, drawTextWith, type LoadFont } from "./fonts";
import { drawImageTextEdit, drawNotFound, editPageText } from "./textEdit";

export interface EngineDeps {
  /** Loads a bundled open font (Arimo, Tinos, Cousine, Carlito, Caladea). */
  loadFont: LoadFont;
  /** Injectable clock for reproducible output in tests. */
  now?: () => Date;
  /** JPEG decoding and encoding, to redact JPEG images (spec 012). */
  images?: ImageCodec;
}

export interface SaveResult {
  bytes: Uint8Array;
  /** Human-readable notes for the user (Spanish), e.g. font substitutions. */
  warnings: string[];
}

export interface SaveOptions {
  /** Draws the form fields into the pages and removes them (spec 005, CA6). */
  flattenForms?: boolean;
}

export class EngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

/**
 * Applies the edit state to a copy of the original PDF and returns new bytes
 * (spec 001, T010). Runs entirely on the device; the input is never modified.
 */
export async function applyEdits(
  original: Uint8Array,
  state: EditorState,
  deps: EngineDeps,
  options: SaveOptions = {},
): Promise<SaveResult> {
  let doc: PDFDocument;
  try {
    // An empty input means a document started from scratch (HU10).
    doc =
      original.length === 0
        ? await PDFDocument.create({ updateMetadata: false })
        : await PDFDocument.load(original.slice(), { updateMetadata: false });
  } catch (cause) {
    if (cause instanceof Error && /encrypt/i.test(cause.message))
      throw new EngineError(t("engine.encrypted"));
    throw cause;
  }

  const warnings: string[] = [];
  const fonts = new FontCache(doc, deps.loadFont);
  const now = (deps.now ?? (() => new Date()))();
  const originalPages = doc.getPages().map((p) => p.ref);
  const pages = arrangePages(doc, state.pages);
  // Spec 013: deleted pages leave the file, with what pointed to them.
  const used = new Set(
    state.pages.flatMap((p) =>
      p.source.kind === "original" ? [p.source.index] : [],
    ),
  );
  const removedPages = originalPages.some((_, i) => !used.has(i));
  const pagesById = new Map(state.pages.map((e, i) => [e.id, pages[i]!]));
  const isolated = new Set<PDFPage>();
  const isolate = (page: PDFPage) => {
    if (isolated.has(page)) return;
    isolated.add(page);
    isolateContent(doc, page);
  };
  await applyForms(doc, state.items, pagesById, fonts);

  for (const [index, entry] of state.pages.entries()) {
    const page = pages[index]!;
    page.setRotation(degrees((entry.baseRotation + entry.extraRotation) % 360));
    if (entry.source.kind === "scan")
      await drawScan(doc, page, entry.source.image, entry.box);
    const items = state.items.filter((i) => i.pageId === entry.id);
    if (items.length === 0) continue;
    const allEdits = items.filter((i) => i.kind === "textEdit");
    // Spec 010: edits of scanned text are painted over the image.
    const imageEdits = allEdits.filter(isImageTextEdit);
    const textEdits = allEdits.filter((e) => !isImageTextEdit(e));
    const { warnings: editWarnings, notFound } =
      allEdits.length > 0
        ? await editPageText(doc, page, textEdits, fonts, imageEdits)
        : { warnings: [], notFound: [] };
    warnings.push(...editWarnings);
    if (entry.source.kind === "original") isolate(page);
    for (const edit of notFound)
      warnings.push(await drawNotFound(page, edit, fonts));
    for (const edit of imageEdits) await drawImageTextEdit(page, edit, fonts);
    const covered = imageEdits.map((e) => e.area);
    for (const item of items)
      if (item.kind === "ocr") await drawOcr(page, item, fonts, covered);
      else await drawItem(doc, page, item, fonts, now);
  }

  if (options.flattenForms) await flattenForms(doc, fonts, isolate);

  if (fonts.usedFallback) warnings.push(t("engine.fallbackFonts"));

  await fonts.embedSubstitutes();

  // Spec 012: secure redaction runs on the final content of each page.
  const redactions = state.items.filter((i) => i.kind === "redaction");
  const applied = redactions.filter((r) => r.applied);
  const pending = redactions.length - applied.length;
  if (pending > 0) warnings.push(t("redact.pending", pending));
  if (applied.length > 0) {
    await doc.flush();
    for (const [index, entry] of state.pages.entries()) {
      const areas = applied
        .filter((r) => r.pageId === entry.id)
        .map((r) => r.rect);
      if (areas.length === 0) continue;
      const page = pages[index]!;
      warnings.push(
        ...(await redactPage(doc, page, areas, deps.images, index + 1)),
      );
      // A new stream: the one pdf-lib keeps for the page was replaced.
      page.node.addContentStream(
        doc.context.register(
          doc.context.contentStream([
            pushGraphicsState(),
            setFillingRgbColor(0, 0, 0),
            ...areas.map((r) => rectangle(r.x, r.y, r.width, r.height)),
            fill(),
            popGraphicsState(),
          ]),
        ),
      );
    }
  }

  if (removedPages) detachRemovedPages(doc, originalPages);

  doc.setProducer(BRAND);
  // A document started from scratch was also created here.
  if (original.length === 0) doc.setCreator(BRAND);
  doc.setModificationDate(now);
  let bytes = await doc.save();
  // Nothing removed may stay in the file as an unreferenced object.
  if (applied.length > 0 || removedPages)
    bytes = await cleanFile(bytes, {
      clearMetadata: applied.some((r) => r.clearMetadata),
    });
  return { bytes, warnings: [...new Set(warnings)] };
}

/**
 * Wraps the original page content in q … Q, so a content stream that leaves
 * the graphics state changed (an unbalanced cm, a color) cannot shift or
 * recolor what pdfcraft draws after it.
 */
function isolateContent(doc: PDFDocument, page: PDFPage) {
  page.node.normalize();
  const start = doc.context.register(
    doc.context.contentStream([pushGraphicsState()]),
  );
  const end = doc.context.register(
    doc.context.contentStream([popGraphicsState()]),
  );
  page.node.wrapContentStreams(start, end);
}

/** Reorders, removes and inserts pages so the document matches `entries`. */
function arrangePages(doc: PDFDocument, entries: PageEntry[]): PDFPage[] {
  const originals = doc.getPages();
  for (const entry of entries)
    if (entry.source.kind === "original" && !originals[entry.source.index])
      throw new EngineError(t("engine.missingPage", entry.source.index + 1));

  for (let i = originals.length - 1; i >= 0; i--) doc.removePage(i);
  return entries.map((entry, index) => {
    if (entry.source.kind === "original")
      return doc.insertPage(index, originals[entry.source.index]!);
    const [x0, y0, x1, y1] = entry.box;
    const page = doc.insertPage(index, [x1 - x0, y1 - y0]);
    page.setMediaBox(x0, y0, x1 - x0, y1 - y0);
    return page;
  });
}

async function drawItem(
  doc: PDFDocument,
  page: PDFPage,
  item: Item,
  fonts: FontCache,
  now: Date,
): Promise<void> {
  switch (item.kind) {
    case "whiteout":
      page.drawRectangle({
        ...item.rect,
        color: hexToRgb("#ffffff"),
        borderWidth: 0,
      });
      return;
    case "text":
      return drawText(page, item, fonts);
    case "image":
      return drawImage(doc, page, item);
    case "annotation":
      return addAnnotation(doc, page, item, { fonts, now });
    case "annotRemoval":
      removeAnnotation(doc, item.source);
      return;
    case "formValue":
    case "formField":
      return; // written by applyForms (spec 005)
    case "textEdit":
      return; // drawn by editPageText before other items
    case "ocr":
      return; // drawn with the page's edits of scanned text (spec 010)
    case "signature":
      return drawSignature(doc, page, item, fonts);
    case "signField":
      return; // written by the signing plan, not drawn (spec 004)
    case "redaction":
      return; // applied after every page is drawn (spec 012)
  }
}

async function drawText(page: PDFPage, item: TextItem, fonts: FontCache) {
  if (item.text.trim() === "") return;
  const { style } = item;
  const font = await fonts.forText(
    item.text,
    style.font,
    style.bold,
    style.italic,
  );
  drawTextWith(page, item.text.replace(/\r\n?/g, "\n"), font, {
    x: item.at.x,
    y: item.at.y,
    size: style.size,
    color: style.color,
    lineHeight: style.size * style.lineHeight,
    rotate: item.rotate,
  });
}

async function drawImage(doc: PDFDocument, page: PDFPage, item: ImageItem) {
  const image =
    item.mime === "image/png"
      ? await doc.embedPng(item.data)
      : await doc.embedJpg(item.data);
  page.drawImage(image, {
    ...imagePlacement(item.rect, item.rotate),
    rotate: degrees(item.rotate),
  });
}

/**
 * pdf-lib rotates images around their bottom-left corner. Returns the origin
 * and drawing size so the rotated image exactly covers `rect`.
 */
export function imagePlacement(
  rect: { x: number; y: number; width: number; height: number },
  rotate: 0 | 90 | 180 | 270,
) {
  const { x, y, width: w, height: h } = rect;
  switch (rotate) {
    case 0:
      return { x, y, width: w, height: h };
    case 90:
      return { x: x + w, y, width: h, height: w };
    case 180:
      return { x: x + w, y: y + h, width: w, height: h };
    case 270:
      return { x, y: y + h, width: h, height: w };
  }
}
