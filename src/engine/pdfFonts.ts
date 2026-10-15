import { Encodings, Font, FontNames } from "@pdf-lib/standard-fonts";
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";
import type { FontFamily } from "../model/document";
import type { SubstituteFamily } from "./fonts";
import { readTables } from "./ttfSubset";

/**
 * What the text-edit engine needs to know about a font used on a page: how
 * to split strings into character codes, their widths, their Unicode text,
 * and whether the font can be reused for new text (spec 001, T019–T021).
 */
export interface FontInfo {
  resourceName: string;
  /** The font dictionary (or its reference), to reuse it from another stream. */
  ref: PDFRef | PDFDict;
  subtype: string;
  /** BaseFont without the subset prefix ("ABCDEF+"). */
  baseFont: string;
  bytesPerCode: 1 | 2;
  /** Horizontal displacement of a code, in text space units per unit font size. */
  widthOf(code: number): number;
  /** Unicode text of a code, when known. */
  unicodeOf(code: number): string | undefined;
  /** Code that shows `char` with this font, when the font has it. */
  codeFor(char: string): number | undefined;
  /**
   * Splits `text` into the glyphs of this font (ligatures included), with
   * `code` null for characters the font cannot show.
   */
  encode(text: string): { text: string; code: number | null }[];
  /** Standard-14 font name, when the font is a non-embedded standard font. */
  standard: FontNames | null;
  embedded: boolean;
  family: FontFamily;
  /** Open, metric-compatible font used for characters the font lacks. */
  substitute: SubstituteFamily;
  bold: boolean;
  italic: boolean;
}

function lookup(doc: PDFDocument, obj: PDFObject | undefined) {
  return obj === undefined ? undefined : doc.context.lookup(obj);
}

function get(doc: PDFDocument, dict: PDFDict | undefined, key: string) {
  return dict ? lookup(doc, dict.get(PDFName.of(key))) : undefined;
}

const num = (o: PDFObject | undefined, fallback = 0) =>
  o instanceof PDFNumber ? o.asNumber() : fallback;

const nameOf = (o: PDFObject | undefined) =>
  o instanceof PDFName ? o.decodeText() : undefined;

function streamBytes(doc: PDFDocument, obj: PDFObject | undefined) {
  const s = lookup(doc, obj);
  if (s instanceof PDFRawStream) return decodePDFRawStream(s).decode();
  if (s instanceof PDFStream) return s.getContents();
  return undefined;
}

/** WinAnsi code → glyph name and Unicode, from @pdf-lib/standard-fonts. */
const winAnsi = (() => {
  const byCode = new Map<number, { name: string; unicode: string }>();
  for (const cp of Encodings.WinAnsi.supportedCodePoints) {
    const { code, name } = Encodings.WinAnsi.encodeUnicodeCodePoint(cp);
    if (!byCode.has(code))
      byCode.set(code, { name, unicode: String.fromCodePoint(cp) });
  }
  return byCode;
})();
/** Glyph name → Unicode; the lowest code point wins ("space" is U+0020, not U+00A0). */
const unicodeByGlyphName = (() => {
  const map = new Map<string, string>();
  for (const cp of [...Encodings.WinAnsi.supportedCodePoints].sort(
    (a, b) => a - b,
  )) {
    const { name } = Encodings.WinAnsi.encodeUnicodeCodePoint(cp);
    if (!map.has(name)) map.set(name, String.fromCodePoint(cp));
  }
  return map;
})();

function standardName(base: string): FontNames | null {
  const bold = /bold|black|heavy/i.test(base);
  const italic = /italic|oblique/i.test(base);
  const pick = (r: FontNames, b: FontNames, i: FontNames, bi: FontNames) =>
    bold && italic ? bi : bold ? b : italic ? i : r;
  if (/^symbol$/i.test(base)) return FontNames.Symbol;
  if (/^zapfdingbats$/i.test(base)) return FontNames.ZapfDingbats;
  if (/courier/i.test(base))
    return pick(
      FontNames.Courier,
      FontNames.CourierBold,
      FontNames.CourierOblique,
      FontNames.CourierBoldOblique,
    );
  if (/times/i.test(base))
    return pick(
      FontNames.TimesRoman,
      FontNames.TimesRomanBold,
      FontNames.TimesRomanItalic,
      FontNames.TimesRomanBoldItalic,
    );
  if (/helvetica|arial/i.test(base))
    return pick(
      FontNames.Helvetica,
      FontNames.HelveticaBold,
      FontNames.HelveticaOblique,
      FontNames.HelveticaBoldOblique,
    );
  return null;
}

