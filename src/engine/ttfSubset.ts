/**
 * Minimal TrueType subsetter (spec 001, CA3b). Keeps the glyph numbering: the
 * outlines of unused glyphs are emptied, so the glyph ids written in content
 * streams (Identity-H, CIDToGIDMap Identity) stay valid. Layout and hinting
 * tables that a PDF renderer does not need are dropped.
 *
 * Written because the subsets made by @pdf-lib/fontkit draw no glyphs with
 * some fonts (e.g. Arimo): the text extracts but is invisible.
 */

const KEEP = new Set([
  "head",
  "hhea",
  "maxp",
  "OS/2",
  "hmtx",
  "cmap",
  "loca",
  "glyf",
  "post",
  "name",
  "cvt ",
  "fpgm",
  "prep",
]);

interface Table {
  tag: string;
  data: Uint8Array;
}

export function readTables(font: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = view.getUint16(4);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    const tag = String.fromCharCode(...font.subarray(rec, rec + 4));
    const offset = view.getUint32(rec + 8);
    const length = view.getUint32(rec + 12);
    tables.set(tag, font.subarray(offset, offset + length));
  }
  return tables;
}

const dv = (b: Uint8Array) =>
  new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Glyph ids a composite glyph refers to. */
function components(glyph: Uint8Array): number[] {
  if (glyph.length < 10) return [];
  const view = dv(glyph);
  if (view.getInt16(0) >= 0) return [];
  const out: number[] = [];
  let pos = 10;
  for (;;) {
    const flags = view.getUint16(pos);
    out.push(view.getUint16(pos + 2));
    pos += 4 + (flags & 0x0001 ? 4 : 2); // ARG_1_AND_2_ARE_WORDS
    if (flags & 0x0008)
      pos += 2; // WE_HAVE_A_SCALE
    else if (flags & 0x0040)
      pos += 4; // X_AND_Y_SCALE
    else if (flags & 0x0080) pos += 8; // TWO_BY_TWO
    if (!(flags & 0x0020)) break; // MORE_COMPONENTS
  }
  return out;
}

function checksum(data: Uint8Array): number {
  let sum = 0;
  const padded = new Uint8Array((data.length + 3) & ~3);
  padded.set(data);
  const view = dv(padded);
  for (let i = 0; i < padded.length; i += 4)
    sum = (sum + view.getUint32(i)) >>> 0;
  return sum;
}

function writeFont(tables: Table[]): Uint8Array {
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const count = tables.length;
  let size = 12 + count * 16;
  const offsets: number[] = [];
  for (const t of tables) {
    offsets.push(size);
    size += (t.data.length + 3) & ~3;
  }
  const out = new Uint8Array(size);
  const view = dv(out);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, count);
  let pow = 1;
  let log = 0;
  while (pow * 2 <= count) {
    pow *= 2;
    log++;
  }
  view.setUint16(6, pow * 16);
  view.setUint16(8, log);
  view.setUint16(10, count * 16 - pow * 16);
  let headOffset = -1;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[rec + k] = t.tag.charCodeAt(k);
    view.setUint32(rec + 4, checksum(t.data));
    view.setUint32(rec + 8, offsets[i]!);
    view.setUint32(rec + 12, t.data.length);
    out.set(t.data, offsets[i]!);
    if (t.tag === "head") headOffset = offsets[i]!;
  });
  if (headOffset >= 0)
    view.setUint32(headOffset + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

/** A copy of `font` with only the outlines of `glyphs` (and glyph 0). */
export function subsetTrueType(
  font: Uint8Array,
  glyphs: Iterable<number>,
): Uint8Array {
  const tables = readTables(font);
  const head = tables.get("head");
  const loca = tables.get("loca");
  const glyf = tables.get("glyf");
  const maxp = tables.get("maxp");
  if (!head || !loca || !glyf || !maxp)
    throw new Error(t("engine.notTrueType"));
  const numGlyphs = dv(maxp).getUint16(4);
  const longLoca = dv(head).getInt16(50) === 1;
  const locaView = dv(loca);
  const offset = (gid: number) =>
    longLoca ? locaView.getUint32(gid * 4) : locaView.getUint16(gid * 2) * 2;
  const glyphData = (gid: number) =>
    gid < numGlyphs
      ? glyf.subarray(offset(gid), offset(gid + 1))
      : new Uint8Array();

  const keep = new Set<number>([0]);
  const queue = [...glyphs].filter((g) => g >= 0 && g < numGlyphs);
  while (queue.length > 0) {
    const gid = queue.pop()!;
    if (keep.has(gid) && gid !== 0) continue;
    keep.add(gid);
    for (const c of components(glyphData(gid))) if (!keep.has(c)) queue.push(c);
  }

  const parts: Uint8Array[] = [];
  const newLoca = new Uint8Array((numGlyphs + 1) * 4);
  const newLocaView = dv(newLoca);
  let pos = 0;
  for (let gid = 0; gid < numGlyphs; gid++) {
    newLocaView.setUint32(gid * 4, pos);
    if (!keep.has(gid)) continue;
    const data = glyphData(gid);
    const padded = new Uint8Array((data.length + 3) & ~3);
    padded.set(data);
    parts.push(padded);
    pos += padded.length;
  }
  newLocaView.setUint32(numGlyphs * 4, pos);
  const newGlyf = new Uint8Array(pos);
  let at = 0;
  for (const p of parts) {
    newGlyf.set(p, at);
    at += p.length;
  }

  const newHead = head.slice();
  dv(newHead).setInt16(50, 1); // long loca offsets
  dv(newHead).setUint32(8, 0); // checkSumAdjustment, set by writeFont
  const out: Table[] = [];
  for (const [tag, data] of tables) {
    if (!KEEP.has(tag)) continue;
    if (tag === "head") out.push({ tag, data: newHead });
    else if (tag === "loca") out.push({ tag, data: newLoca });
    else if (tag === "glyf") out.push({ tag, data: newGlyf });
    else if (tag === "post") {
      // Version 3: no glyph names.
      const post = data.slice(0, 32);
      dv(post).setUint32(0, 0x00030000);
      out.push({ tag, data: post });
    } else out.push({ tag, data });
  }
  return writeFont(out);
}
import { t } from "../i18n";
