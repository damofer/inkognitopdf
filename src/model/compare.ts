// Spec 018: comparing two versions of a PDF. The words of each version, the
// changes between them (Myers' diff) and the pixels that differ on a page.
// Everything runs on the device.

/** A word of a page, with its box in page units (top-left origin, scale 1). */
export interface Word {
  text: string;
  /** Page index, from 0. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of a pdf.js text item that is needed. */
export interface TextRun {
  str: string;
  /** [a, b, c, d, e, f] of the text, in PDF units. */
  transform: number[];
  /** Advance of the whole run, in PDF units. */
  width: number;
  fontName?: string;
}

/** Width of `text` in some font of the run, to share the run among words. */
export type Measure = (text: string, run: TextRun) => number;

/** Without a font to measure with, every character is as wide. */
const byCharacters: Measure = (text) => text.length;

type Matrix = readonly number[];

const multiply = (m: Matrix, n: Matrix): number[] => [
  m[0]! * n[0]! + m[2]! * n[1]!,
  m[1]! * n[0]! + m[3]! * n[1]!,
  m[0]! * n[2]! + m[2]! * n[3]!,
  m[1]! * n[2]! + m[3]! * n[3]!,
  m[0]! * n[4]! + m[2]! * n[5]! + m[4]!,
  m[1]! * n[4]! + m[3]! * n[5]! + m[5]!,
];

/** Same text for the same word: Unicode forms and ligatures folded. */
export const normalizeWord = (text: string) => text.normalize("NFKC");

/**
 * The words of a page. `viewport` is the pdf.js viewport transform at scale 1,
 * so boxes come out in page units with the origin at the top left. Each word
 * gets its share of the run's advance by its measured width.
 */
export function wordsOf(
  runs: readonly TextRun[],
  viewport: Matrix,
  page: number,
  measure: Measure = byCharacters,
): Word[] {
  const words: Word[] = [];
  for (const run of runs) {
    if (!run.str.trim()) continue;
    const [a, b, c, d, e, f] = multiply(viewport, run.transform);
    const size = Math.hypot(c!, d!);
    const scale =
      Math.hypot(a!, b!) / (Math.hypot(...run.transform.slice(0, 2)) || 1);
    const total = measure(run.str, run) || 1;
    const advance = (text: string) =>
      (measure(text, run) / total) * run.width * scale;
    // Horizontal text only: rotated text keeps its start and size.
    const dx = Math.hypot(a!, b!) ? a! / Math.hypot(a!, b!) : 1;
    const dy = Math.hypot(a!, b!) ? b! / Math.hypot(a!, b!) : 0;
    for (const m of run.str.matchAll(/\S+/gu)) {
      const offset = advance(run.str.slice(0, m.index));
      const length = advance(m[0]);
      const x0 = e! + offset * dx;
      const y0 = f! + offset * dy;
      words.push({
        text: normalizeWord(m[0]),
        page,
        x: Math.min(x0, x0 + length * dx),
        y: y0 - size * 0.85,
        width: Math.max(Math.abs(length * dx), 1),
        height: size * 1.1,
      });
    }
  }
  return words;
}

export type DiffOp =
  | { kind: "equal"; a: number; b: number; length: number }
  | { kind: "change"; a: number; aLength: number; b: number; bLength: number };

/**
 * Myers' diff of two sequences: equal runs and changes (removed from `a`,
 * added to `b`, or both). Null when there are more than `maxEdits` edits.
 */
export function diffSequences(
  a: readonly string[],
  b: readonly string[],
  maxEdits = 4000,
): DiffOp[] | null {
  // The common start and end are cheap and usually most of a document.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = n === 0 && m === 0 ? -1 : null;
  for (let d = 0; found === null && d <= max; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    v = next;
  }
  if (found === null) return null;

  // Back through the trace: one edit (removal or addition) per step.
  const edits: ("del" | "ins" | "eq")[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d]!;
    const k = x - y;
    const down =
      k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = prev[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      edits.push("eq");
      x--;
      y--;
    }
    edits.push(down ? "ins" : "del");
    if (down) y--;
    else x--;
  }
  while (x > 0 && y > 0) {
    edits.push("eq");
    x--;
    y--;
  }
  edits.reverse();

