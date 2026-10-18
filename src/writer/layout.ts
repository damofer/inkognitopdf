// Spec 032: lays the writer's blocks out on pages. Pure: font metrics come
// from outside, and the result is drawing operations per page with the origin
// at the top-left corner of the page and y growing downwards.
//
// Lines are built the way the editor's browser builds them (CSS white-space:
// pre-wrap, unitless line-height, collapsing vertical margins), so the PDF
// breaks lines where the editor does in the page view.
import type { FlowBlock, Run, RunStyle, TextFlow } from "./flow";
import type { WriterFamily } from "./schema";

/** Metrics of one font, per unit of font size. */
export interface Face {
  /** Width of `text` at size 1. */
  width(text: string): number;
  ascent: number;
  /** Below the baseline, positive. */
  descent: number;
}

export type FaceOf = (
  family: WriterFamily,
  bold: boolean,
  italic: boolean,
) => Face;

export interface PageSetup {
  width: number;
  height: number;
  margin: number;
}

export type WriterOp =
  | {
      kind: "text";
      x: number;
      /** Baseline. */
      y: number;
      text: string;
      style: RunStyle;
    }
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: string }
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      width: number;
    }
  | { kind: "image"; src: string; x: number; y: number; w: number; h: number };

export interface WriterLayout {
  pages: WriterOp[][];
  /** Document position where each page after the first starts. */
  starts: number[];
}

/** Line height of spacing 1, as a multiple of the font size. */
export const LINE_FACTOR = 1.15;
const RULE_COLOR = "#9aa0a6";
const RULE_WIDTH = 0.75;

/** A piece of a run on one line: a word, part of a word or spaces. */
interface Piece {
  text: string;
  style: RunStyle;
  pos: number;
  space: boolean;
  /** A line may break after it (spaces, hyphens). */
  breakAfter: boolean;
}

interface Line {
  pieces: Piece[];
  /** Width without the spaces at its end. */
  width: number;
  /** Ends a paragraph or a line break: never justified. */
  last: boolean;
}

/** Splits runs into words and spaces; "\n" ends a line. */
function piecesOf(runs: Run[]): (Piece | "newline")[] {
  const out: (Piece | "newline")[] = [];
  for (const run of runs) {
    if (run.text === "\n") {
      out.push("newline");
      continue;
    }
    // Words, with a break allowed after a hyphen inside them ("auto-
    // escuela"), and runs of spaces.
    const re = / +|[^ -]+-+(?=[^ -])|[^ ]+/g;
    for (let m = re.exec(run.text); m; m = re.exec(run.text)) {
      const text = m[0];
      const space = text.startsWith(" ");
      out.push({
        text,
        style: run.style,
        pos: run.pos + m.index,
        space,
        breakAfter: space || text.endsWith("-"),
      });
    }
  }
  return out;
}

const faceFor = (faceOf: FaceOf, s: RunStyle) =>
  faceOf(s.family, s.bold, s.italic);

function widthOf(faceOf: FaceOf, p: { text: string; style: RunStyle }) {
  return faceFor(faceOf, p.style).width(p.text) * p.style.size;
}