const metricsCache = new Map<FontNames, Font>();
function metrics(name: FontNames): Font {
  let font = metricsCache.get(name);
  if (!font) {
    font = Font.load(name);
    metricsCache.set(name, font);
  }
  return font;
}

/** Parses the bfchar and bfrange sections of a ToUnicode CMap. */
export function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  const utf16 = (hex: string) => {
    const units: number[] = [];
    for (let i = 0; i + 4 <= hex.length; i += 4)
      units.push(parseInt(hex.slice(i, i + 4), 16));
    if (hex.length === 2) units.push(parseInt(hex, 16));
    return String.fromCharCode(...units);
  };
  const sections = /begin(bfchar|bfrange)([\s\S]*?)end\1/g;
  for (const [, kind, body] of cmap.matchAll(sections)) {
    const tokens = [...body!.matchAll(/<([0-9a-fA-F\s]*)>|\[|\]/g)].map((m) =>
      m[1] !== undefined ? m[1].replace(/\s/g, "") : m[0],
    );
    let i = 0;
    if (kind === "bfchar") {
      for (; i + 1 < tokens.length; i += 2)
        map.set(parseInt(tokens[i]!, 16), utf16(tokens[i + 1]!));
      continue;
    }
    while (i + 2 < tokens.length) {
      const lo = parseInt(tokens[i++]!, 16);
      const hi = parseInt(tokens[i++]!, 16);
      if (tokens[i] === "[") {
        i++;
        for (let code = lo; code <= hi && tokens[i] !== "]"; code++)
          map.set(code, utf16(tokens[i++]!));
        i++; // ]
      } else {
        const dst = tokens[i++]!;
        const prefix = dst.slice(0, -4);
        const last = parseInt(dst.slice(-4), 16);
        for (let code = lo; code <= hi && code - lo < 0x10000; code++)
          map.set(
            code,
            utf16(prefix + (last + code - lo).toString(16).padStart(4, "0")),
          );
      }
    }
  }
  return map;
}

/** Reads every font of the page's /Resources /Font dictionary. */
export function pageFonts(
  doc: PDFDocument,
  page: PDFPage,
): Map<string, FontInfo> {
  return fontsOf(doc, page.node.normalizedEntries().Resources);
}

/** Reads every font of a /Resources dictionary. */
export function fontsOf(
  doc: PDFDocument,
  resources: PDFDict | undefined,
): Map<string, FontInfo> {
  const fonts = new Map<string, FontInfo>();
  const fontDict = get(doc, resources, "Font");
  if (!(fontDict instanceof PDFDict)) return fonts;
  for (const [key, value] of fontDict.entries()) {
    const dict = lookup(doc, value);
    if (dict instanceof PDFDict)
      fonts.set(
        key.decodeText(),
        fontInfo(
          doc,
          key.decodeText(),
          dict,
          value instanceof PDFRef ? value : dict,
        ),
      );
  }
  return fonts;
}

/** Metric-compatible open font for a PDF font name and descriptor flags. */
export function substituteFor(baseFont: string, flags = 0): SubstituteFamily {
  for (const family of [
    "Arimo",
    "Tinos",
    "Cousine",
    "Carlito",
    "Caladea",
  ] as const)
    if (baseFont.includes(family)) return family;
  if (/calibri/i.test(baseFont)) return "Carlito";
  if (/cambria/i.test(baseFont)) return "Caladea";
  if (/courier|consol|mono|menlo|lucida ?console|typewriter/i.test(baseFont))
    return "Cousine";
  if (
    /times|georgia|garamond|palatino|antiqua|bookman|minion|serif|roman|cambria|century/i.test(
      baseFont,
    ) &&
    !/sans/i.test(baseFont)
  )
    return "Tinos";
  if ((flags & 1) !== 0) return "Cousine";
  if (
    (flags & 2) !== 0 &&
    !/sans|arial|helvetica|verdana|segoe|tahoma/i.test(baseFont)
  )
    return "Tinos";
  return "Arimo";
}

/**
 * Weight and slant written in an embedded TrueType or OpenType program (OS/2
 * and head tables), for fonts whose name and descriptor say nothing, e.g. a
 * subset named "F2" or an instance of a variable font.
 */
function programStyle(
  doc: PDFDocument,
  desc: PDFDict | undefined,
): { bold: boolean; italic: boolean } {
  const none = { bold: false, italic: false };
  const stream = lookup(
    doc,
    get(doc, desc, "FontFile2") ?? get(doc, desc, "FontFile3"),
  );
  if (!stream) return none;
  let style = programStyles.get(stream);
  if (!style) {
    style = readProgramStyle(streamBytes(doc, stream)) ?? none;
    programStyles.set(stream, style);
  }
  return style;
}

