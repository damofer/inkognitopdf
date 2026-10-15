/**
 * Tokenizer and parser for PDF content streams (spec 001, T019). Written from
 * the PDF syntax rules (ISO 32000-1 §7.2, §7.3, §8.9.7); it keeps the byte
 * range of every operation so the stream can be edited without re-serializing
 * the parts that do not change.
 */

export type Operand =
  | number
  | boolean
  | null
  | { type: "name"; name: string }
  | { type: "string"; bytes: Uint8Array; hex: boolean }
  | { type: "dict"; entries: Record<string, Operand> }
  | Operand[];

export interface ContentOp {
  operator: string;
  operands: Operand[];
  /** Byte offset of the first operand (or of the operator if it has none). */
  start: number;
  /** Byte offset just after the operator. */
  end: number;
}

const isWhite = (c: number) =>
  c === 0 || c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const DELIMITERS = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]); // ()<>[]{}/%
const isRegular = (c: number) => !isWhite(c) && !DELIMITERS.has(c);
const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);

interface Keyword {
  keyword: string;
}
type Token = Operand | Keyword | { close: "]" | ">>" } | undefined;

const isKeyword = (t: Token): t is Keyword =>
  typeof t === "object" && t !== null && "keyword" in t;
const isClose = (t: Token): t is { close: "]" | ">>" } =>
  typeof t === "object" && t !== null && "close" in t;

export function parseContentStream(bytes: Uint8Array): ContentOp[] {
  const len = bytes.length;
  let pos = 0;

  const skipWhite = () => {
    while (pos < len) {
      const c = bytes[pos]!;
      if (isWhite(c)) pos++;
      else if (c === 37) {
        while (pos < len && bytes[pos] !== 10 && bytes[pos] !== 13) pos++;
      } else break;
    }
  };

  const readLiteralString = (): Operand => {
    pos++; // (
    const out: number[] = [];
    let depth = 1;
    while (pos < len) {
      const c = bytes[pos++]!;
      if (c === 92) {
        const n = bytes[pos++];
        if (n === undefined) break;
        const simple: Record<number, number> = {
          110: 10, // n
          114: 13, // r
          116: 9, // t
          98: 8, // b
          102: 12, // f
          40: 40,
          41: 41,
          92: 92,
        };
        if (n in simple) out.push(simple[n]!);
        else if (n === 13) {
          if (bytes[pos] === 10) pos++; // line continuation
        } else if (n === 10) {
          // line continuation
        } else if (n >= 48 && n <= 55) {
          let value = n - 48;
          for (let k = 0; k < 2 && bytes[pos]! >= 48 && bytes[pos]! <= 55; k++)
            value = value * 8 + (bytes[pos++]! - 48);
          out.push(value & 0xff);
        } else out.push(n);
      } else if (c === 40) {
        depth++;
        out.push(c);
      } else if (c === 41) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return { type: "string", bytes: Uint8Array.from(out), hex: false };
  };

  const readHexString = (): Operand => {
    pos++; // <
    let digits = "";
    while (pos < len && bytes[pos] !== 62) {
      const c = bytes[pos++]!;
      if (!isWhite(c)) digits += String.fromCharCode(c);
    }
    pos++; // >
    if (digits.length % 2) digits += "0";
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++)
      out[i] = parseInt(digits.slice(2 * i, 2 * i + 2), 16) || 0;
    return { type: "string", bytes: out, hex: true };
  };

  const readName = (): Operand => {
    pos++; // /
    const start = pos;
    while (pos < len && isRegular(bytes[pos]!)) pos++;
    const raw = latin1(bytes.subarray(start, pos));
    return {
      type: "name",
      name: raw.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) =>
        String.fromCharCode(parseInt(h, 16)),
      ),
    };
  };

  const readToken = (): Token => {
    skipWhite();
    if (pos >= len) return undefined;
    const c = bytes[pos]!;
    if (c === 40) return readLiteralString();
    if (c === 60) {
      if (bytes[pos + 1] === 60) {
        pos += 2;
        const entries: Record<string, Operand> = {};
        for (;;) {
          const key = readToken();
          if (key === undefined || isClose(key)) break;
          if (typeof key !== "object" || key === null || !("type" in key))
            continue;
          if (key.type !== "name") continue;
          const value = readToken();
          if (value === undefined || isClose(value)) break;
          if (!isKeyword(value)) entries[key.name] = value;
        }
        return { type: "dict", entries };
      }
      return readHexString();
    }
    if (c === 62) {
      pos += bytes[pos + 1] === 62 ? 2 : 1;
      return { close: ">>" };
    }
    if (c === 91) {
      pos++;
      const items: Operand[] = [];
      for (;;) {
        const t = readToken();
        if (t === undefined || isClose(t)) break;
        if (!isKeyword(t)) items.push(t);
      }
      return items;
    }
    if (c === 93) {
      pos++;
      return { close: "]" };
    }
    if (c === 47) return readName();
    if (c === 41 || c === 123 || c === 125) {
      pos++; // stray delimiter: ignore
      return readToken();
    }
    const start = pos;
    while (pos < len && isRegular(bytes[pos]!)) pos++;
    const word = latin1(bytes.subarray(start, pos));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return Number(word);
    if (/^[+-]{2,}\d/.test(word)) return Number(word.replace(/^[+-]+/, "-"));
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "null") return null;
    return { keyword: word };
  };

  /** Skips inline image data after `ID`, up to and including `EI`. */
  const skipInlineImage = () => {
    pos++; // single white-space byte after ID
    while (pos < len) {
      if (
        bytes[pos] === 69 &&
        bytes[pos + 1] === 73 &&
        isWhite(bytes[pos - 1]!) &&
        (pos + 2 >= len ||
          isWhite(bytes[pos + 2]!) ||
          DELIMITERS.has(bytes[pos + 2]!))
      ) {
        pos += 2;
        return;
      }
      pos++;
    }
  };

  const ops: ContentOp[] = [];
  let operands: Operand[] = [];
  let start = -1;
  for (;;) {
    skipWhite();
    if (pos >= len) break;
    const tokenStart = pos;
    const token = readToken();
    if (token === undefined) break;
    if (isClose(token)) continue;
    if (start < 0) start = tokenStart;
    if (!isKeyword(token)) {
      operands.push(token);
      continue;
    }
    if (token.keyword === "BI") {
      // Inline image: BI <key value…> ID <binary> EI, kept as one operation.
      for (;;) {
        const t = readToken();
        if (t === undefined) break;
        if (isKeyword(t) && t.keyword === "ID") {
          skipInlineImage();
          break;
        }
      }
    }
    ops.push({ operator: token.keyword, operands, start, end: pos });
    operands = [];
    start = -1;
  }
  return ops;
}

/** Formats a number for a content stream (no exponents, at most 4 decimals). */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 1e-5) return "0";
  return String(Number(n.toFixed(4)));
}
