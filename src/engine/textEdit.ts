import { t } from "../i18n";
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
import type { TextEditItem } from "../model/document";
import type { Rect } from "../model/geometry";
import { hexToRgb } from "./color";
import {
  formatNumber,
  parseContentStream,
  type ContentOp,
} from "./contentStream";
import { drawTextWith, variantOf, type FontCache } from "./fonts";
import type { SubstituteFont } from "./substituteFont";
import { fontsOf, type FontInfo } from "./pdfFonts";
import {
  IDENTITY,
  findTextShows,
  multiply,
  type Matrix,
  type ShowPart,
  type TextShow,
} from "./textShows";

/**
 * Editing of existing text (spec 001, HU3, T020–T021, T027).
 *
 * The page content and every Form XObject it draws (recursively) form a tree
 * of streams. For each edit:
 *  1. every glyph whose box is centred inside the edited area is removed from
 *     the stream that shows it; the operator is rewritten as `TJ` with
 *     adjustments of the same width, so the remaining text does not move;
 *  2. the new text is written at the end of that same stream, wrapped so it
 *     starts from the stream's initial state, with the exact text matrix of
 *     the first removed glyph and the original font size, color, spacing,
 *     scaling and rendering mode. Characters the original font has use it;
 *     the rest use a bundled open font of the same family, weight and style.
 * A changed Form XObject is copied (copy-on-write), so other pages and other
 * uses of the same form keep the original.
 */

const LINE_HEIGHT = 1.2;
const NEWLINE = 10;
const MAX_DEPTH = 12;

interface FormChild {
  opIndex: number;
  stream: PDFStream;
  node: StreamNode;
}

interface StreamNode {
  bytes: Uint8Array;
  ops: ContentOp[];
  shows: TextShow[];
  resources: PDFDict | undefined;
  children: FormChild[];
}

interface Anchor {
  edit: TextEditItem;
  /** Operation of the removed glyph nearest to the edit origin. */
  show: TextShow;
  /**
   * Removed glyphs on the same baseline, by position: their text and their
   * offset in the text space of `show`. New text keeps their spacing.
   */
  glyphs: { text: string; x: number }[];
}

/** Longest common subsequence of two glyph sequences: new index → old index. */
function align(next: string[], old: string[]): Map<number, number> {
  const n = next.length;
  const m = old.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      table[i]![j] =
        next[i] === old[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const matches = new Map<number, number>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (next[i] === old[j]) matches.set(i++, j++);
    else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }
  return matches;
}

/** Position of a user-space point in the text space of `m`. */
function toTextSpace(m: Matrix, p: { x: number; y: number }) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0) return { x: 0, y: 0 };
  const dx = p.x - m[4];
  const dy = p.y - m[5];
  return { x: (dx * m[3] - dy * m[2]) / det, y: (dy * m[0] - dx * m[1]) / det };
}

export interface TextEditResult {
  warnings: string[];
  /** Edits whose text was not found in the content. */
  notFound: TextEditItem[];
}

/** Decoded bytes of a content or form stream. */
export function streamBytes(stream: PDFObject | undefined): Uint8Array | null {
  if (stream instanceof PDFRawStream)
    return decodePDFRawStream(stream).decode();
  if (stream && "getUnencodedContents" in stream)
    return (
      stream as { getUnencodedContents(): Uint8Array }
    ).getUnencodedContents();
  return null;
}

/** Decoded bytes of all the page content streams, joined by newlines. */
export function pageContentBytes(doc: PDFDocument, page: PDFPage): Uint8Array {
  const contents = page.node.Contents();
  const items: (PDFObject | undefined)[] =
    contents instanceof PDFArray ? contents.asArray() : [contents];
  const parts: Uint8Array[] = [];
  for (const item of items) {
    const bytes = streamBytes(
      item === undefined ? undefined : doc.context.lookup(item),
    );
    if (bytes) parts.push(bytes);
  }
  return concat(parts, NEWLINE);
}

export function concat(parts: Uint8Array[], separator?: number): Uint8Array {
  const extra = separator === undefined ? 0 : 1;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length + extra, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
    if (separator !== undefined) out[pos++] = separator;
  }
  return out;
}

export const ascii = (s: string) =>
  Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