/** Font programs are decoded once. */
const programStyles = new WeakMap<object, { bold: boolean; italic: boolean }>();

function readProgramStyle(program: Uint8Array | undefined) {
  if (!program || program.length < 12) return undefined;
  const magic = String.fromCharCode(...program.subarray(0, 4));
  // OpenType with CFF, Apple TrueType, TrueType (0x00010000).
  const version = new DataView(program.buffer, program.byteOffset).getUint32(0);
  if (magic !== "OTTO" && magic !== "true" && version !== 0x00010000)
    return undefined;
  try {
    const tables = readTables(program);
    const os2 = tables.get("OS/2");
    const head = tables.get("head");
    const view = (b: Uint8Array) =>
      new DataView(b.buffer, b.byteOffset, b.byteLength);
    const weight = os2 && os2.length >= 6 ? view(os2).getUint16(4) : 0;
    const selection = os2 && os2.length >= 64 ? view(os2).getUint16(62) : 0;
    const macStyle = head && head.length >= 46 ? view(head).getUint16(44) : 0;
    return {
      bold: weight >= 600 || (selection & 0x20) !== 0 || (macStyle & 1) !== 0,
      italic: (selection & 1) !== 0 || (macStyle & 2) !== 0,
    };
  } catch {
    return undefined;
  }
}

