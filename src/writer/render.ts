// Spec 032: the writer's document as a PDF with real text. The app's open
// fonts are embedded as subsets, so the text can be selected and searched.
import {
  PDFDocument,
  beginText,
  endText,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type PDFImage,
  type PDFName,
} from "pdf-lib";
import type { Node } from "prosemirror-model";
import { BRAND } from "../brand";
import { hexToRgb, parseHexColor } from "../engine/color";
import type { LoadFont } from "../engine/fonts";
import { SubstituteFont } from "../engine/substituteFont";
import { printable } from "../templates/render";
import { PAPER, type PaperSize } from "../templates/types";
import { flowOf, titleOf, type FlowBlock } from "./flow";
import {
  layoutWriter,
  type FaceOf,
  type PageSetup,
  type WriterLayout,
} from "./layout";
import type { WriterFamily } from "./schema";

/** One inch, as Word and Google Docs. */
export const MARGIN = 72;

export interface WriterSettings {
  paper: PaperSize;
  /** Font of text without a font of its own. */
  family: WriterFamily;
}

export const pageSetup = (paper: PaperSize): PageSetup => {
  const [width, height] = PAPER[paper];
  return { width, height, margin: MARGIN };
};

const variantOf = (bold: boolean, italic: boolean) =>
  bold && italic ? "BoldItalic" : bold ? "Bold" : italic ? "Italic" : "Regular";

/** Every font the blocks use, as "Family-Variant". */
export function facesUsed(blocks: FlowBlock[]): Set<string> {
  const faces = new Set<string>();
  for (const block of blocks) {
    if (block.kind !== "text") continue;
    for (const style of [
      block.base,
      ...block.runs.map((r) => r.style),
      ...(block.marker ? [block.marker.style] : []),
    ])
      faces.add(`${style.family}-${variantOf(style.bold, style.italic)}`);
  }
  return faces;
}

/** Fonts by "Family-Variant", for the layout and for drawing. */
export class FaceSet {
  constructor(private readonly fonts: Map<string, SubstituteFont>) {}

  static async load(
    doc: PDFDocument,
    faces: Iterable<string>,
    loadFont: LoadFont,
  ): Promise<FaceSet> {
    const fonts = new Map<string, SubstituteFont>();
    await Promise.all(
      [...faces].map(async (key) => {
        const [family, variant] = key.split("-") as [
          WriterFamily,
          ReturnType<typeof variantOf>,
        ];
        const bytes = await loadFont(family, variant);
        fonts.set(key, new SubstituteFont(doc, family, variant, bytes));
      }),
    );
    return new FaceSet(fonts);
  }

  font(family: WriterFamily, bold: boolean, italic: boolean): SubstituteFont {
    const font = this.fonts.get(`${family}-${variantOf(bold, italic)}`);
    if (!font) throw new Error(`Font not loaded: ${family}`); // i18n-ignore: never shown, fonts are loaded first
    return font;
  }

  /** Metrics for the layout; text is measured as it will be drawn. */
  readonly faceOf: FaceOf = (family, bold, italic) => {
    const font = this.font(family, bold, italic);
    return {
      width: (text) => font.widthOf(printable(font, text)),
      ascent: font.ascent,
      descent: -font.descent,
    };
  };

  get all(): SubstituteFont[] {
    return [...this.fonts.values()];
  }
}

/** Layout of a document with fonts already loaded in `faces`. */
export function layoutDoc(
  doc: Node,
  settings: WriterSettings,
  faces: FaceSet,
): WriterLayout {
  return layoutWriter(
    flowOf(doc, settings.family),
    pageSetup(settings.paper),
    faces.faceOf,
  );
}

function dataUrlBytes(src: string): { bytes: Uint8Array; png: boolean } {
  const [head = "", data = ""] = src.split(",", 2);
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, png: head.includes("image/png") };
}

export async function renderWriter(
  content: Node,
  settings: WriterSettings,
  loadFont: LoadFont,
): Promise<{ bytes: Uint8Array; pages: number; title: string }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const title = titleOf(content);
  if (title) doc.setTitle(title, { showInWindowTitleBar: true });
  doc.setProducer(BRAND);
  doc.setCreator(BRAND);
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

  const blocks = flowOf(content, settings.family);
  const faces = await FaceSet.load(doc, facesUsed(blocks), loadFont);
  const setup = pageSetup(settings.paper);
  const laid = layoutWriter(blocks, setup, faces.faceOf);

  const images = new Map<string, PDFImage>();
  for (const ops of laid.pages) {
    const page = doc.addPage([setup.width, setup.height]);
    const H = setup.height;
    const names = new Map<SubstituteFont, PDFName>();
    const fontName = (font: SubstituteFont) => {
      let name = names.get(font);
      if (!name) {
        name = page.node.newFontDictionary(`F${names.size + 1}`, font.ref);
        names.set(font, name);
      }
      return name;
    };
    for (const op of ops) {
      if (op.kind === "rect")
        page.drawRectangle({
          x: op.x,
          y: H - op.y - op.h,
          width: op.w,
          height: op.h,
          color: hexToRgb(op.fill),
        });
      else if (op.kind === "line")
        page.drawLine({
          start: { x: op.x1, y: H - op.y1 },
          end: { x: op.x2, y: H - op.y2 },
          thickness: op.width,
          color: hexToRgb(op.color),
        });
      else if (op.kind === "image") {
        let image = images.get(op.src);
        if (!image) {
          const { bytes, png } = dataUrlBytes(op.src);
          image = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
          images.set(op.src, image);
        }
        page.drawImage(image, {
          x: op.x,
          y: H - op.y - op.h,
          width: op.w,
          height: op.h,
        });
      } else {
        const { style } = op;
        const font = faces.font(style.family, style.bold, style.italic);
        page.pushOperators(
          beginText(),
          setFillingRgbColor(...parseHexColor(style.color)),
          setFontAndSize(fontName(font), style.size),
          setTextMatrix(1, 0, 0, 1, op.x, H - op.y),
          showText(font.encode(printable(font, op.text))),
          endText(),
        );
      }
    }
  }
  for (const font of faces.all) font.embed(doc);
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pages: laid.pages.length, title };
}