export function matrixOf(doc: PDFDocument, dict: PDFDict): Matrix {
  const m = doc.context.lookup(dict.get(PDFName.of("Matrix")));
  if (!(m instanceof PDFArray) || m.size() !== 6) return IDENTITY;
  const values = m
    .asArray()
    .map((v) => doc.context.lookup(v))
    .map((v) => (v instanceof PDFNumber ? v.asNumber() : NaN));
  return values.every(Number.isFinite) ? (values as Matrix) : IDENTITY;
}

/** Parses a stream and, recursively, the Form XObjects it draws. */
function buildNode(
  doc: PDFDocument,
  bytes: Uint8Array,
  resources: PDFDict | undefined,
  base: Matrix,
  path: PDFObject[],
): StreamNode {
  const ops = parseContentStream(bytes);
  const children: FormChild[] = [];
  const xobjects = resources?.lookup(PDFName.of("XObject"));
  const shows = findTextShows(ops, fontsOf(doc, resources), {
    base,
    source: bytes,
    onDo: (name, ctm, opIndex) => {
      if (!(xobjects instanceof PDFDict) || path.length >= MAX_DEPTH) return;
      const stream = xobjects.lookup(PDFName.of(name));
      if (!(stream instanceof PDFStream) || path.includes(stream)) return;
      if (stream.dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Form"))
        return;
      const formBytes = streamBytes(stream);
      if (!formBytes) return;
      const own = stream.dict.lookup(PDFName.of("Resources"));
      const node = buildNode(
        doc,
        formBytes,
        own instanceof PDFDict ? own : resources,
        multiply(multiply(matrixOf(doc, stream.dict), ctm), base),
        [...path, stream],
      );
      children.push({ opIndex, stream, node });
    },
  });
  return { bytes, ops, shows, resources, children };
}

function* allShows(node: StreamNode): Generator<[StreamNode, TextShow]> {
  for (const show of node.shows) yield [node, show];
  for (const child of node.children) yield* allShows(child.node);
}

const expand = (r: Rect, d: number): Rect => ({
  x: r.x - d,
  y: r.y - d,
  width: r.width + 2 * d,
  height: r.height + 2 * d,
});

const inside = (p: { x: number; y: number }, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

interface Glyph {
  node: StreamNode;
  show: TextShow;
  part: Extract<ShowPart, { kind: "glyph" }>;
}

/** Share of the edited text that must be found to keep only those glyphs. */
const OWN_SHARE = 0.8;

/**
 * The glyphs of the edited text among those found in its area. Other text can
 * share the area: a dot leader drawn under a label and its value (hidden by
 * their white background), or text drawn over it. When the found glyphs spell
 * more than the edited text, only the ones that spell it are kept, matched in
 * reading order. Without usable Unicode (no ToUnicode map), all are kept.
 */
function ownGlyphs(found: Glyph[], edit: TextEditItem): Glyph[] {
  const wanted = [...edit.originalText.replace(/\s+/g, "")];
  const solid = found.filter((g) => g.part.unicode.trim() !== "");
  if (wanted.length === 0 || solid.length <= wanted.length) return found;
  const a = (edit.rotate * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const lineHeight = Math.max(edit.size, 1) * LINE_HEIGHT;
  const key = (g: Glyph) => {
    const dx = g.part.origin.x - edit.at.x;
    const dy = g.part.origin.y - edit.at.y;
    return {
      line: Math.round(-(dy * u.x - dx * u.y) / lineHeight),
      along: dx * u.x + dy * u.y,
    };
  };
  // One entry per character: a ligature glyph ("fi") spells two.
  const chars = solid
    .map((g) => ({ g, k: key(g) }))
    .sort((p, q) => p.k.line - q.k.line || p.k.along - q.k.along)
    .flatMap(({ g }) =>
      [...g.part.unicode.replace(/\s+/g, "")].map((c) => ({ c, g })),
    );
  const matches = align(
    wanted,
    chars.map((x) => x.c),
  );
  if (matches.size < wanted.length * OWN_SHARE) return found;
  const own = new Set([...matches.values()].map((j) => chars[j]!.g));
  // Spaces go with the operators of the edited text.
  const shows = new Set([...own].map((g) => g.show));
  return found.filter(
    (g) => own.has(g) || (g.part.unicode.trim() === "" && shows.has(g.show)),
  );
}

const hexOf = (bytes: Iterable<number>) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Rewrites a text operator without the glyphs in `drop`. Removed glyphs become
 * TJ adjustments of the same width, so every remaining glyph, and everything
 * shown after the operator, keeps its position.
 */
export function rewriteShow(
  show: TextShow,
  op: ContentOp,
  drop: Set<ShowPart>,
): string {
  const scale = show.fontSize * show.horizontalScale;
  const items: (number | number[])[] = [];
  const pushNumber = (n: number) => {
    const last = items[items.length - 1];
    if (typeof last === "number") items[items.length - 1] = last + n;
    else items.push(n);
  };
  for (const part of show.parts) {
    if (part.kind === "adjust") pushNumber(part.value);
    else if (drop.has(part)) {
      if (scale !== 0) pushNumber((-part.advance * 1000) / scale);
    } else {
      const last = items[items.length - 1];
      if (Array.isArray(last)) last.push(...part.bytes);
      else items.push([...part.bytes]);
    }
  }
  const array = items
    .filter((i) => typeof i !== "number" || Math.abs(i) >= 1e-4)
    .map((i) => (typeof i === "number" ? formatNumber(i) : `<${hexOf(i)}>`))
    .join(" ");
  const tj = array === "" ? "" : `[${array}] TJ`;
  switch (show.operator) {
    case "Tj":
    case "TJ":
      return tj;
    case "'":
      return `T* ${tj}`;
    case '"': {
      const [aw, ac] = op.operands;
      return `${formatNumber(Number(aw) || 0)} Tw ${formatNumber(Number(ac) || 0)} Tc T* ${tj}`;
    }
  }
}

/** Font name without the subset tag ("ABCDEF+Arial" → "Arial"). */
const baseName = (name: string) => name.replace(/^[A-Z]{6}\+/, "");

/** A short excerpt of `s` for messages. */
const clip = (s: string) => {
  const text = s.replace(/\s+/g, " ").trim();
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
};

/** Adds `ref` to a resource subdictionary under a new name and returns it. */
export function addResource(
  doc: PDFDocument,
  resources: PDFDict,
  kind: "Font" | "XObject",
  ref: PDFRef,
  prefix: string,
): string {
  let sub = resources.lookup(PDFName.of(kind));
  if (!(sub instanceof PDFDict)) {
    sub = doc.context.obj({});
    resources.set(PDFName.of(kind), sub as PDFDict);
  }
  const dict = sub as PDFDict;
  for (const [key, value] of dict.entries())
    if (value === ref && key.decodeText().startsWith(prefix))
      return key.decodeText();
  let n = 1;
  while (dict.has(PDFName.of(`${prefix}${n}`))) n++;
  dict.set(PDFName.of(`${prefix}${n}`), ref);
  return `${prefix}${n}`;
}

class Editor {
  private readonly drops = new Map<TextShow, Set<ShowPart>>();
  private readonly anchors = new Map<StreamNode, Anchor[]>();
  readonly warnings: string[] = [];

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: FontCache,
  ) {}

  /**
   * Marks the invisible glyphs (OCR layers, 3 or 7 Tr) in the area of an
   * edit of a scanned image for removal (spec 010). Visible content stays.
   */
  erase(root: StreamNode, edit: TextEditItem): void {
    const area = expand(edit.area, Math.min(1, edit.size * 0.05));
    for (const [, show] of allShows(root)) {
      if (show.state.renderMode !== 3 && show.state.renderMode !== 7) continue;
      for (const part of show.parts)
        if (part.kind === "glyph" && inside(part.center, area)) {
          let drop = this.drops.get(show);
          if (!drop) this.drops.set(show, (drop = new Set()));
          drop.add(part);
        }
    }
  }

  /** Marks the glyphs of `edit` for removal. False when none was found. */
  mark(root: StreamNode, edit: TextEditItem): boolean {
    // A small margin only: a larger one would catch neighbouring glyphs.
    const area = expand(edit.area, Math.min(1, edit.size * 0.05));
    const found: Glyph[] = [];
    for (const [node, show] of allShows(root))
      for (const part of show.parts)
        if (part.kind === "glyph" && inside(part.center, area))
          found.push({ node, show, part });
    let best: { node: StreamNode; show: TextShow; distance: number } | null =
      null;
    const removed: { text: string; origin: { x: number; y: number } }[] = [];
    for (const { node, show, part } of ownGlyphs(found, edit)) {
      let drop = this.drops.get(show);
      if (!drop) this.drops.set(show, (drop = new Set()));
      drop.add(part);
      removed.push({ text: part.unicode, origin: part.origin });
      const distance = Math.hypot(
        part.origin.x - edit.at.x,
        part.origin.y - edit.at.y,
      );
      if (!best || distance < best.distance - 1e-6)
        best = { node, show, distance };
    }
    if (!best) return false;
    const { show } = best;
    const placed = removed.map((g) => ({
      text: g.text,
      at: toTextSpace(show.userMatrix, g.origin),
    }));
    const baseline = toTextSpace(show.userMatrix, {
      x: edit.at.x,
      y: edit.at.y,
    }).y;
    const nearest = placed.reduce((a, b) =>
      Math.abs(b.at.y - baseline) < Math.abs(a.at.y - baseline) ? b : a,
    );
    const tolerance = 0.3 * Math.abs(show.fontSize || edit.size);
    const glyphs = placed
      .filter((g) => Math.abs(g.at.y - nearest.at.y) <= tolerance)
      .map((g) => ({ text: g.text, x: g.at.x }))
      .sort((a, b) => a.x - b.x);
    const list = this.anchors.get(best.node) ?? [];
    list.push({ edit, show, glyphs });
    this.anchors.set(best.node, list);
    return true;
  }

  /** New bytes for `node`, or null when nothing in it changed. */
  async rewrite(node: StreamNode): Promise<Uint8Array | null> {
    const cuts: { start: number; end: number; text: string }[] = [];
    for (const show of node.shows) {
      const drop = this.drops.get(show);
      if (drop)
        cuts.push({
          start: show.start,
          end: show.end,
          text: ` ${rewriteShow(show, node.ops[show.opIndex]!, drop)} `,
        });
    }
    for (const child of node.children) {
      const bytes = await this.rewrite(child.node);
      if (!bytes || !node.resources) continue;
      // Copy-on-write: the original form stays as it is for its other uses.
      const copy = this.doc.context.flateStream(bytes);
      for (const [key, value] of child.stream.dict.entries())
        if (!["Length", "Filter", "DecodeParms"].includes(key.decodeText()))
          copy.dict.set(key, value);
      const name = addResource(
        this.doc,
        node.resources,
        "XObject",
        this.doc.context.register(copy),
        "PcX",
      );
      const op = node.ops[child.opIndex]!;
      cuts.push({ start: op.start, end: op.end, text: ` /${name} Do ` });
    }
    const drawn: string[] = [];
    for (const anchor of this.anchors.get(node) ?? [])
      drawn.push(await this.replacement(node, anchor));
    if (cuts.length === 0 && drawn.length === 0) return null;

    cuts.sort((a, b) => a.start - b.start);
    const chunks: Uint8Array[] = [];
    let pos = 0;
    for (const cut of cuts) {
      chunks.push(node.bytes.subarray(pos, cut.start), ascii(cut.text));
      pos = cut.end;
    }
    chunks.push(node.bytes.subarray(pos));
    if (drawn.length === 0) return concat(chunks);
    // q … Q brings the state back to the stream start before the new text.
    return concat([
      ascii("q\n"),
      ...chunks,
      ascii(`\nQ\n${drawn.join("\n")}\n`),
    ]);
  }

  private fontIndex: Map<string, FontInfo[]> | null = null;

  /**
   * A glyph for `text` in another subset of the same font (same name without
   * the subset tag, same weight and style), with its resource name in the
   * stream of `node`. PDF producers often split one font into several subsets.
   */
  private siblingGlyph(node: StreamNode, font: FontInfo, text: string) {
    if (!this.fontIndex) {
      this.fontIndex = new Map();
      for (const page of this.doc.getPages())
        for (const info of fontsOf(
          this.doc,
          page.node.normalizedEntries().Resources,
        ).values()) {
          const list = this.fontIndex.get(baseName(info.baseFont)) ?? [];
          if (!list.some((f) => f.ref === info.ref)) list.push(info);
          this.fontIndex.set(baseName(info.baseFont), list);
        }
    }
    for (const other of this.fontIndex.get(baseName(font.baseFont)) ?? []) {
      if (
        other.ref === font.ref ||
        other.subtype !== font.subtype ||
        other.bold !== font.bold ||
        other.italic !== font.italic ||
        !(other.ref instanceof PDFRef) ||
        !node.resources
      )
        continue;
      const code = other.codeFor(text);
      if (code === undefined) continue;
      const name = addResource(
        this.doc,
        node.resources,
        "Font",
        other.ref,
        "PcS",
      );
      return { font: other, code, name };
    }
    return null;
  }

  /** Operators that draw the new text of an edit, in the stream of `node`. */
  private async replacement(node: StreamNode, anchor: Anchor): Promise<string> {
    const { edit, show } = anchor;
    const st = show.state;
    const text = edit.text.replace(/\r\n?/g, "\n");
    if (text.trim() === "") return "";
    const original: FontInfo | null =
      show.font && show.font.subtype !== "Type3" && st.fontName
        ? show.font
        : null;
    const size = st.fontSize || edit.size;
    let substitute: SubstituteFont | null = null;
    let substituteName = "";
    const substituteFont = async () => {
      if (!substitute) {
        const family = show.font?.substitute ?? "Arimo";
        // The weight and slant the text has on the page, as the editor saw
        // them (from the font, or from its strokes when the font says nothing).
        const variant = variantOf(
          edit.bold ?? show.font?.bold ?? false,
          edit.italic ?? show.font?.italic ?? false,
        );
        substitute = await this.fonts.substitute(family, variant);
        substituteName = node.resources
          ? addResource(this.doc, node.resources, "Font", substitute.ref, "PcF")
          : "";
        this.warnings.push(
          t(
            "engine.substituteFont",
            clip(edit.originalText),
            `${family} ${variant}`,
          ),
        );
      }
      return { font: substitute, name: substituteName };
    };

    const f = formatNumber;
    const out: string[] = ["q"];
    if (st.extGStateOps) out.push(st.extGStateOps);
    if (st.lineWidth !== 1) out.push(`${f(st.lineWidth)} w`);
    if (st.strokeOps) out.push(st.strokeOps);
    if (st.fillOps) out.push(st.fillOps);
    out.push("BT");
    if (st.charSpacing) out.push(`${f(st.charSpacing)} Tc`);
    if (st.wordSpacing) out.push(`${f(st.wordSpacing)} Tw`);
    if (st.horizontalScale !== 1) out.push(`${f(st.horizontalScale * 100)} Tz`);
    if (st.rise) out.push(`${f(st.rise)} Ts`);
    if (st.renderMode) out.push(`${st.renderMode} Tr`);
    const lineStart = anchor.glyphs[0]?.x ?? 0;
    const start = multiply([1, 0, 0, 1, lineStart, 0], show.matrix);
    const scale = size * st.horizontalScale;
    for (const [i, line] of text.split("\n").entries()) {
      const m = multiply([1, 0, 0, 1, 0, -i * size * LINE_HEIGHT], start);
      out.push(`${m.map(f).join(" ")} Tm`);
      const glyphs = original
        ? original.encode(line)
        : [...line].map((ch) => ({ text: ch, code: null }));
      // Glyphs kept from the original keep their spacing (kerning, justification).
      const matches =
        i === 0
          ? align(
              glyphs.map((g) => g.text),
              anchor.glyphs.map((g) => g.text),
            )
          : new Map<number, number>();
      const at: number[] = [];
      let pen = 0;
      let last = -1;
      let current = "";
      let items: string[] = [];
      const flush = () => {
        if (items.length > 0) out.push(`[${items.join(" ")}] TJ`);
        items = [];
      };
      for (const [k, glyph] of glyphs.entries()) {
        const j = matches.get(k);
        const before = last >= 0 ? matches.get(last) : undefined;
        // A space the viewer inferred from a gap: the original had no glyph.
        if (
          glyph.text === " " &&
          j === undefined &&
          before !== undefined &&
          matches.get(k + 1) === before + 1
        )
          continue;
        let target = pen;
        if (j !== undefined) {
          if (last < 0 && j === 0) target = anchor.glyphs[0]!.x - lineStart;
          else if (before !== undefined && j === before + 1)
            target = at[last]! + anchor.glyphs[j]!.x - anchor.glyphs[before]!.x;
        }
        let name: string;
        let hex: string;
        let advance: number;
        if (glyph.code !== null && original) {
          name = original.resourceName;
          hex = `<${glyph.code.toString(16).padStart(original.bytesPerCode * 2, "0")}>`;
          const wordSpace =
            original.bytesPerCode === 1 && glyph.code === 32
              ? st.wordSpacing
              : 0;
          advance =
            (original.widthOf(glyph.code) * size + st.charSpacing + wordSpace) *
            st.horizontalScale;
        } else {
          const sibling = original
            ? this.siblingGlyph(node, original, glyph.text)
            : null;
          if (sibling) {
            // Another subset of the same font in the document has the glyph.
            name = sibling.name;
            hex = `<${sibling.code.toString(16).padStart(sibling.font.bytesPerCode * 2, "0")}>`;
            advance =
              (sibling.font.widthOf(sibling.code) * size + st.charSpacing) *
              st.horizontalScale;
          } else {
            const sub = await substituteFont();
            if (!sub.name) continue;
            name = sub.name;
            hex = sub.font.encode(glyph.text).toString();
            advance =
              (sub.font.widthOf(glyph.text) * size + st.charSpacing) *
              st.horizontalScale;
          }
        }
        if (name !== current) {
          flush();
          out.push(`/${name} ${f(size)} Tf`);
          current = name;
        }
        if (Math.abs(target - pen) > 1e-4 && scale !== 0)
          items.push(f((-(target - pen) * 1000) / scale));
        items.push(hex);
        at[k] = target;
        pen = target + advance;
        last = k;
      }
      flush();
    }
    out.push("ET", "Q");
    return out.join("\n");
  }
}

/** Every text operation of the page and of the forms it draws. */
export function pageTextShows(doc: PDFDocument, page: PDFPage): TextShow[] {
  const root = buildNode(
    doc,
    pageContentBytes(doc, page),
    page.node.normalizedEntries().Resources,
    IDENTITY,
    [],
  );
  return [...allShows(root)].map(([, show]) => show);
}

/**
 * Removes the text of `edits` from the page (and the forms it draws) and
 * writes the new text in its place. Edits whose text was not found are
 * returned, to be drawn with `drawNotFound` once the content is isolated.
 */
export async function editPageText(
  doc: PDFDocument,
  page: PDFPage,
  edits: TextEditItem[],
  fonts: FontCache,
  /** Edits of scanned text: only their invisible glyphs are removed. */
  erase: TextEditItem[] = [],
): Promise<TextEditResult> {
  page.node.normalize();
  const resources = page.node.normalizedEntries().Resources;
  const root = buildNode(
    doc,
    pageContentBytes(doc, page),
    resources,
    IDENTITY,
    [],
  );
  const editor = new Editor(doc, fonts);
  const notFound = edits.filter((edit) => !editor.mark(root, edit));
  for (const edit of erase) editor.erase(root, edit);
  const bytes = await editor.rewrite(root);
  if (bytes)
    // An array, as pdf-lib expects on pages it has already normalized.
    page.node.set(
      PDFName.of("Contents"),
      doc.context.obj([doc.context.register(doc.context.flateStream(bytes))]),
    );
  return { warnings: editor.warnings, notFound };
}

const FAMILY_OF = (css: string | undefined) =>
  /mono|courier|cousine/i.test(css ?? "")
    ? "Courier"
    : /tinos|caladea|(^|[ ,])serif/i.test(css ?? "")
      ? "Times"
      : "Helvetica";

/**
 * Text of a scanned image (spec 010): the old line is covered with the color
 * of the paper around it, and the new text is drawn visibly in its place.
 */
export async function drawImageTextEdit(
  page: PDFPage,
  edit: TextEditItem,
  fonts: FontCache,
): Promise<void> {
  page.drawRectangle({ ...edit.area, color: hexToRgb(edit.background!) });
  const text = edit.text.replace(/\r\n?/g, "\n");
  if (text.trim() === "") return;
  drawTextWith(
    page,
    text,
    await fonts.forText(
      text,
      FAMILY_OF(edit.previewFont),
      edit.bold ?? false,
      edit.italic ?? false,
    ),
    {
      x: edit.at.x,
      y: edit.at.y,
      size: edit.size,
      color: edit.color,
      lineHeight: edit.size * LINE_HEIGHT,
      rotate: edit.rotate,
    },
  );
}

/**
 * Fallback for an edit whose text is not in the content (e.g. it is in an
 * annotation): covers the area with white and draws the new text on top.
 */
export async function drawNotFound(
  page: PDFPage,
  edit: TextEditItem,
  fonts: FontCache,
): Promise<string> {
  page.drawRectangle({ ...edit.area, color: hexToRgb("#ffffff") });
  const text = edit.text.replace(/\r\n?/g, "\n");
  if (text.trim() !== "")
    drawTextWith(
      page,
      text,
      await fonts.forText(text, "Helvetica", false, false),
      {
        x: edit.at.x,
        y: edit.at.y,
        size: edit.size,
        color: edit.color,
        lineHeight: edit.size * LINE_HEIGHT,
        rotate: edit.rotate,
      },
    );
  return t("engine.textNotFound", clip(edit.originalText));
}