/** Cuts a word wider than the line into pieces that fit, letter by letter. */
function cutWord(word: Piece[], width: number, faceOf: FaceOf): Piece[][] {
  const chunks: Piece[][] = [];
  let chunk: Piece[] = [];
  let used = 0;
  for (const piece of word) {
    const chars = [...piece.text];
    let start = 0;
    let offset = 0;
    for (let i = 0; i < chars.length; i++) {
      const w = widthOf(faceOf, { text: chars[i]!, style: piece.style });
      if (used + w > width && (used > 0 || i > start)) {
        if (i > start)
          chunk.push({
            ...piece,
            text: chars.slice(start, i).join(""),
            pos: piece.pos + offset,
            breakAfter: false,
          });
        chunks.push(chunk);
        chunk = [];
        used = 0;
        offset += chars.slice(start, i).join("").length;
        start = i;
      }
      used += w;
    }
    chunk.push({
      ...piece,
      text: chars.slice(start).join(""),
      pos: piece.pos + offset,
    });
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

/** Breaks a paragraph into lines `width` points wide. */
export function breakLines(runs: Run[], width: number, faceOf: FaceOf): Line[] {
  const lines: Line[] = [];
  let pieces: Piece[] = [];
  let lineWidth = 0;
  /** Width of the spaces after the last word, counted once a word follows. */
  let spaces = 0;
  let hasWord = false;

  const finish = (last: boolean) => {
    lines.push({ pieces, width: lineWidth, last });
    pieces = [];
    lineWidth = 0;
    spaces = 0;
    hasWord = false;
  };

  // Words between break opportunities, kept together.
  const stream = piecesOf(runs);
  let i = 0;
  while (i < stream.length) {
    const item = stream[i]!;
    if (item === "newline") {
      finish(true);
      i++;
      continue;
    }
    if (item.space) {
      pieces.push(item);
      spaces += widthOf(faceOf, item);
      i++;
      continue;
    }
    const word: Piece[] = [];
    while (i < stream.length) {
      const next = stream[i]!;
      if (next === "newline" || next.space) break;
      word.push(next);
      i++;
      if (next.breakAfter) break;
    }
    const w = word.reduce((sum, p) => sum + widthOf(faceOf, p), 0);
    if (hasWord && lineWidth + spaces + w > width) finish(false);
    if (lineWidth + spaces + w > width) {
      // Longer than a whole line: cut where it stops fitting.
      const chunks = cutWord(
        word,
        Math.max(1, width - lineWidth - spaces),
        faceOf,
      );
      chunks.forEach((chunk, k) => {
        if (k > 0) finish(false);
        pieces.push(...chunk);
        lineWidth +=
          spaces + chunk.reduce((sum, p) => sum + widthOf(faceOf, p), 0);
        spaces = 0;
        hasWord = true;
      });
      continue;
    }
    pieces.push(...word);
    lineWidth += spaces + w;
    spaces = 0;
    hasWord = true;
  }
  finish(true);
  return lines;
}

/** Height and baseline of a line, as the browser's inline layout makes them. */
function lineBox(
  pieces: { style: RunStyle }[],
  base: RunStyle,
  spacing: number,
  faceOf: FaceOf,
) {
  let above = 0;
  let below = 0;
  const factor = spacing * LINE_FACTOR;
  // The paragraph's own font counts too (the "strut").
  for (const { style } of [{ style: base }, ...pieces]) {
    const face = faceFor(faceOf, style);
    const a = face.ascent * style.size;
    const d = face.descent * style.size;
    const half = (style.size * factor - (a + d)) / 2;
    above = Math.max(above, a + half);
    below = Math.max(below, d + half);
  }
  return { height: above + below, baseline: above };
}

/** Drawing of one line at (x, top); `width` is the space for text. */
function drawLine(
  line: Line,
  block: TextFlow,
  x: number,
  top: number,
  width: number,
  baseline: number,
  faceOf: FaceOf,
  first: boolean,
): WriterOp[] {
  const ops: WriterOp[] = [];
  const y = top + baseline;
  // Spaces at the end of the line are not drawn and do not count.
  let end = line.pieces.length;
  while (end > 0 && line.pieces[end - 1]!.space) end--;
  const pieces = line.pieces.slice(0, end);
  const free = Math.max(0, width - line.width);
  const gaps =
    block.align === "justify" && !line.last
      ? pieces.filter((p) => p.space).length
      : 0;
  const extra = gaps ? free / gaps : 0;
  let cx =
    x +
    (block.align === "center" ? free / 2 : block.align === "right" ? free : 0);

  if (first && block.marker) {
    const { text, style } = block.marker;
    const w = widthOf(faceOf, { text: `${text} `, style });
    ops.push({ kind: "text", x: x - w, y, text, style });
  }

  // Pieces of the same style are drawn together, unless spaces stretch.
  type Group = { text: string; style: RunStyle; x: number; w: number };
  const groups: Group[] = [];
  for (const piece of pieces) {
    const w = widthOf(faceOf, piece) + (piece.space ? extra : 0);
    const prev = groups[groups.length - 1];
    if (prev && prev.style === piece.style && !extra) {
      prev.text += piece.text;
      prev.w += w;
    } else groups.push({ text: piece.text, style: piece.style, x: cx, w });
    cx += w;
  }
  for (const g of groups) {
    const face = faceFor(faceOf, g.style);
    if (g.style.highlight)
      ops.push({
        kind: "rect",
        x: g.x,
        y: y - face.ascent * g.style.size,
        w: g.w,
        h: (face.ascent + face.descent) * g.style.size,
        fill: g.style.highlight,
      });
  }
  for (const g of groups) {
    if (!g.text.trim() && !g.style.underline && !g.style.strike) continue;
    if (g.text.trim())
      ops.push({ kind: "text", x: g.x, y, text: g.text, style: g.style });
    const thickness = Math.max(0.5, g.style.size * 0.06);
    if (g.style.underline)
      ops.push({
        kind: "line",
        x1: g.x,
        y1: y + g.style.size * 0.12,
        x2: g.x + g.w,
        y2: y + g.style.size * 0.12,
        color: g.style.color,
        width: thickness,
      });
    if (g.style.strike)
      ops.push({
        kind: "line",
        x1: g.x,
        y1: y - g.style.size * 0.3,
        x2: g.x + g.w,
        y2: y - g.style.size * 0.3,
        color: g.style.color,
        width: thickness,
      });
  }
  return ops;
}

/** Lays the blocks out on pages of `setup`. */
export function layoutWriter(
  blocks: FlowBlock[],
  setup: PageSetup,
  faceOf: FaceOf,
): WriterLayout {
  const contentWidth = setup.width - 2 * setup.margin;
  const contentHeight = setup.height - 2 * setup.margin;
  const pages: WriterOp[][] = [[]];
  const starts: number[] = [];
  let y = 0;
  let used = false;
  /** Space after the previous block (vertical margins collapse). */
  let after = 0;

  const newPage = (pos: number) => {
    pages.push([]);
    starts.push(pos);
    y = 0;
    used = false;
  };
  const page = () => pages[pages.length - 1]!;
  /** Space above something `before` wants, or none at the top of a page. */
  const gap = (before: number) => (used ? Math.max(after, before) : 0);

  // Lines of every text block, computed once.
  const laid = blocks.map((block) => {
    if (block.kind !== "text") return null;
    const width = contentWidth - block.indent;
    return breakLines(block.runs, width, faceOf).map((line) => ({
      line,
      ...lineBox(line.pieces, block.base, block.spacing, faceOf),
    }));
  });

  blocks.forEach((block, index) => {
    if (block.kind === "pageBreak") {
      newPage(nextPos(blocks, index));
      after = 0;
      return;
    }
    if (block.kind === "rule") {
      if (used && y + gap(block.before) + RULE_WIDTH > contentHeight)
        newPage(block.pos);
      y += gap(block.before);
      const ry = setup.margin + y + RULE_WIDTH / 2;
      page().push({
        kind: "line",
        x1: setup.margin,
        y1: ry,
        x2: setup.margin + contentWidth,
        y2: ry,
        color: RULE_COLOR,
        width: RULE_WIDTH,
      });
      y += RULE_WIDTH;
      used = true;
      after = block.after;
      return;
    }
    if (block.kind === "image") {
      let w = contentWidth * block.width;
      let h = w * block.ratio;
      // Taller than a page: made smaller to fit one.
      if (h > contentHeight) {
        h = contentHeight;
        w = h / block.ratio;
      }
      if (used && y + gap(block.before) + h > contentHeight) newPage(block.pos);
      y += gap(block.before);
      page().push({
        kind: "image",
        src: block.src,
        x: setup.margin + (contentWidth - w) / 2,
        y: setup.margin + y,
        w,
        h,
      });
      y += h;
      used = true;
      after = block.after;
      return;
    }

    const lines = laid[index]!;
    // A heading moves to the next page with the line that follows it.
    if (block.keepWithNext && used) {
      const own = lines.reduce((sum, l) => sum + l.height, 0);
      const next = blocks[index + 1];
      const nextLines = laid[index + 1];
      const follow =
        next?.kind === "text" && nextLines
          ? Math.max(block.after, next.before) + nextLines[0]!.height
          : 0;
      if (y + gap(block.before) + own + follow > contentHeight)
        newPage(lineStart(lines[0]!.line, block));
    }
    lines.forEach(({ line, height, baseline }, k) => {
      const space = k === 0 ? gap(block.before) : 0;
      if (used && y + space + height > contentHeight)
        newPage(lineStart(line, block));
      else y += space;
      page().push(
        ...drawLine(
          line,
          block,
          setup.margin + block.indent,
          setup.margin + y,
          contentWidth - block.indent,
          baseline,
          faceOf,
          k === 0,
        ),
      );
      y += height;
      used = true;
    });
    after = block.after;
  });
  return { pages, starts };
}

/** Where a line starts in the document. */
const lineStart = (line: Line, block: TextFlow) =>
  line.pieces[0]?.pos ?? block.pos;

/** Position of what follows a page break, for the page it starts. */
function nextPos(blocks: FlowBlock[], index: number): number {
  const next = blocks[index + 1];
  if (!next) return blocks[index]!.pos;
  if (next.kind === "text") return next.runs[0]?.pos ?? next.pos;
  return next.pos;
}
