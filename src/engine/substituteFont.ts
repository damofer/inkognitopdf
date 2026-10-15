import fontkit from "@pdf-lib/fontkit";
import {
  PDFHexString,
  PDFString,
  type PDFDocument,
  type PDFRef,
} from "pdf-lib";
import type { FontVariant, SubstituteFamily } from "./fonts";
import { subsetTrueType } from "./ttfSubset";

type FontkitFont = ReturnType<typeof fontkit.create>;

const hex4 = (n: number) => n.toString(16).padStart(4, "0");

/**
 * A bundled open font embedded as Type0 / CIDFontType2 with Identity-H and an
 * identity CIDToGIDMap: codes in content streams are glyph ids. Glyphs are
 * recorded as text is encoded; `embed` writes the font, subset to them, under
 * the reference handed out at creation (content can use it before embedding).
 */
export class SubstituteFont {
  readonly ref: PDFRef;
  readonly name: string;
  private readonly font: FontkitFont;
  private readonly used = new Map<number, string>();

  constructor(
    doc: PDFDocument,
    readonly family: SubstituteFamily,
    readonly variant: FontVariant,
    private readonly bytes: Uint8Array,
  ) {
    this.font = fontkit.create(bytes);
    this.ref = doc.context.nextRef();
    this.name = this.font.postscriptName ?? `${family}-${variant}`;
  }

  /** True when the font has a glyph for every character of `text`. */
  covers(text: string): boolean {
    return [...text].every((ch) =>
      this.font.hasGlyphForCodePoint(ch.codePointAt(0)!),
    );
  }

  private glyph(ch: string) {
    const glyph = this.font.glyphForCodePoint(ch.codePointAt(0)!);
    this.used.set(glyph.id, ch);
    return glyph;
  }

  /** Ascender and descender (negative), per unit of font size. */
  get ascent(): number {
    return this.font.ascent / this.font.unitsPerEm;
  }

  get descent(): number {
    return this.font.descent / this.font.unitsPerEm;
  }

  /** Hex string of glyph ids for `text`, for Tj/TJ. */
  encode(text: string): PDFHexString {
    return PDFHexString.of(
      [...text].map((ch) => hex4(this.glyph(ch).id)).join(""),
    );
  }

  /** Advance of `text` in text space units per unit of font size. */
  widthOf(text: string): number {
    let width = 0;
    for (const ch of text)
      width += this.glyph(ch).advanceWidth / this.font.unitsPerEm;
    return width;
  }

  /** Writes the font objects; call once, after all text is encoded. */
  embed(doc: PDFDocument): void {
    const { context } = doc;
    const scale = 1000 / this.font.unitsPerEm;
    const gids = [...this.used.keys()].sort((a, b) => a - b);
    const program = subsetTrueType(this.bytes, gids);
    const tag = gids
      .reduce((h, g) => (h * 31 + g) % 26 ** 6, 7)
      .toString(26)
      .padStart(6, "0")
      .replace(/./g, (c) => String.fromCharCode(65 + parseInt(c, 26)));
    const baseFont = `${tag}+${this.name}`;
    const fontFile = context.register(
      context.flateStream(program, { Length1: program.length }),
    );
    const bold = this.variant === "Bold" || this.variant === "BoldItalic";
    const italic = this.variant === "Italic" || this.variant === "BoldItalic";
    const { bbox } = this.font;
    const descriptor = context.register(
      context.obj({
        Type: "FontDescriptor",
        FontName: baseFont,
        Flags:
          (this.family === "Cousine" ? 1 : 0) |
          (this.family === "Tinos" || this.family === "Caladea" ? 2 : 0) |
          32 |
          (italic ? 64 : 0) |
          (bold ? 0x40000 : 0),
        FontBBox: [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].map((v) =>
          Math.round(v * scale),
        ),
        ItalicAngle: this.font.italicAngle,
        Ascent: Math.round(this.font.ascent * scale),
        Descent: Math.round(this.font.descent * scale),
        CapHeight: Math.round(
          (this.font.capHeight || this.font.ascent) * scale,
        ),
        StemV: bold ? 140 : 80,
        FontWeight: bold ? 700 : 400,
        FontFile2: fontFile,
      }),
    );
    const widths: (number | number[])[] = [];
    for (const gid of gids)
      widths.push(gid, [
        Math.round(this.font.getGlyph(gid).advanceWidth * scale),
      ]);
    const cidFont = context.register(
      context.obj({
        Type: "Font",
        Subtype: "CIDFontType2",
        BaseFont: baseFont,
        CIDSystemInfo: {
          Registry: PDFString.of("Adobe"),
          Ordering: PDFString.of("Identity"),
          Supplement: 0,
        },
        FontDescriptor: descriptor,
        DW: 1000,
        W: widths,
        CIDToGIDMap: "Identity",
      }),
    );
    const toUnicode = context.register(
      context.flateStream(toUnicodeCMap(this.used)),
    );
    context.assign(
      this.ref,
      context.obj({
        Type: "Font",
        Subtype: "Type0",
        BaseFont: baseFont,
        Encoding: "Identity-H",
        DescendantFonts: [cidFont],
        ToUnicode: toUnicode,
      }),
    );
  }
}

function utf16Hex(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) out += hex4(text.charCodeAt(i));
  return out;
}

function toUnicodeCMap(used: Map<number, string>): string {
  const entries = [...used].sort((a, b) => a[0] - b[0]);
  const lines = [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <ffff>",
    "endcodespacerange",
  ];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    lines.push(`${chunk.length} beginbfchar`);
    for (const [gid, text] of chunk)
      lines.push(`<${hex4(gid)}> <${utf16Hex(text)}>`);
    lines.push("endbfchar");
  }
  lines.push(
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  );
  return lines.join("\n");
}
