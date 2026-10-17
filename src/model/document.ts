import type { Box, Point, Rect, Rotation } from "./geometry";
import type { Numbering } from "./numbering";
import type { SignatureAsset, SignatureRole, SignFieldType } from "./signature";

/**
 * In-memory edit state of a document. It never contains PDF bytes; the engine
 * (src/engine) turns the original file plus this state into a new PDF.
 */
export type PageSource =
  | { kind: "original"; index: number }
  | { kind: "blank" }
  | { kind: "scan"; image: ScanImage };

/**
 * Image of a scanned page (spec 002), drawn over the whole page. A JPEG is
 * embedded as is; "bw" is 1 bit per pixel, rows padded to whole bytes, most
 * significant bit first, 1 = white.
 */
export interface ScanImage {
  format: "jpeg" | "bw";
  data: Uint8Array;
  width: number;
  height: number;
}

export interface PageEntry {
  /** Stable id: edits refer to pages by id, so page operations do not break them. */
  id: string;
  source: PageSource;
  /** User space box (MediaBox of the original page, or the blank page size). */
  box: Box;
  /** /Rotate of the original page (0 for blank pages). */
  baseRotation: Rotation;
  /** Rotation added by the user, in degrees. */
  extraRotation: Rotation;
}

export type FontFamily = "Helvetica" | "Times" | "Courier";

export interface TextStyle {
  font: FontFamily;
  /** Points. */
  size: number;
  /** Hex color, e.g. "#000000". */
  color: string;
  bold: boolean;
  italic: boolean;
  /** Multiple of the font size. */
  lineHeight: number;
}

interface ItemBase {
  id: string;
  pageId: string;
}

export interface TextItem extends ItemBase {
  kind: "text";
  /** Baseline origin of the first line. */
  at: Point;
  text: string;
  style: TextStyle;
  /** Degrees counter-clockwise, so text reads upright on rotated pages. */
  rotate: number;
}

export interface ImageItem extends ItemBase {
  kind: "image";
  rect: Rect;
  mime: "image/png" | "image/jpeg";
  /** Image bytes (PNG or JPEG). */
  data: Uint8Array;
  /** Degrees counter-clockwise, so the image looks upright on rotated pages. */
  rotate: 0 | 90 | 180 | 270;
}

export interface WhiteoutItem extends ItemBase {
  kind: "whiteout";
  rect: Rect;
}

export type AnnotationShape =
  | "highlight"
  | "underline"
  | "strikeout"
  | "ink"
  | "line"
  | "arrow"
  | "square"
  | "circle"
  | "note"
  | "freeText";

/** Shapes drawn over selected text, one rect per line. */
export const TEXT_MARKUP: ReadonlySet<AnnotationShape> = new Set([
  "highlight",
  "underline",
  "strikeout",
]);

export interface AnnotationItem extends ItemBase {
  kind: "annotation";
  shape: AnnotationShape;
  /** Stroke color; text color of a free text. */
  color: string;
  /** Stroke width in points (not used by text markup, notes and free text). */
  width: number;
  /**
   * Text markup: one rect per text line; square, circle and free text: one
   * rect; note: the rect of its icon.
   */
  rects?: Rect[];
  /** ink: strokes; line and arrow: one stroke of two points. */
  paths?: Point[][];
  /** Interior color of a square or circle (spec 005). */
  fill?: string;
  /** Text of a note or a free text. */
  text?: string;
  /** Font of a free text. */
  font?: FontFamily;
  fontSize?: number;
  /**
   * Annotation of the original file this one replaces, as "12 0 R" (spec 005,
   * CA8). Its other keys (author, dates, popup) are kept when saving.
   */
  source?: string;
}

/** An annotation of the original file, removed (spec 005, CA8). */
export interface AnnotRemovalItem extends ItemBase {
  kind: "annotRemoval";
  source: string;
}

/**
 * Value of a form field, by its fully qualified name (spec 005, HU1). For
 * check boxes and radio buttons it is the name of the state ("Off" for none).
 * The last value of a name wins.
 */
export interface FormValueItem extends ItemBase {
  kind: "formValue";
  name: string;
  value: string | string[];
}

export type FormFieldType =
  "text" | "multiline" | "checkbox" | "radio" | "dropdown" | "list";

/**
 * A form field created in pdfcraft (spec 005, HU3). Radio buttons with the
 * same name are one group.
 */
export interface FormFieldItem extends ItemBase {
  kind: "formField";
  field: FormFieldType;
  name: string;
  rect: Rect;
  /** Choices of a dropdown or list. */
  options?: string[];
  /** Name of the "on" state of a check box or radio button. */
  exportValue?: string;
  align: "left" | "center" | "right";
  required: boolean;
  maxLength?: number;
  /** Text split into `maxLength` boxes. */
  comb?: boolean;
  multiSelect?: boolean;
  /** Size 0 is automatic. */
  style: { font: FontFamily; size: number; color: string };
}

