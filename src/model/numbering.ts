// Page numbers, headers and footers (spec 022). Pure functions shared by the
// preview and the engine; no PDF library here.
import type { FontFamily } from "./document";
import type { Point } from "./geometry";

/** Top or bottom, left, center or right of the page as shown. */
export type NumberingSlot = "tl" | "tc" | "tr" | "bl" | "bc" | "br";
export const NUMBERING_SLOTS: readonly NumberingSlot[] = [
  "tl",
  "tc",
  "tr",
  "bl",
  "bc",
  "br",
];

export interface Numbering {
  /** Text of each slot, with {n}, {total}, {date}, {file} and {bates}. */
  texts: Partial<Record<NumberingSlot, string>>;
  /** First page numbered, 1-based. */
  from: number;
  /** Last page numbered, 1-based; null is the last page. */
  to: number | null;
  /** Number of the first page numbered. */
  startAt: number;
  bates: { prefix: string; digits: number };
  font: FontFamily;
  /** Points. */
  size: number;
  /** Hex color. */
  color: string;
  /** Distance from the edge of the page as shown, in points. */
  margin: number;
  /** Name of the file for {file}, without ".pdf". */
  fileName: string;
}

export const MM = 72 / 25.4;

export function defaultNumbering(fileName: string): Numbering {
  return {
    texts: { bc: "{n}" },
    from: 1,
    to: null,
    startAt: 1,
    bates: { prefix: "", digits: 6 },
    font: "Helvetica",
    size: 10,
    color: "#000000",
    margin: Math.round(12 * MM * 100) / 100,
    fileName,
  };
}

/** Slots with some text. */
export function usedSlots(numbering: Numbering): NumberingSlot[] {
  return NUMBERING_SLOTS.filter((s) => numbering.texts[s]?.trim());
}

/**
 * The number of each numbered page by its index, and the last number (CA5).
 * Only numbered pages count.
 */
export function numberedPages(
  numbering: Numbering,
  count: number,
): { numbers: Map<number, number>; total: number } {
  const from = Math.max(1, Math.floor(numbering.from));
  const to = Math.min(count, numbering.to ?? count);
  const numbers = new Map<number, number>();
  for (let page = from; page <= to; page++)
    numbers.set(page - 1, numbering.startAt + page - from);
  const total = numbers.size > 0 ? numbering.startAt + numbers.size - 1 : 0;
  return { numbers, total };
}

export function batesNumber(bates: Numbering["bates"], n: number): string {
  return bates.prefix + String(n).padStart(Math.max(1, bates.digits), "0");
}

export interface NumberingContext {
  n: number;
  total: number;
  /** Already formatted. */
  date: string;
}

/** Replaces the fields of `text` (CA3). Unknown fields stay as written. */
export function resolveText(
  text: string,
  numbering: Numbering,
  ctx: NumberingContext,
): string {
  return text.replace(
    /\{(n|total|date|fecha|file|archivo|bates)\}/g,
    (_, f) => {
      switch (f) {
        case "n":
          return String(ctx.n);
        case "total":
          return String(ctx.total);
        case "date":
        case "fecha": // i18n-ignore: field name
          return ctx.date;
        case "file":
        case "archivo":
          return numbering.fileName;
        default:
          return batesNumber(numbering.bates, ctx.n);
      }
    },
  );
}

/** Today's date as the interface language writes it. */
export function numberingDate(now: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(now);
}

/**
 * Baseline origin of a slot's text in the frame of the page as shown (origin
 * top-left, y down, points). `width` is the text width; `ascent` and
 * `descent` (positive) are per unit of font size.
 */
export function slotOrigin(
  slot: NumberingSlot,
  page: { width: number; height: number },
  numbering: Pick<Numbering, "size" | "margin">,
  width: number,
  ascent = 0.75,
  descent = 0.22,
): Point {
  const { size, margin } = numbering;
  const y =
    slot[0] === "t"
      ? margin + ascent * size
      : page.height - margin - descent * size;
  const x =
    slot[1] === "l"
      ? margin
      : slot[1] === "c"
        ? (page.width - width) / 2
        : page.width - margin - width;
  return { x, y };
}

/** Which quick format was used, for usage counts (spec 011); never the text. */
export function numberingFormat(
  numbering: Numbering,
): "number" | "pageOf" | "slash" | "dashes" | "bates" | "custom" {
  const texts = usedSlots(numbering).map((s) => numbering.texts[s]!.trim());
  if (texts.length !== 1) return "custom";
  const [text] = texts;
  if (text === "{n}") return "number";
  if (text === "{n} / {total}") return "slash";
  if (text === "- {n} -") return "dashes";
  if (text === "{bates}") return "bates";
  if (/^\p{L}+ \{n\} \p{L}+ \{total\}$/u.test(text!)) return "pageOf";
  return "custom";
}
