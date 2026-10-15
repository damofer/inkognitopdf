import type { EditorState, OcrItem, OcrWord } from "../model/document";
import { boundingRect, type Point, type Rect } from "../model/geometry";
import { apply, type ShowPart, type TextShow } from "../engine/textShows";
import type { PdfFile } from "../storage/pdfFile";
import { mergeLineRects } from "./itemOps";
import { showsOf } from "./textStyleProbe";

/**
 * Search and redact (spec 012, CA2): finds a word or a regular expression in
 * the text of every page (the content of the file, glyph by glyph, and the
 * recognized text of scanned pages) and returns the areas that cover each
 * match, one per line.
 */

export interface Match {
  pageId: string;
  rect: Rect;
}

export class BadPatternError extends Error {}

/** Glyph box used for marks: a little inside the box the engine removes. */
const MARK_DESCENT = 0.18;
const MARK_ASCENT = 0.78;
const MAX_MATCHES = 2000;

type Glyph = { show: TextShow; part: Extract<ShowPart, { kind: "glyph" }> };

/** Text in reading order and, for each character, the unit it came from. */
interface Indexed<T> {
  text: string;
  /** Unit of each UTF-16 code unit of `text`; null for added separators. */
  units: (T | null)[];
}

function glyphText(shows: TextShow[]): Indexed<Glyph> {
  let text = "";
  const units: (Glyph | null)[] = [];
  let last: Glyph | null = null;
  const add = (s: string, unit: Glyph | null) => {
    text += s;
    for (let i = 0; i < s.length; i++) units.push(unit);
  };
  for (const show of shows)
    for (const part of show.parts) {
      if (part.kind !== "glyph" || part.unicode === "") continue;
      if (last) {
        // A gap or a new line between glyphs reads as a space.
        const m = last.show.userMatrix;
        const end = apply(m, last.part.x + last.part.advance, 0);
        const len = Math.hypot(m[0], m[1]) || 1;
        const u = { x: m[0] / len, y: m[1] / len };
        const dx = part.origin.x - end.x;
        const dy = part.origin.y - end.y;
        const along = dx * u.x + dy * u.y;
        const across = -dx * u.y + dy * u.x;
        const size = Math.max(last.show.size, 1);
        if (
          Math.abs(across) > 0.5 * size ||
          along < -0.5 * size ||
          along > 0.2 * size
        )
          add(" ", null);
      }
      const glyph = { show, part };
      add(part.unicode, glyph);
      last = glyph;
    }
  return { text, units };
}

function markBox({ show, part }: Glyph): Rect {
  const fs = show.fontSize;
  const rise = show.state.rise;
  const y0 = rise - MARK_DESCENT * fs;
  const y1 = rise + MARK_ASCENT * fs;
  const x1 = part.x + part.advance;
  return boundingRect([
    apply(show.userMatrix, part.x, y0),
    apply(show.userMatrix, x1, y0),
    apply(show.userMatrix, x1, y1),
    apply(show.userMatrix, part.x, y1),
  ]);
}

function wordBox(item: OcrItem, word: OcrWord): Rect {
  const a = (item.rotate * Math.PI) / 180;
  const u: Point = { x: Math.cos(a), y: Math.sin(a) };
  const v: Point = { x: -u.y, y: u.x };
  const { at, width: w, height: h } = word;
  return boundingRect([
    at,
    { x: at.x + u.x * w, y: at.y + u.y * w },
    { x: at.x + u.x * w + v.x * h, y: at.y + u.y * w + v.y * h },
    { x: at.x + v.x * h, y: at.y + v.y * h },
  ]);
}

function ocrText(items: OcrItem[]): Indexed<Rect> {
  let text = "";
  const units: (Rect | null)[] = [];
  for (const item of items)
    for (const line of item.lines)
      for (const word of line.words) {
        const w = word.text.trim();
        if (!w) continue;
        if (text) {
          text += " ";
          units.push(null);
        }
        const box = wordBox(item, word);
        text += w;
        for (let i = 0; i < w.length; i++) units.push(box);
      }
  return { text, units };
}

/** Lower case without accents, keeping one character per character. */
const fold = (s: string) =>
  [...s]
    .map((c) => {
      const f = c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      if (f.length === c.length) return f;
      const lower = c.toLowerCase();
      return lower.length === c.length ? lower : c;
    })
    .join("");

/** [start, end) ranges of every match of the query in `text`. */
export function findRanges(
  text: string,
  query: string,
  regex: boolean,
): [number, number][] {
  const ranges: [number, number][] = [];
  if (regex) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(query, "giu");
    } catch {
      throw new BadPatternError(query);
    }
    for (const m of text.matchAll(pattern)) {
      if (m[0].length === 0) continue;
      ranges.push([m.index, m.index + m[0].length]);
      if (ranges.length >= MAX_MATCHES) break;
    }
    return ranges;
  }
  const needle = fold(query.trim().replace(/\s+/g, " "));
  if (!needle) return ranges;
  const hay = fold(text.replace(/\s/g, " "));
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    ranges.push([i, i + needle.length]);
    if (ranges.length >= MAX_MATCHES) break;
  }
  return ranges;
}

function rectsOf<T>(
  indexed: Indexed<T>,
  ranges: [number, number][],
  box: (unit: T) => Rect,
): Rect[] {
  const rects: Rect[] = [];
  for (const [start, end] of ranges) {
    const units = new Set<T>();
    for (let i = start; i < end; i++) {
      const unit = indexed.units[i];
      if (unit) units.add(unit);
    }
    rects.push(...mergeLineRects([...units].map(box)));
  }
  return rects;
}

/** Areas that cover every match of `query` in the document. */
export async function searchDocument(
  file: PdfFile | null,
  state: EditorState,
  query: string,
  regex: boolean,
): Promise<Match[]> {
  const matches: Match[] = [];
  for (const entry of state.pages) {
    if (file && entry.source.kind === "original") {
      const indexed = glyphText(await showsOf(file, entry.source.index));
      for (const rect of rectsOf(
        indexed,
        findRanges(indexed.text, query, regex),
        markBox,
      ))
        matches.push({ pageId: entry.id, rect });
    }
    const ocr = state.items.filter(
      (i): i is OcrItem => i.kind === "ocr" && i.pageId === entry.id,
    );
    if (ocr.length > 0) {
      const indexed = ocrText(ocr);
      for (const rect of rectsOf(
        indexed,
        findRanges(indexed.text, query, regex),
        (r) => r,
      ))
        matches.push({ pageId: entry.id, rect });
    }
  }
  return matches;
}
