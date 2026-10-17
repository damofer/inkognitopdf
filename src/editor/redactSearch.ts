import type {
  EditorState,
  Needles,
  OcrItem,
  OcrWord,
  RedactionItem,
} from "../model/document";
import { boundingRect, type Point, type Rect } from "../model/geometry";
import { apply, type ShowPart, type TextShow } from "../engine/textShows";
import type { PdfFile } from "../storage/pdfFile";
import { BadPatternError, findRanges } from "../engine/textMatch";
import { mergeLineRects } from "./itemOps";
import { showsOf } from "./textStyleProbe";
import { findPersonalData, type PiiKind } from "../model/pii";

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

export { BadPatternError, findRanges };

/** Glyph box used for marks: a little inside the box the engine removes. */
const MARK_DESCENT = 0.18;
const MARK_ASCENT = 0.78;

type Glyph = { show: TextShow; part: Extract<ShowPart, { kind: "glyph" }> };

/** Text in reading order and, for each character, the unit it came from. */
interface Indexed<T> {
  text: string;
  /** Unit of each UTF-16 code unit of `text`; null for added separators. */
  units: (T | null)[];
}

function glyphText(
  shows: TextShow[],
  keep: (glyph: Glyph) => boolean = () => true,
): Indexed<Glyph> {
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
      const glyph = { show, part };
      if (!keep(glyph)) continue;
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
        if (Math.abs(across) > 0.5 * size || along < -0.5 * size)
          add("\n", null);
        else if (along > 0.2 * size) add(" ", null);
      }
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

/** Share of `box` inside `area`. */
function inside(box: Rect, area: Rect): number {
  const w =
    Math.min(box.x + box.width, area.x + area.width) - Math.max(box.x, area.x);
  const h =
    Math.min(box.y + box.height, area.y + area.height) -
    Math.max(box.y, area.y);
  const size = box.width * box.height;
  return w > 0 && h > 0 && size > 0 ? (w * h) / size : 0;
}

/** Shorter texts are not looked for elsewhere: they would match anything. */
const MIN_NEEDLE = 3;

/**
 * What to look for elsewhere in the file when the areas are applied (spec 012,
 * CA13): the text under each area, line by line, and the searches that
 * marked them.
 */
export async function needlesOf(
  file: PdfFile | null,
  state: EditorState,
  areas: RedactionItem[],
): Promise<Needles> {
  const texts = new Set<string>();
  const patterns = new Set<string>();
  const addText = (text: string) => {
    for (const line of text.split("\n")) {
      const t = line.trim().replace(/\s+/g, " ");
      if (t.length >= MIN_NEEDLE) texts.add(t);
    }
  };
  for (const entry of state.pages) {
    const rects = areas.filter((a) => a.pageId === entry.id).map((a) => a.rect);
    if (rects.length === 0) continue;
    if (file && entry.source.kind === "original") {
      const shows = await showsOf(file, entry.source.index);
      for (const rect of rects)
        addText(glyphText(shows, (g) => inside(markBox(g), rect) > 0.3).text);
    }
    const ocr = state.items.filter(
      (i): i is OcrItem => i.kind === "ocr" && i.pageId === entry.id,
    );
    for (const rect of rects)
      for (const item of ocr)
        for (const line of item.lines)
          addText(
            line.words
              .filter((w) => inside(wordBox(item, w), rect) > 0.3)
              .map((w) => w.text.trim())
              .join(" "),
          );
  }
  for (const { query } of areas)
    if (query?.regex) patterns.add(query.text);
    else if (query) addText(query.text);
  return { texts: [...texts], patterns: [...patterns] };
}

export interface PersonalHit {
  kind: PiiKind;
  value: string;
  pageId: string;
  /** 1-based, in the current order. */
  page: number;
  rects: Rect[];
}

/**
 * Personal data in the text of every page, the file's and the recognized
 * text of scanned pages (spec 016), with the areas that cover each one.
 */
export async function searchPersonalData(
  file: PdfFile | null,
  state: EditorState,
): Promise<PersonalHit[]> {
  const hits: PersonalHit[] = [];
  const collect = <T>(
    indexed: Indexed<T>,
    box: (unit: T) => Rect,
    pageId: string,
    page: number,
  ) => {
    for (const m of findPersonalData(indexed.text))
      hits.push({
        kind: m.kind,
        value: m.value,
        pageId,
        page,
        rects: rectsOf(indexed, [[m.start, m.end]], box),
      });
  };
  for (const [index, entry] of state.pages.entries()) {
    if (file && entry.source.kind === "original")
      collect(
        glyphText(await showsOf(file, entry.source.index)),
        markBox,
        entry.id,
        index + 1,
      );
    const ocr = state.items.filter(
      (i): i is OcrItem => i.kind === "ocr" && i.pageId === entry.id,
    );
    if (ocr.length > 0) collect(ocrText(ocr), (r) => r, entry.id, index + 1);
  }
  return hits;
}
