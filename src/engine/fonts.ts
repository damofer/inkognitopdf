import { Encodings } from "@pdf-lib/standard-fonts";
import {
  PDFHexString,
  StandardFonts,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { FontFamily } from "../model/document";
import type { HandwritingFont } from "../model/signature";
import { parseHexColor } from "./color";
import { SubstituteFont } from "./substituteFont";

/**
 * Open fonts (SIL OFL 1.1) bundled with the app, metric-compatible with the
 * usual document fonts: Arimo ↔ Arial/Helvetica, Tinos ↔ Times New Roman,
 * Cousine ↔ Courier New, Carlito ↔ Calibri, Caladea ↔ Cambria.
 */
export type SubstituteFamily =
  | "Arimo"
  | "Tinos"
  | "Cousine"
  | "Carlito"
  | "Caladea"
  // Handwriting fonts for typed signatures (spec 004); Regular only.
  | HandwritingFont;
export const SUBSTITUTE_FAMILIES: SubstituteFamily[] = [
  "Arimo",
  "Tinos",
  "Cousine",
  "Carlito",
  "Caladea",
];
export type FontVariant = "Regular" | "Bold" | "Italic" | "BoldItalic";
export const FONT_VARIANTS: FontVariant[] = [
  "Regular",
  "Bold",
  "Italic",
  "BoldItalic",
];
/** Loads the TTF of a bundled font, e.g. from `/fonts/Arimo-Bold.ttf`. */
export type LoadFont = (
  family: SubstituteFamily,
  variant: FontVariant,
) => Promise<Uint8Array>;

export const STANDARD: Record<
  FontFamily,
  Record<FontVariant, StandardFonts>
> = {
  Helvetica: {
    Regular: StandardFonts.Helvetica,
    Bold: StandardFonts.HelveticaBold,
    Italic: StandardFonts.HelveticaOblique,
    BoldItalic: StandardFonts.HelveticaBoldOblique,
  },
  Times: {
    Regular: StandardFonts.TimesRoman,
    Bold: StandardFonts.TimesRomanBold,
    Italic: StandardFonts.TimesRomanItalic,
    BoldItalic: StandardFonts.TimesRomanBoldItalic,
  },
  Courier: {
    Regular: StandardFonts.Courier,
    Bold: StandardFonts.CourierBold,
    Italic: StandardFonts.CourierOblique,
    BoldItalic: StandardFonts.CourierBoldOblique,
  },
};

/** Open equivalent of each standard family. */
export const SUBSTITUTE_OF: Record<FontFamily, SubstituteFamily> = {
  Helvetica: "Arimo",
  Times: "Tinos",
  Courier: "Cousine",
};

export function variantOf(bold: boolean, italic: boolean): FontVariant {
  if (bold && italic) return "BoldItalic";
  if (bold) return "Bold";
  if (italic) return "Italic";
  return "Regular";
}

/** True when every character can be written with a standard font (WinAnsi). */
export function isWinAnsiEncodable(text: string): boolean {
  for (const ch of text.replace(/[\r\n]/g, "")) {
    if (!Encodings.WinAnsi.canEncodeUnicodeCodePoint(ch.codePointAt(0)!))
      return false;
  }
  return true;
}

/** Embeds fonts once per document and remembers whether a substitute was needed. */
export class FontCache {
  private readonly cache = new Map<string, Promise<PDFFont>>();
  private readonly substitutes = new Map<string, Promise<SubstituteFont>>();
  usedFallback = false;

  constructor(
    private readonly doc: PDFDocument,
    private readonly loadFont: LoadFont,
  ) {}

  standard(name: StandardFonts): Promise<PDFFont> {
    const key = `std:${name}`;
    let font = this.cache.get(key);
    if (!font) {
      font = this.doc.embedFont(name);
      this.cache.set(key, font);
    }
    return font;
  }

  /** Font for `text`: the requested standard font, or its open equivalent if needed. */
  async forText(
    text: string,
    family: FontFamily,
    bold: boolean,
    italic: boolean,
  ): Promise<PDFFont | SubstituteFont> {
    const variant = variantOf(bold, italic);
    if (isWinAnsiEncodable(text))
      return this.standard(STANDARD[family][variant]);
    this.usedFallback = true;
    return this.substitute(SUBSTITUTE_OF[family], variant);
  }

  /** A bundled open font, embedded (subset) by `embedAll`. */
  substitute(
    family: SubstituteFamily,
    variant: FontVariant,
  ): Promise<SubstituteFont> {
    const key = `${family}-${variant}`;
    let font = this.substitutes.get(key);
    if (!font) {
      font = this.loadFont(family, variant).then(
        (bytes) => new SubstituteFont(this.doc, family, variant, bytes),
      );
      this.substitutes.set(key, font);
    }
    return font;
  }

  /**
   * Writes the fonts used; call once, before saving. `PDFDocument.save` would
   * write the standard ones, but an incremental update (spec 004) does not
   * call it: without this, its text points to a font object that is never
   * written, and only pdf.js draws it.
   */
  async embedAll(): Promise<void> {
    for (const font of this.cache.values()) await (await font).embed();
    for (const font of this.substitutes.values()) (await font).embed(this.doc);
  }
}

export interface DrawTextOptions {
  x: number;
  y: number;
  size: number;
  color: string;
  lineHeight: number;
  /** Degrees counter-clockwise. */
  rotate: number;
}

/** Draws (multi-line) text with a standard font or a substitute font. */
export function drawTextWith(
  page: PDFPage,
  text: string,
  font: PDFFont | SubstituteFont,
  { x, y, size, color, lineHeight, rotate }: DrawTextOptions,
): void {
  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const name = page.node.newFontDictionary(font.name, font.ref);
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setFontAndSize(name, size),
    setFillingRgbColor(...parseHexColor(color)),
    ...text.split("\n").flatMap((line, i) => {
      const dy = -i * lineHeight;
      return [
        setTextMatrix(cos, sin, -sin, cos, x - sin * dy, y + cos * dy),
        showText(
          font instanceof SubstituteFont
            ? font.encode(line)
            : (font.encodeText(line) as PDFHexString),
        ),
      ];
    }),
    endText(),
    popGraphicsState(),
  );
}
