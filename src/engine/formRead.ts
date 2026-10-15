import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFDocument,
} from "pdf-lib";
import type { FontFamily, FormFieldType } from "../model/document";
import type { Rect } from "../model/geometry";
import { rgbToHex } from "./color";

/**
 * Form fields of a PDF, read from its AcroForm (spec 005, plan: formRead).
 * Fields are found by walking /Fields and /Kids; a kid without /T is a widget.
 */

/** Field flags (ISO 32000-1, tables 221, 226, 228 and 230). */
export const FF = {
  readOnly: 1 << 0,
  required: 1 << 1,
  multiline: 1 << 12,
  password: 1 << 13,
  noToggleToOff: 1 << 14,
  radio: 1 << 15,
  pushButton: 1 << 16,
  combo: 1 << 17,
  edit: 1 << 18,
  fileSelect: 1 << 20,
  multiSelect: 1 << 21,
  doNotScroll: 1 << 23,
  comb: 1 << 24,
} as const;

export type FieldKind = FormFieldType | "signature" | "button" | "password";

/** Font, size and color of a field's default appearance (/DA). */
export interface DaStyle {
  font: FontFamily;
  bold: boolean;
  italic: boolean;
  /** 0 is automatic. */
  size: number;
  color: string;
}

export interface WidgetInfo {
  /** Object reference, as "12 0 R". */
  ref: string;
  /** Index of its page in the document, or -1. */
  pageIndex: number;
  rect: Rect;
  /** "On" state of a check box or radio button widget. */
  onState?: string;
  /** Rotation of the widget content (/MK /R), degrees counter-clockwise. */
  rotate: number;
  hidden: boolean;
}

export interface FieldOption {
  /** Export value, stored in /V. */
  value: string;
  /** Text shown. */
  label: string;
}

export interface FieldInfo {
  /** Fully qualified name. */
  name: string;
  kind: FieldKind;
  /** Text, choice (or choices) or state name ("Off" for none). */
  value: string | string[];
  options: FieldOption[];
  readOnly: boolean;
  required: boolean;
  maxLength?: number;
  comb: boolean;
  multiSelect: boolean;
  /** /Q: 0 left, 1 center, 2 right. */
  align: 0 | 1 | 2;
  style: DaStyle;
  widgets: WidgetInfo[];
}

export interface RawField {
  ref: PDFRef | undefined;
  dict: PDFDict;
  name: string;
  /** The field and its ancestors, nearest first (for inherited entries). */
  chain: PDFDict[];
  widgets: { ref: PDFRef | undefined; dict: PDFDict }[];
}

export const refKey = (ref: PDFRef) =>
  `${ref.objectNumber} ${ref.generationNumber} R`;

export function parseRef(key: string): PDFRef | null {
  const m = /^(\d+) (\d+) R$/.exec(key);
  return m ? PDFRef.of(Number(m[1]), Number(m[2])) : null;
}

export function textOf(value: unknown): string | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString)
    return value.decodeText();
  if (value instanceof PDFName) return value.decodeText();
  return undefined;
}

export function numberOf(value: unknown): number | undefined {
  return value instanceof PDFNumber ? value.asNumber() : undefined;
}

/** Entry of the nearest dict of `chain` that has it. */
export function inherited(chain: PDFDict[], key: string): unknown {
  for (const dict of chain) {
    const value = dict.lookup(PDFName.of(key));
    if (value !== undefined) return value;
  }
  return undefined;
}

export function acroFormOf(doc: PDFDocument): PDFDict | undefined {
  const form = doc.catalog.lookup(PDFName.of("AcroForm"));
  return form instanceof PDFDict ? form : undefined;
}

/** Terminal fields of the document, with their widgets. */
export function rawFields(doc: PDFDocument): RawField[] {
  const form = acroFormOf(doc);
  const fields = form?.lookup(PDFName.of("Fields"));
  if (!(fields instanceof PDFArray)) return [];
  const out: RawField[] = [];
  const seen = new Set<PDFDict>();
  const walk = (entry: unknown, parents: PDFDict[], prefix: string) => {
    const ref = entry instanceof PDFRef ? entry : undefined;
    const dict = ref ? doc.context.lookup(ref) : entry;
    if (!(dict instanceof PDFDict) || seen.has(dict)) return;
    seen.add(dict);
    const partial = textOf(dict.lookup(PDFName.of("T")));
    const name =
      partial === undefined
        ? prefix
        : prefix
          ? `${prefix}.${partial}`
          : partial;
    const chain = [dict, ...parents];
    const kids = dict.lookup(PDFName.of("Kids"));
    const kidEntries = kids instanceof PDFArray ? kids.asArray() : [];
    const kidDict = (k: unknown) => {
      const d = k instanceof PDFRef ? doc.context.lookup(k) : k;
      return d instanceof PDFDict ? d : undefined;
    };
    const fieldKids = kidEntries.filter((k) =>
      kidDict(k)?.has(PDFName.of("T")),
    );
    if (fieldKids.length > 0) {
      for (const k of fieldKids) walk(k, chain, name);
      return;
    }
    const widgets =
      kidEntries.length > 0
        ? kidEntries.flatMap((k) => {
            const d = kidDict(k);
            return d
              ? [{ ref: k instanceof PDFRef ? k : undefined, dict: d }]
              : [];
          })
        : [{ ref, dict }];
    out.push({ ref, dict, name, chain, widgets });
  };
  for (const entry of fields.asArray()) walk(entry, [], "");
  return out;
}