export function fontInfo(
  doc: PDFDocument,
  resourceName: string,
  dict: PDFDict,
  ref: PDFRef | PDFDict = dict,
): FontInfo {
  const subtype = nameOf(get(doc, dict, "Subtype")) ?? "Type1";
  const rawBase = nameOf(get(doc, dict, "BaseFont")) ?? "";
  const baseFont = rawBase.replace(/^[A-Z]{6}\+/, "");
  const type0 = subtype === "Type0";
  const descendant = type0
    ? (() => {
        const arr = get(doc, dict, "DescendantFonts");
        const first =
          arr instanceof PDFArray ? lookup(doc, arr.get(0)) : undefined;
        return first instanceof PDFDict ? first : undefined;
      })()
    : undefined;
  const descriptor = get(doc, descendant ?? dict, "FontDescriptor");
  const desc = descriptor instanceof PDFDict ? descriptor : undefined;
  const embedded =
    subtype === "Type3" ||
    ["FontFile", "FontFile2", "FontFile3"].some(
      (k) => get(doc, desc, k) !== undefined,
    );
  const flags = num(get(doc, desc, "Flags"));
  const standard = embedded || type0 ? null : standardName(baseFont);

  // Unicode mapping: ToUnicode first, then the simple-font encoding.
  const toUnicodeBytes = streamBytes(doc, dict.get(PDFName.of("ToUnicode")));
  const toUnicode = toUnicodeBytes
    ? parseToUnicode(String.fromCharCode(...toUnicodeBytes))
    : new Map<number, string>();

  // Glyph names for simple fonts: base encoding (WinAnsi assumed) + Differences.
  const glyphNames = new Map<number, string>();
  if (!type0) {
    for (const [code, v] of winAnsi) glyphNames.set(code, v.name);
    const encoding = get(doc, dict, "Encoding");
    if (encoding instanceof PDFDict) {
      const diffs = get(doc, encoding, "Differences");
      if (diffs instanceof PDFArray) {
        let code = 0;
        for (const item of diffs.asArray()) {
          const o = lookup(doc, item);
          if (o instanceof PDFNumber) code = o.asNumber();
          else if (o instanceof PDFName) glyphNames.set(code++, o.decodeText());
        }
      }
    }
  }

  let widthOf: (code: number) => number;
  if (type0) {
    const dw = num(get(doc, descendant, "DW"), 1000);
    const widths = new Map<number, number>();
    const w = get(doc, descendant, "W");
    if (w instanceof PDFArray) {
      const items = w.asArray().map((o) => lookup(doc, o));
      for (let i = 0; i < items.length;) {
        const first = num(items[i]);
        const next = items[i + 1];
        if (next instanceof PDFArray) {
          next
            .asArray()
            .forEach((o, k) => widths.set(first + k, num(lookup(doc, o))));
          i += 2;
        } else {
          const last = num(next);
          const width = num(items[i + 2]);
          for (let c = first; c <= last; c++) widths.set(c, width);
          i += 3;
        }
      }
    }
    widthOf = (code) => (widths.get(code) ?? dw) / 1000;
  } else {
    const firstChar = num(get(doc, dict, "FirstChar"));
    const widthsArr = get(doc, dict, "Widths");
    const widths =
      widthsArr instanceof PDFArray
        ? widthsArr.asArray().map((o) => num(lookup(doc, o)))
        : null;
    const missing = num(get(doc, desc, "MissingWidth"));
    let scale = 1 / 1000;
    if (subtype === "Type3") {
      const matrix = get(doc, dict, "FontMatrix");
      scale =
        matrix instanceof PDFArray
          ? num(lookup(doc, matrix.get(0)), 0.001)
          : 0.001;
    }
    const std = standard ? metrics(standard) : null;
    widthOf = (code) => {
      const w = widths?.[code - firstChar];
      if (w !== undefined) return w * scale;
      if (std) {
        const name = glyphNames.get(code);
        const width = name ? std.getWidthOfGlyph(name) : undefined;
        if (width !== undefined) return width / 1000;
      }
      return missing ? missing * scale : 0.5;
    };
  }

  const unicodeOf = (code: number) =>
    toUnicode.get(code) ??
    (type0 ? undefined : unicodeByGlyphName.get(glyphNames.get(code) ?? ""));

  // Reverse map, used to write new text with the original font.
  let reverse: Map<string, number> | null = null;
  const codeFor = (char: string) => {
    if (!reverse) {
      reverse = new Map();
      // Only codes that ToUnicode declares are trusted for embedded fonts;
      // standard fonts have every glyph of their encoding.
      const source = embedded || type0 ? toUnicode : null;
      if (source)
        for (const [code, u] of source)
          if (!reverse.has(u)) reverse.set(u, code);
      if (!embedded && !type0)
        for (const [code, name] of glyphNames) {
          const u = unicodeByGlyphName.get(name);
          if (u && !reverse.has(u)) reverse.set(u, code);
        }
    }
    return reverse.get(char);
  };

  // Multi-character ToUnicode entries are ligatures ("fi", "ffi"…).
  const ligatures = [...toUnicode]
    .filter(([, u]) => [...u].length > 1 && [...u].length <= 4)
    .sort((a, b) => b[1].length - a[1].length);
  const encode = (text: string) => {
    const glyphs: { text: string; code: number | null }[] = [];
    const chars = [...text];
    for (let i = 0; i < chars.length;) {
      // Ligature glyphs first, as the original typesetting used them.
      const lig = ligatures.find(([, u]) =>
        [...u].every((c, k) => chars[i + k] === c),
      );
      if (lig) {
        glyphs.push({ text: lig[1], code: lig[0] });
        i += [...lig[1]].length;
        continue;
      }
      const ch = chars[i]!;
      const code = codeFor(ch);
      glyphs.push({ text: ch, code: code ?? null });
      i++;
    }
    return glyphs;
  };

  const serif =
    (flags & 2) !== 0 || /times|serif|georgia|garamond|roman/i.test(baseFont);
  const mono = (flags & 1) !== 0 || /courier|mono/i.test(baseFont);
  const weight = num(get(doc, desc, "FontWeight"));
  const italicAngle = num(get(doc, desc, "ItalicAngle"));
  const named = {
    bold:
      /bold|black|heavy|semibold|demi/i.test(baseFont) ||
      (flags & 0x40000) !== 0 ||
      weight >= 600 ||
      // Stems as thick as those of bold faces (Helvetica-Bold: 140).
      num(get(doc, desc, "StemV")) >= 120,
    italic:
      /italic|oblique|kursiv/i.test(baseFont) ||
      (flags & 64) !== 0 ||
      italicAngle !== 0,
  };
  const program = named.bold && named.italic ? named : programStyle(doc, desc);
  return {
    resourceName,
    ref,
    encode,
    substitute: substituteFor(baseFont, flags),
    subtype,
    baseFont,
    bytesPerCode: type0 ? 2 : 1,
    widthOf,
    unicodeOf,
    codeFor,
    standard,
    embedded,
    family: mono
      ? "Courier"
      : serif && !/sans/i.test(baseFont)
        ? "Times"
        : "Helvetica",
    bold: named.bold || program.bold,
    italic: named.italic || program.italic,
  };
}

/** Splits string bytes into character codes. */
export function codesOf(font: FontInfo | null, bytes: Uint8Array): number[] {
  if (font?.bytesPerCode === 2) {
    const codes: number[] = [];
    for (let i = 0; i + 1 < bytes.length; i += 2)
      codes.push((bytes[i]! << 8) | bytes[i + 1]!);
    return codes;
  }
  return [...bytes];
}