  const ops: DiffOp[] = [];
  const equal = (ai: number, bi: number, length: number) => {
    if (length === 0) return;
    const last = ops[ops.length - 1];
    if (last?.kind === "equal") last.length += length;
    else ops.push({ kind: "equal", a: ai, b: bi, length });
  };
  equal(0, 0, start);
  let ai = start;
  let bi = start;
  for (let i = 0; i < edits.length;) {
    if (edits[i] === "eq") {
      let length = 0;
      while (edits[i] === "eq") {
        length++;
        i++;
      }
      equal(ai, bi, length);
      ai += length;
      bi += length;
      continue;
    }
    const op = {
      kind: "change" as const,
      a: ai,
      aLength: 0,
      b: bi,
      bLength: 0,
    };
    while (i < edits.length && edits[i] !== "eq") {
      if (edits[i] === "del") op.aLength++;
      else op.bLength++;
      i++;
    }
    ops.push(op);
    ai += op.aLength;
    bi += op.bLength;
  }
  equal(ai, bi, a.length - ai);
  return ops;
}

/** One change: words removed from the earlier version, words added. */
export interface Change {
  removed: Word[];
  added: Word[];
}

export interface Comparison {
  changes: Change[];
  /** For each page of the later version, the matching earlier page or -1. */
  pairs: number[];
  /** Too many differences to list (the documents are not two versions). */
  tooMany: boolean;
}

/** The text changes from `before` to `after`, and which pages go together. */
export function compareWords(
  before: readonly Word[],
  after: readonly Word[],
  afterPages: number,
  maxEdits?: number,
): Comparison {
  const ops = diffSequences(
    before.map((w) => w.text),
    after.map((w) => w.text),
    maxEdits,
  );
  // Pages go together by the words they share; without words, by position.
  const shared = new Map<string, number>();
  for (const op of ops ?? [])
    if (op.kind === "equal")
      for (let i = 0; i < op.length; i++) {
        const key = `${after[op.b + i]!.page}:${before[op.a + i]!.page}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
  const pairs = Array.from({ length: afterPages }, (_, page) => {
    let best = -1;
    let most = 0;
    for (const [key, count] of shared) {
      const [p, q] = key.split(":").map(Number);
      if (p === page && count > most) {
        best = q!;
        most = count;
      }
    }
    return best;
  });
  // Pages without shared words take the position after the last paired one.
  for (let page = 0; page < pairs.length; page++)
    if (pairs[page] === -1 && !after.some((w) => w.page === page)) {
      const prev = page > 0 ? pairs[page - 1]! : -1;
      pairs[page] = prev >= 0 ? prev + 1 : page;
    }

  if (!ops) return { changes: [], pairs, tooMany: true };
  const changes = ops.flatMap((op) =>
    op.kind === "change"
      ? [
          {
            removed: before.slice(op.a, op.a + op.aLength),
            added: after.slice(op.b, op.b + op.bLength),
          },
        ]
      : [],
  );
  return { changes, pairs, tooMany: false };
}

/**
 * The pixels that differ between two renders of the same size (RGBA). A
 * pixel counts when its colors differ by more than `threshold` in total.
 */
export function diffPixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  threshold = 60,
): { mask: Uint8Array; changed: number } {
  const pixels = Math.min(a.length, b.length) / 4;
  const mask = new Uint8Array(pixels);
  let changed = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    const delta =
      Math.abs(a[i]! - b[i]!) +
      Math.abs(a[i + 1]! - b[i + 1]!) +
      Math.abs(a[i + 2]! - b[i + 2]!);
    if (delta > threshold) {
      mask[p] = 1;
      changed++;
    }
  }
  return { mask, changed };
}