const SHORT_NAMES: Record<string, string> = {
  Helv: "Helvetica",
  HeBo: "Helvetica-Bold",
  HeOb: "Helvetica-Oblique",
  HeBO: "Helvetica-BoldOblique",
  TiRo: "Times-Roman",
  TiBo: "Times-Bold",
  TiIt: "Times-Italic",
  TiBI: "Times-BoldItalic",
  Cour: "Courier",
  CoBo: "Courier-Bold",
  CoOb: "Courier-Oblique",
  CoBO: "Courier-BoldOblique",
};

/** Standard family, weight and slant of a font name (base font or resource). */
export function familyOf(fontName: string): {
  font: FontFamily;
  bold: boolean;
  italic: boolean;
} {
  const name = (SHORT_NAMES[fontName] ?? fontName).replace(/^[A-Z]{6}\+/, "");
  const font: FontFamily = /courier|cousine|mono|consol/i.test(name)
    ? "Courier"
    : /times|tinos|georgia|garamond|cambria|caladea|palatino/i.test(name) ||
        (/roman|serif/i.test(name) && !/sans/i.test(name))
      ? "Times"
      : "Helvetica";
  return {
    font,
    bold: /bold|black|heavy|semibold|demi|,bd/i.test(name),
    italic: /italic|oblique/i.test(name),
  };
}