/** Replacement of existing page text (spec 001, HU3). */
export interface TextEditItem extends ItemBase {
  kind: "textEdit";
  /** Area of the original text, in user space. */
  area: Rect;
  originalText: string;
  text: string;
  /** Baseline origin of the original text. */
  at: Point;
  /** Font size of the original text, in points. */
  size: number;
  /** Degrees counter-clockwise of the original text direction. */
  rotate: number;
  /** CSS font family for the preview: the viewer's font, then an open equivalent. */
  previewFont?: string;
  /** Color, weight and style of the original text, for the preview. */
  color: string;
  bold?: boolean;
  italic?: boolean;
  /**
   * Text of a scanned image (spec 010): the area is painted with this paper
   * color and the new text is drawn visibly over it. The page content is
   * not rewritten (only invisible OCR glyphs in the area are removed).
   */
  background?: string;
  /** The recognized line was doubtful (handwriting, blur): spec 010, CA7. */
  lowConfidence?: boolean;
}

/** Whether a text edit replaces text of a scanned image (spec 010). */
export const isImageTextEdit = (item: TextEditItem) =>
  item.background !== undefined;

/**
 * A box along the text direction: `at` is its bottom-left corner in user
 * space, `width` runs along the baseline and `height` across it.
 */
export interface OcrBox {
  at: Point;
  width: number;
  height: number;
}

export interface OcrWord extends OcrBox {
  text: string;
  /** Tesseract confidence, 0–100. */
  confidence: number;
}

export interface OcrLine extends OcrBox {
  words: OcrWord[];
}

/** Text recognized on a scanned page (spec 003): an invisible text layer. */
export interface OcrItem extends ItemBase {
  kind: "ocr";
  /** Tesseract language codes, e.g. "spa+eng". */
  lang: string;
  /** Degrees counter-clockwise of the text direction in user space. */
  rotate: number;
  lines: OcrLine[];
}

/** A signature or initials placed on the page (spec 004, HU3). */
export interface SignatureItem extends ItemBase {
  kind: "signature";
  role: SignatureRole;
  rect: Rect;
  asset: SignatureAsset;
  /** Degrees counter-clockwise, so it looks upright on rotated pages. */
  rotate: 0 | 90 | 180 | 270;
}

/** A field to be filled by a signer of a signing plan (spec 004, HU6). */
export interface SignFieldItem extends ItemBase {
  kind: "signField";
  rect: Rect;
  field: SignFieldType;
  signerId: string;
}

/**
 * An area of secure redaction (spec 012). While pending it is only a mark;
 * once applied, saving removes everything under it from the file and draws
 * it black.
 */
export interface RedactionItem extends ItemBase {
  kind: "redaction";
  rect: Rect;
  applied: boolean;
  /** Applied together with removing the document metadata. */
  clearMetadata?: boolean;
  /** The search that marked it (CA2), looked for elsewhere too (CA13). */
  query?: { text: string; regex: boolean };
  /**
   * Applied together with removing, elsewhere in the file (notes, bookmarks,
   * attachments, field values, metadata), what was under the areas and what
   * was searched (CA13).
   */
  elsewhere?: Needles;
}

/** Texts (any case and accents) and regular expressions to look for. */
export interface Needles {
  texts: string[];
  patterns: string[];
}

export type Item =
  | RedactionItem
  | SignFieldItem
  | TextItem
  | ImageItem
  | WhiteoutItem
  | AnnotationItem
  | TextEditItem
  | OcrItem
  | SignatureItem
  | AnnotRemovalItem
  | FormValueItem
  | FormFieldItem;

export interface EditorState {
  pages: PageEntry[];
  items: Item[];
  /**
   * Page numbers, headers and footers (spec 022): a setting of the whole
   * document, so the count follows the order of the pages.
   */
  numbering?: Numbering;
}

export interface OriginalPageInfo {
  box: Box;
  rotation: Rotation;
}

export function initialState(pages: OriginalPageInfo[]): EditorState {
  return {
    pages: pages.map((p, index) => ({
      id: `p${index}`,
      source: { kind: "original", index },
      box: p.box,
      baseRotation: p.rotation,
      extraRotation: 0,
    })),
    items: [],
  };
}

export function effectiveRotation(page: PageEntry): Rotation {
  return ((page.baseRotation + page.extraRotation) % 360) as Rotation;
}

/** True when the state would produce exactly the original file. */
export function isPristine(
  state: EditorState,
  originalPageCount: number,
): boolean {
  return (
    state.items.length === 0 &&
    !state.numbering &&
    state.pages.length === originalPageCount &&
    state.pages.every(
      (p, i) =>
        p.source.kind === "original" &&
        p.source.index === i &&
        p.extraRotation === 0,
    )
  );
}

export const A4: Box = [0, 0, 595.28, 841.89];