/** Parses a /DA string; the font name is resolved through /DR when it can be. */
export function parseDa(da: string, dr?: PDFDict): DaStyle {
  const tokens = da.match(/\/[^\s/[\]()<>]+|[-+]?\d*\.?\d+|[A-Za-z*']+/g) ?? [];
  let fontName = "Helv";
  let size = 0;
  let color = "#000000";
  for (let i = 0; i < tokens.length; i++) {
    const op = tokens[i]!;
    const num = (back: number) => Number(tokens[i - back]);
    if (op === "Tf" && i >= 2) {
      fontName = tokens[i - 2]!.slice(1);
      size = num(1);
    } else if (op === "g" && i >= 1) color = rgbToHex(num(1), num(1), num(1));
    else if (op === "rg" && i >= 3) color = rgbToHex(num(3), num(2), num(1));
    else if (op === "k" && i >= 4) {
      const [c, m, y, k] = [num(4), num(3), num(2), num(1)];
      color = rgbToHex((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
    }
  }
  let baseName = fontName;
  const fonts = dr?.lookup(PDFName.of("Font"));
  if (fonts instanceof PDFDict) {
    const font = fonts.lookup(PDFName.of(fontName));
    const base =
      font instanceof PDFDict
        ? textOf(font.lookup(PDFName.of("BaseFont")))
        : undefined;
    if (base) baseName = base;
  }
  return {
    ...familyOf(baseName),
    size: Number.isFinite(size) ? size : 0,
    color,
  };
}

/** Color of an /MK or /C entry, or null when absent or empty. */
export function colorOf(value: unknown): [number, number, number] | null {
  if (!(value instanceof PDFArray)) return null;
  const n = value.asArray().map((v) => numberOf(v) ?? 0);
  if (n.length === 1) return [n[0]!, n[0]!, n[0]!];
  if (n.length === 3) return [n[0]!, n[1]!, n[2]!];
  if (n.length === 4) {
    const [c, m, y, k] = n as [number, number, number, number];
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  return null;
}

export function rectOf(value: unknown): Rect | null {
  if (!(value instanceof PDFArray) || value.size() < 4) return null;
  const [a, b, c, d] = value.asArray().map((v) => numberOf(v) ?? 0) as [
    number,
    number,
    number,
    number,
  ];
  return {
    x: Math.min(a, c),
    y: Math.min(b, d),
    width: Math.abs(c - a),
    height: Math.abs(d - b),
  };
}

/** "On" state of a button widget: its normal appearance key other than Off. */
export function onStateOf(widget: PDFDict): string | undefined {
  const ap = widget.lookup(PDFName.of("AP"));
  const normal = ap instanceof PDFDict ? ap.lookup(PDFName.of("N")) : undefined;
  if (normal instanceof PDFDict && !(normal instanceof PDFStream))
    for (const key of normal.keys())
      if (key.decodeText() !== "Off") return key.decodeText();
  return undefined;
}

/** Page index of each annotation object, from the pages' /Annots. */
export function annotPages(doc: PDFDocument): Map<string, number> {
  const map = new Map<string, number>();
  doc.getPages().forEach((page, index) => {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (annots instanceof PDFArray)
      for (const a of annots.asArray())
        if (a instanceof PDFRef) map.set(refKey(a), index);
  });
  return map;
}

export function fieldKind(chain: PDFDict[]): FieldKind | null {
  const ft = textOf(inherited(chain, "FT"));
  const ff = numberOf(inherited(chain, "Ff")) ?? 0;
  switch (ft) {
    case "Tx":
      if (ff & FF.password) return "password";
      if (ff & FF.fileSelect) return null;
      return ff & FF.multiline ? "multiline" : "text";
    case "Btn":
      if (ff & FF.pushButton) return "button";
      return ff & FF.radio ? "radio" : "checkbox";
    case "Ch":
      return ff & FF.combo ? "dropdown" : "list";
    case "Sig":
      return "signature";
    default:
      return null;
  }
}

export function optionsOf(chain: PDFDict[]): FieldOption[] {
  const opt = inherited(chain, "Opt");
  if (!(opt instanceof PDFArray)) return [];
  return opt.asArray().map((entry) => {
    const resolved = entry instanceof PDFRef ? undefined : entry;
    if (resolved instanceof PDFArray) {
      const value = textOf(resolved.lookup(0)) ?? "";
      return { value, label: textOf(resolved.lookup(1)) ?? value };
    }
    const value = textOf(resolved) ?? "";
    return { value, label: value };
  });
}

/** Current value of a field, as the UI and the engine use it. */
export function valueOf(chain: PDFDict[], kind: FieldKind): string | string[] {
  const v = inherited(chain, "V");
  if (kind === "checkbox" || kind === "radio")
    return v instanceof PDFName ? v.decodeText() : (textOf(v) ?? "Off");
  if (kind === "list" && v instanceof PDFArray)
    return v.asArray().map((x) => textOf(x) ?? "");
  return textOf(v) ?? "";
}

export function readFields(doc: PDFDocument): FieldInfo[] {
  const form = acroFormOf(doc);
  const dr = form?.lookup(PDFName.of("DR"));
  const formDa = textOf(form?.lookup(PDFName.of("DA"))) ?? "/Helv 0 Tf 0 g";
  const pages = annotPages(doc);
  const pageRefs = doc.getPages().map((p) => p.ref);
  const out: FieldInfo[] = [];
  for (const raw of rawFields(doc)) {
    const kind = fieldKind(raw.chain);
    if (!kind) continue;
    const ff = numberOf(inherited(raw.chain, "Ff")) ?? 0;
    const widgets = raw.widgets.flatMap(({ ref, dict }): WidgetInfo[] => {
      const rect = rectOf(dict.lookup(PDFName.of("Rect")));
      if (!rect) return [];
      const p = dict.get(PDFName.of("P"));
      let pageIndex = ref ? (pages.get(refKey(ref)) ?? -1) : -1;
      if (pageIndex < 0 && p instanceof PDFRef)
        pageIndex = pageRefs.findIndex(
          (r) => r === p || refKey(r) === refKey(p),
        );
      const mk = dict.lookup(PDFName.of("MK"));
      const flags = numberOf(dict.lookup(PDFName.of("F"))) ?? 0;
      return [
        {
          ref: ref ? refKey(ref) : "",
          pageIndex,
          rect,
          onState: onStateOf(dict),
          rotate:
            mk instanceof PDFDict
              ? (numberOf(mk.lookup(PDFName.of("R"))) ?? 0)
              : 0,
          hidden: (flags & 2) !== 0 || (flags & 32) !== 0,
        },
      ];
    });
    const da =
      textOf(raw.widgets[0]?.dict.lookup(PDFName.of("DA"))) ??
      textOf(inherited(raw.chain, "DA")) ??
      formDa;
    const maxLength = numberOf(inherited(raw.chain, "MaxLen"));
    const q =
      numberOf(inherited(raw.chain, "Q")) ??
      numberOf(form?.lookup(PDFName.of("Q"))) ??
      0;
    out.push({
      name: raw.name,
      kind,
      value: valueOf(raw.chain, kind),
      options: optionsOf(raw.chain),
      readOnly: (ff & FF.readOnly) !== 0,
      required: (ff & FF.required) !== 0,
      maxLength,
      comb: (ff & FF.comb) !== 0 && maxLength !== undefined,
      multiSelect: (ff & FF.multiSelect) !== 0,
      align: (q === 1 || q === 2 ? q : 0) as 0 | 1 | 2,
      style: parseDa(da, dr instanceof PDFDict ? dr : undefined),
      widgets,
    });
  }
  return out;
}
