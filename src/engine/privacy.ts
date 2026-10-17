// Privacy x-ray (spec 015): what a PDF keeps that nobody sees, and a copy of
// it without that. Runs on the device, like the rest of the engine.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFPage,
} from "pdf-lib";
import { boundingRect, type Point, type Rect } from "../model/geometry";
import { parseContentStream, type ContentOp } from "./contentStream";
import { fontsOf } from "./pdfFonts";
import {
  clearMetadata,
  overlaps,
  pruneUnreachable,
  removeAnnotations,
} from "./redact";
import { embeddedFiles, textOf } from "./redactElsewhere";
import {
  addResource,
  ascii,
  concat,
  matrixOf,
  pageContentBytes,
  rewriteShow,
  streamBytes,
} from "./textEdit";
import {
  apply,
  findTextShows,
  IDENTITY,
  multiply,
  type Matrix,
  type ShowPart,
  type TextShow,
} from "./textShows";

export type PrivacyKind =
  | "versions"
  | "hiddenText"
  | "attachments"
  | "javascript"
  | "metadata"
  | "whiteText"
  | "authors"
  | "hiddenLayers"
  | "thumbnails"
  | "pieceInfo"
  | "links"
  | "ocrText"
  | "signatures";

export type PrivacyLevel = "high" | "medium" | "info";

/** In the order the report shows them, the riskiest first. */
export const PRIVACY_KINDS: readonly PrivacyKind[] = [
  "versions",
  "hiddenText",
  "attachments",
  "javascript",
  "metadata",
  "whiteText",
  "authors",
  "hiddenLayers",
  "thumbnails",
  "pieceInfo",
  "links",
  "ocrText",
  "signatures",
];

const LEVEL: Record<PrivacyKind, PrivacyLevel> = {
  versions: "high",
  hiddenText: "high",
  attachments: "high",
  javascript: "high",
  metadata: "medium",
  whiteText: "medium",
  authors: "medium",
  hiddenLayers: "medium",
  thumbnails: "medium",
  pieceInfo: "medium",
  links: "info",
  ocrText: "info",
  signatures: "info",
};

/** Kinds that cleaning can remove; earlier versions always go. */
export const CLEANABLE: ReadonlySet<PrivacyKind> = new Set(
  PRIVACY_KINDS.filter((k) => k !== "signatures" && k !== "versions"),
);

/** Checked by default (CA13): not links to websites nor the OCR text. */
export const CLEAN_BY_DEFAULT: ReadonlySet<PrivacyKind> = new Set(
  [...CLEANABLE].filter((k) => k !== "links" && k !== "ocrText"),
);

/**
 * One thing found. `key` says what it is (a metadata key, where some
 * JavaScript runs, a file name, a domain…); the interface translates it.
 */
export interface PrivacyDetail {
  key?: string;
  text?: string;
  /** 1-based. */
  page?: number;
  /** Bytes, or how many. */
  size?: number;
}

export interface PrivacyFinding {
  kind: PrivacyKind;
  level: PrivacyLevel;
  details: PrivacyDetail[];
}

export interface PrivacyReport {
  findings: PrivacyFinding[];
  /** Byte length of each earlier version kept in the file (CA4), oldest first. */
  previousVersions: number[];
}

const MAX_DEPTH = 12;
const EXCERPT = 80;

const excerpt = (s: string) => {
  const text = s.replace(/\s+/g, " ").trim();
  return text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1)}…` : text;
};

const name = (s: string) => PDFName.of(s);

function lookup(doc: PDFDocument, obj: PDFObject | undefined) {
  return obj === undefined ? undefined : doc.context.lookup(obj);
}

function dictOf(doc: PDFDocument, obj: PDFObject | undefined) {
  const v = lookup(doc, obj);
  return v instanceof PDFDict ? v : undefined;
}

const latin1 = (bytes: Uint8Array, from = 0, to = bytes.length) => {
  let s = "";
  for (let i = from; i < to; i++) s += String.fromCharCode(bytes[i]!);
  return s;
};

// ---------------------------------------------------------------------------
// Earlier versions (CA4)

/**
 * Where each earlier version of the file ends: incremental updates append a
 * new body, cross-reference and %%EOF after the old ones, which stay in the
 * file. The first %%EOF of a linearized file only ends its first page part.
 */
export function previousVersions(bytes: Uint8Array): number[] {
  const text = latin1(bytes);
  const ends: number[] = [];
  const marker = /startxref\s+(\d+)\s+%%EOF[ \t]*(\r\n|\r|\n)?/g;
  for (let m = marker.exec(text); m; m = marker.exec(text)) {
    const offset = Number(m[1]);
    const end = m.index + m[0].length;
    // The offset must point to a cross-reference inside this version.
    const at = text.slice(offset, offset + 40);
    if (offset < m.index && /^(xref|\s*\d+\s+\d+\s+obj)/.test(at))
      ends.push(end);
  }
  if (/\/Linearized\b/.test(text.slice(0, 1024)) && ends.length > 1)
    ends.shift();
  // Whatever follows the last %%EOF is not a version.
  return ends.slice(0, -1);
}

/** Objects of the current version that nothing points to. */
function unreachableCount(doc: PDFDocument): number {
  const ctx = doc.context;
  const reached = new Set<PDFRef>();
  const pending: PDFObject[] = [];
  const { Root, Info, Encrypt } = ctx.trailerInfo;
  for (const o of [Root, Info, Encrypt]) if (o) pending.push(o);
  while (pending.length > 0) {
    const obj = pending.pop()!;
    if (obj instanceof PDFRef) {
      if (reached.has(obj)) continue;
      reached.add(obj);
      const target = ctx.lookup(obj);
      if (target) pending.push(target);
    } else if (obj instanceof PDFDict)
      for (const [, value] of obj.entries()) pending.push(value);
    else if (obj instanceof PDFArray) pending.push(...obj.asArray());
    else if (obj instanceof PDFStream) pending.push(obj.dict);
  }
  let count = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects())
    if (!reached.has(ref) && !isObjectStream(obj)) count++;
  return count;
}

const isObjectStream = (obj: PDFObject) =>
  obj instanceof PDFStream &&
  (obj.dict.get(name("Type")) === name("ObjStm") ||
    obj.dict.get(name("Type")) === name("XRef"));

// ---------------------------------------------------------------------------
// Page content: text nobody sees (CA5) and hidden layers (CA10)

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
  /** Op indexes of `Do` of forms or images in a hidden layer. */
  hiddenDos: Set<number>;
}

interface PageScan {
  root: StreamNode;
  /** Images drawn on the page, and areas filled with a dark color. */
  images: Rect[];
  darkFills: Rect[];
}

type Classes = "hidden" | "outside" | "tiny" | "white" | "ocr";

/** Optional content groups the viewer hides (/OCProperties /D /OFF). */
function hiddenGroups(doc: PDFDocument): Set<PDFDict> {
  const props = dictOf(doc, doc.catalog.get(name("OCProperties")));
  const off = lookup(doc, dictOf(doc, props?.get(name("D")))?.get(name("OFF")));
  const set = new Set<PDFDict>();
  if (off instanceof PDFArray)
    for (const o of off.asArray()) {
      const d = dictOf(doc, o);
      if (d) set.add(d);
    }
  return set;
}

/** Whether optional content (a group or a membership dict) is hidden. */
function isHiddenContent(
  doc: PDFDocument,
  oc: PDFObject | undefined,
  off: Set<PDFDict>,
): boolean {
  const d = dictOf(doc, oc);
  if (!d || off.size === 0) return false;
  if (off.has(d)) return true;
  if (d.get(name("Type")) !== name("OCMD")) return false;
  const ocgs = lookup(doc, d.get(name("OCGs")));
  const groups = (ocgs instanceof PDFArray ? ocgs.asArray() : [ocgs])
    .map((g) => dictOf(doc, g))
    .filter((g): g is PDFDict => !!g);
  if (groups.length === 0) return false;
  const policy = d.get(name("P"));
  const hidden = groups.map((g) => off.has(g));
  if (policy === name("AllOn")) return hidden.some(Boolean);
  if (policy === name("AnyOff")) return !hidden.some(Boolean);
  if (policy === name("AllOff")) return !hidden.every(Boolean);
  return hidden.every(Boolean); // AnyOn, the default
}

const nums = (ops: ContentOp["operands"]) =>
  ops.filter((o): o is number => typeof o === "number");

function grayOf(values: number[]): number | null {
  if (values.length === 1) return values[0]!;
  if (values.length === 3) return Math.min(...values);
  if (values.length === 4)
    return (1 - Math.max(...values.slice(0, 3))) * (1 - values[3]!);
  return null;
}

/**
 * Images drawn and areas filled with a darkish color in a stream, in user
 * space; white text over them is probably meant to be seen.
 */
function backgrounds(
  ops: ContentOp[],
  base: Matrix,
  isImage: (name: string) => boolean,
  out: { images: Rect[]; darkFills: Rect[] },
) {
  let ctm = IDENTITY;
  let dark = false;
  const stack: { ctm: Matrix; dark: boolean }[] = [];
  let points: Point[] = [];
  for (const op of ops) {
    const o = op.operands;
    switch (op.operator) {
      case "q":
        stack.push({ ctm, dark });
        break;
      case "Q":
        ({ ctm, dark } = stack.pop() ?? { ctm, dark });
        break;
      case "cm": {
        const m = nums(o);
        if (m.length === 6) ctm = multiply(m as Matrix, ctm);
        break;
      }
      case "g":
      case "rg":
      case "k":
      case "sc":
      case "scn": {
        const g = grayOf(nums(o));
        dark = g !== null && g < 0.75;
        break;
      }
      case "cs":
        dark = true; // black until a color is set
        break;
      case "re": {
        const n = nums(o);
        const m = multiply(ctm, base);
        if (n.length === 4) {
          const [x, y, w, h] = n as [number, number, number, number];
          points.push(apply(m, x, y), apply(m, x + w, y + h));
        }
        break;
      }
      case "m":
      case "l":
      case "c":
      case "v":
      case "y": {
        const n = nums(o);
        const m = multiply(ctm, base);
        for (let k = 0; k + 1 < n.length; k += 2)
          points.push(apply(m, n[k]!, n[k + 1]!));
        break;
      }
      case "f":
      case "F":
      case "f*":
      case "b":
      case "b*":
      case "B":
      case "B*":
        if (dark && points.length > 1) out.darkFills.push(boundingRect(points));
        points = [];
        break;
      case "S":
      case "s":
      case "n":
        points = [];
        break;
      case "BI":
        out.images.push(unitSquare(multiply(ctm, base)));
        break;
      case "Do": {
        const target = o[0];
        if (
          typeof target === "object" &&
          target !== null &&
          "type" in target &&
          target.type === "name" &&
          isImage(target.name)
        )
          out.images.push(unitSquare(multiply(ctm, base)));
        break;
      }
    }
  }
}

const unitSquare = (m: Matrix) =>
  boundingRect([
    apply(m, 0, 0),
    apply(m, 1, 0),
    apply(m, 0, 1),
    apply(m, 1, 1),
  ]);

/** Parses a stream and, recursively, the forms it draws. */
function buildNode(
  doc: PDFDocument,
  bytes: Uint8Array,
  resources: PDFDict | undefined,
  base: Matrix,
  path: PDFObject[],
  off: Set<PDFDict>,
  scan: Omit<PageScan, "root">,
): StreamNode {
  const ops = parseContentStream(bytes);
  const children: FormChild[] = [];
  const hiddenDos = new Set<number>();
  const xobjects = resources?.lookup(name("XObject"));
  const xobject = (n: string) =>
    xobjects instanceof PDFDict ? xobjects.lookup(name(n)) : undefined;
  const shows = findTextShows(ops, fontsOf(doc, resources), {
    base,
    source: bytes,
    onDo: (n, ctm, opIndex) => {
      const stream = xobject(n);
      if (!(stream instanceof PDFStream)) return;
      if (isHiddenContent(doc, stream.dict.get(name("OC")), off))
        hiddenDos.add(opIndex);
      if (path.length >= MAX_DEPTH || path.includes(stream)) return;
      if (stream.dict.lookup(name("Subtype")) !== name("Form")) return;
      const formBytes = streamBytes(stream);
      if (!formBytes) return;
      const own = stream.dict.lookup(name("Resources"));
      const node = buildNode(
        doc,
        formBytes,
        own instanceof PDFDict ? own : resources,
        multiply(multiply(matrixOf(doc, stream.dict), ctm), base),
        [...path, stream],
        off,
        scan,
      );
      children.push({ opIndex, stream, node });
    },
  });
  backgrounds(
    ops,
    base,
    (n) => {
      const s = xobject(n);
      return (
        s instanceof PDFStream && s.dict.get(name("Subtype")) === name("Image")
      );
    },
    scan,
  );
  return { bytes, ops, shows, resources, children, hiddenDos };
}

function scanPage(
  doc: PDFDocument,
  page: PDFPage,
  off: Set<PDFDict>,
): PageScan {
  const scan = { images: [] as Rect[], darkFills: [] as Rect[] };
  const root = buildNode(
    doc,
    pageContentBytes(doc, page),
    page.node.normalizedEntries().Resources,
    IDENTITY,
    [],
    off,
    scan,
  );
  return { root, ...scan };
}

function* allShows(node: StreamNode): Generator<[StreamNode, TextShow]> {
  for (const show of node.shows) yield [node, show];
  for (const child of node.children) yield* allShows(child.node);
}

const center = (r: Rect): Point => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});
const contains = (r: Rect, p: Point) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

function isWhite(color: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  return !!m && m.slice(1).every((h) => parseInt(h, 16) >= 0xf0);
}

function pageBox(page: PDFPage): Rect {
  const crop = page.getCropBox();
  const media = page.getMediaBox();
  const x = Math.max(crop.x, media.x);
  const y = Math.max(crop.y, media.y);
  return {
    x,
    y,
    width: Math.min(crop.x + crop.width, media.x + media.width) - x,
    height: Math.min(crop.y + crop.height, media.y + media.height) - y,
  };
}

/** What kind of text nobody sees `show` is, if any. */
function classify(show: TextShow, page: PageScan, box: Rect): Classes | null {
  if (!show.text.trim()) return null;
  const mode = show.state.renderMode;
  const at = center(show.bbox);
  const overImage = page.images.some((r) => contains(r, at));
  if (mode === 3 || mode === 7) return overImage ? "ocr" : "hidden";
  if (!overlaps(show.bbox, box)) return "outside";
  if (show.size < 1) return "tiny";
  if (
    mode % 2 === 0 &&
    isWhite(show.color) &&
    !overImage &&
    !page.darkFills.some((r) => contains(r, at))
  )
    return "white";
  return null;
}

const KIND_OF: Record<Classes, PrivacyKind> = {
  hidden: "hiddenText",
  outside: "hiddenText",
  tiny: "hiddenText",
  white: "whiteText",
  ocr: "ocrText",
};

// ---------------------------------------------------------------------------
// Actions (CA7, CA8)

const RISKY_ACTIONS = new Set([
  "JavaScript",
  "Launch",
  "SubmitForm",
  "ImportData",
  "GoToR",
  "GoToE",
  "Rendition",
]);

interface ActionVisit {
  type: string;
  action: PDFDict;
  where: string;
}

/** Every action of a dict (its /A and /AA, and their /Next chains). */
function actionsOf(
  doc: PDFDocument,
  holder: PDFDict,
  where: string,
  out: ActionVisit[],
) {
  const visit = (obj: PDFObject | undefined, depth: number) => {
    const action = dictOf(doc, obj);
    if (!action || depth > MAX_DEPTH) return;
    const s = action.get(name("S"));
    if (s instanceof PDFName) out.push({ type: s.decodeText(), action, where });
    const next = lookup(doc, action.get(name("Next")));
    if (next instanceof PDFArray)
      for (const n of next.asArray()) visit(n, depth + 1);
    else visit(next, depth + 1);
  };
  visit(holder.get(name("A")), 0);
  const aa = dictOf(doc, holder.get(name("AA")));
  if (aa) for (const [, value] of aa.entries()) visit(value, 0);
}

function jsText(doc: PDFDocument, action: PDFDict): string {
  return excerpt(textOf(doc, action.get(name("JS"))));
}

function documentJavaScript(doc: PDFDocument): PDFDict[] {
  const names = dictOf(doc, doc.catalog.get(name("Names")));
  const root = names?.get(name("JavaScript"));
  const out: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const walk = (node: PDFObject | undefined, depth: number) => {
    const dict = dictOf(doc, node);
    if (!dict || seen.has(dict) || depth > MAX_DEPTH) return;
    seen.add(dict);
    const pairs = dict.lookup(name("Names"));
    if (pairs instanceof PDFArray)
      for (let i = 1; i < pairs.size(); i += 2) {
        const js = dictOf(doc, pairs.get(i));
        if (js) out.push(js);
      }
    const kids = dict.lookup(name("Kids"));
    if (kids instanceof PDFArray)
      for (const k of kids.asArray()) walk(k, depth + 1);
  };
  walk(root, 0);
  return out;
}

/** Every field of the form, parents included, depth first. */
function allFields(doc: PDFDocument): PDFDict[] {
  const acro = dictOf(doc, doc.catalog.get(name("AcroForm")));
  const out: PDFDict[] = [];
  const seen = new Set<PDFDict>();
  const walk = (obj: PDFObject | undefined, depth: number) => {
    const d = dictOf(doc, obj);
    if (!d || seen.has(d) || depth > MAX_DEPTH) return;
    seen.add(d);
    out.push(d);
    const kids = lookup(doc, d.get(name("Kids")));
    if (kids instanceof PDFArray)
      for (const k of kids.asArray()) walk(k, depth + 1);
  };
  const fields = lookup(doc, acro?.get(name("Fields")));
  if (fields instanceof PDFArray) for (const f of fields.asArray()) walk(f, 0);
  return out;
}

function annotationsOf(doc: PDFDocument, page: PDFPage): PDFDict[] {
  const annots = page.node.lookup(name("Annots"));
  if (!(annots instanceof PDFArray)) return [];
  return annots
    .asArray()
    .map((a) => dictOf(doc, a))
    .filter((a): a is PDFDict => !!a);
}

function domainOf(uri: string): string {
  const m = /^[a-z][a-z0-9+.-]*:(\/\/)?([^/?#]*)/i.exec(uri.trim());
  if (!m) return uri.trim().slice(0, 40);
  const scheme = uri.trim().split(":")[0]!.toLowerCase();
  if (scheme === "mailto") return "mailto:" + (m[2]!.split("@")[1] ?? "");
  return m[2]!.replace(/^[^@]*@/, "").toLowerCase() || scheme;
}

// ---------------------------------------------------------------------------
// The report

function decodeDate(value: string): string {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value);
  if (!m) return value;
  const [, y, mo = "01", d = "01", h, mi] = m;
  return `${y}-${mo}-${d}${h ? ` ${h}:${mi ?? "00"}` : ""}`;
}

function sizeOfFileSpec(doc: PDFDocument, spec: PDFObject | undefined) {
  const fs = dictOf(doc, spec);
  const ef = dictOf(doc, fs?.get(name("EF")));
  const file = lookup(doc, ef?.get(name("UF")) ?? ef?.get(name("F")));
  if (!(file instanceof PDFStream)) return undefined;
  const params = dictOf(doc, file.dict.get(name("Params")));
  const size = lookup(doc, params?.get(name("Size")));
  if (size instanceof PDFNumber) return size.asNumber();
  return file instanceof PDFRawStream ? file.contents.length : undefined;
}

function fileSpecName(doc: PDFDocument, spec: PDFObject | undefined): string {
  const fs = lookup(doc, spec);
  if (fs instanceof PDFString || fs instanceof PDFHexString)
    return fs.decodeText();
  const d = dictOf(doc, fs);
  return textOf(doc, d?.get(name("UF"))) || textOf(doc, d?.get(name("F")));
}

/** Indirect dicts (and stream dicts) that hold `key`. */
function holdersOf(doc: PDFDocument, key: string): PDFDict[] {
  const out: PDFDict[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const d = obj instanceof PDFStream ? obj.dict : obj;
    if (d instanceof PDFDict && d.has(name(key))) out.push(d);
  }
  return out;
}

/** Analyzes `bytes` (CA2–CA12). */
export async function scanPrivacy(bytes: Uint8Array): Promise<PrivacyReport> {
  const doc = await PDFDocument.load(bytes.slice(), {
    updateMetadata: false,
    ignoreEncryption: true,
  });
  const found = new Map<PrivacyKind, PrivacyDetail[]>();
  const add = (kind: PrivacyKind, detail: PrivacyDetail) =>
    found.set(kind, [...(found.get(kind) ?? []), detail]);

  // Earlier versions and leftovers of earlier edits.
  const versions = previousVersions(bytes);
  versions.forEach((end, i) =>
    add("versions", { key: "version", text: String(i + 1), size: end }),
  );
  const loose = unreachableCount(doc);
  if (loose > 0) add("versions", { key: "loose", size: loose });

  // Metadata.
  const info = dictOf(doc, doc.context.trailerInfo.Info);
  if (info)
    for (const [key, value] of info.entries()) {
      let text = textOf(doc, value).trim();
      if (!text) continue;
      const k = key.decodeText();
      if (k === "CreationDate" || k === "ModDate") text = decodeDate(text);
      add("metadata", { key: k, text: excerpt(text) });
    }
  const xmp = lookup(doc, doc.catalog.get(name("Metadata")));
  if (xmp instanceof PDFStream) {
    const raw = streamBytes(xmp);
    add("metadata", { key: "XMP", size: raw?.length ?? 0 });
  }
  const otherXmp = holdersOf(doc, "Metadata").filter(
    (d) => d !== doc.catalog,
  ).length;
  if (otherXmp > 0) add("metadata", { key: "XMPParts", size: otherXmp });

  // Attachments.
  for (const [fileName, spec] of embeddedFiles(doc))
    add("attachments", {
      text: fileSpecName(doc, spec) || fileName,
      size: sizeOfFileSpec(doc, spec),
    });

  // JavaScript and actions, links, authors, per page.
  const actions: ActionVisit[] = [];
  for (const js of documentJavaScript(doc))
    actions.push({ type: "JavaScript", action: js, where: "document" });
  // The open action and the document's own triggers, as /A and /AA.
  const catalogActions = doc.context.obj({});
  const open = lookup(doc, doc.catalog.get(name("OpenAction")));
  if (open instanceof PDFDict) catalogActions.set(name("A"), open);
  const catalogAA = doc.catalog.get(name("AA"));
  if (catalogAA) catalogActions.set(name("AA"), catalogAA);
  actionsOf(doc, catalogActions, "document", actions);
  const acro = dictOf(doc, doc.catalog.get(name("AcroForm")));
  if (acro?.has(name("XFA"))) add("javascript", { key: "xfa" });
  const fieldDicts = allFields(doc);
  const authors = new Map<string, number>();
  const links = new Map<string, number>();
  const pages = doc.getPages();
  const widgets = new Set<PDFDict>();
  for (const [i, page] of pages.entries()) {
    actionsOf(doc, page.node, `page:${i + 1}`, actions);
    for (const annot of annotationsOf(doc, page)) {
      const subtype = annot.get(name("Subtype"));
      if (subtype === name("Widget")) widgets.add(annot);
      actionsOf(
        doc,
        annot,
        subtype === name("Widget") ? `field:${i + 1}` : `annot:${i + 1}`,
        actions,
      );
      const author = textOf(doc, annot.get(name("T"))).trim();
      if (author && subtype !== name("Widget"))
        authors.set(author, (authors.get(author) ?? 0) + 1);
      if (subtype === name("FileAttachment"))
        add("attachments", {
          text: fileSpecName(doc, annot.get(name("FS"))),
          size: sizeOfFileSpec(doc, annot.get(name("FS"))),
          page: i + 1,
        });
    }
    if (page.node.has(name("Thumb"))) add("thumbnails", { page: i + 1 });
  }
  for (const field of fieldDicts)
    if (!widgets.has(field)) actionsOf(doc, field, "field", actions);
  for (const { type, action, where } of actions) {
    const [place, n] = where.split(":");
    const page = n ? Number(n) : undefined;
    if (type === "URI") {
      const domain = domainOf(textOf(doc, action.get(name("URI"))));
      links.set(domain, (links.get(domain) ?? 0) + 1);
    } else if (RISKY_ACTIONS.has(type))
      add("javascript", {
        key: type === "JavaScript" ? place : type,
        text: type === "JavaScript" ? jsText(doc, action) : undefined,
        page,
      });
  }
  for (const [domain, count] of links)
    add("links", { text: domain, size: count });
  for (const [author, count] of authors)
    add("authors", { text: author, size: count });

  // Hidden layers.
  const off = hiddenGroups(doc);
  for (const group of off)
    add("hiddenLayers", { text: textOf(doc, group.get(name("Name"))) });

  // Private data of editing programs.
  for (const holder of holdersOf(doc, "PieceInfo")) {
    const piece = dictOf(doc, holder.get(name("PieceInfo")));
    add("pieceInfo", {
      text: piece
        ? piece
            .keys()
            .map((k) => k.decodeText())
            .join(", ")
        : "",
    });
  }

  // Text nobody sees.
  for (const [i, page] of pages.entries()) {
    const scan = scanPage(doc, page, off);
    const box = pageBox(page);
    const byClass = new Map<Classes, string[]>();
    for (const [, show] of allShows(scan.root)) {
      const c = classify(show, scan, box);
      if (c) byClass.set(c, [...(byClass.get(c) ?? []), show.text]);
    }
    for (const [c, texts] of byClass)
      add(KIND_OF[c], {
        key: c,
        page: i + 1,
        text: excerpt(texts.join(" ")),
        size: texts.length,
      });
  }

  // Digital signatures.
  for (const field of fieldDicts)
    if (field.get(name("FT")) === name("Sig") && field.has(name("V"))) {
      const v = dictOf(doc, field.get(name("V")));
      add("signatures", {
        text:
          textOf(doc, v?.get(name("Name"))) ||
          textOf(doc, field.get(name("T"))),
      });
    }

  const findings = PRIVACY_KINDS.flatMap((kind): PrivacyFinding[] => {
    const details = found.get(kind);
    if (!details) return [];
    // Leftover objects alone, without earlier versions, are a lesser risk.
    const level =
      kind === "versions" && versions.length === 0 ? "medium" : LEVEL[kind];
    return [{ kind, level, details }];
  });
  return { findings, previousVersions: versions };
}

// ---------------------------------------------------------------------------
// Cleaning (CA13)

/** New bytes for a stream tree without what `drop` says, or null. */
function rewriteNode(
  doc: PDFDocument,
  node: StreamNode,
  drop: (show: TextShow) => boolean,
  dropLayers: boolean,
  off: Set<PDFDict>,
): Uint8Array | null {
  const cuts: { start: number; end: number; text: string }[] = [];
  const dropped = new Set<number>();

  if (dropLayers) {
    // Marked content of a hidden layer: removed whole outside text objects;
    // inside one, its text is emptied so what follows keeps its place.
    const properties = node.resources?.lookup(name("Properties"));
    const stack: { hidden: boolean; start: number; inText: boolean }[] = [];
    let inText = false;
    for (const [i, op] of node.ops.entries()) {
      if (op.operator === "BT") inText = true;
      if (op.operator === "ET") inText = false;
      if (op.operator === "BMC")
        stack.push({ hidden: false, start: i, inText });
      else if (op.operator === "BDC") {
        const [tag, props] = op.operands;
        let hidden = false;
        if (
          typeof tag === "object" &&
          tag !== null &&
          "type" in tag &&
          tag.type === "name" &&
          tag.name === "OC" &&
          typeof props === "object" &&
          props !== null &&
          "type" in props &&
          props.type === "name" &&
          properties instanceof PDFDict
        )
          hidden = isHiddenContent(doc, properties.get(name(props.name)), off);
        stack.push({ hidden, start: i, inText });
      } else if (op.operator === "EMC") {
        const open = stack.pop();
        const outer = stack.some((s) => s.hidden);
        if (open?.hidden && !outer) {
          if (!open.inText) {
            cuts.push({
              start: node.ops[open.start]!.start,
              end: op.end,
              text: " ",
            });
            for (let k = open.start; k <= i; k++) dropped.add(k);
          } else
            for (const show of node.shows)
              if (show.opIndex > open.start && show.opIndex < i)
                dropped.add(-1 - show.opIndex); // marked: empty it
        }
      }
    }
    for (const i of node.hiddenDos)
      if (!dropped.has(i)) {
        const op = node.ops[i]!;
        cuts.push({ start: op.start, end: op.end, text: " " });
        dropped.add(i);
      }
  }

  for (const show of node.shows) {
    if (dropped.has(show.opIndex)) continue;
    if (!drop(show) && !dropped.has(-1 - show.opIndex)) continue;
    const glyphs = new Set<ShowPart>(
      show.parts.filter((p) => p.kind === "glyph"),
    );
    cuts.push({
      start: show.start,
      end: show.end,
      text: ` ${rewriteShow(show, node.ops[show.opIndex]!, glyphs)} `,
    });
  }

  for (const child of node.children) {
    if (dropped.has(child.opIndex)) continue;
    const bytes = rewriteNode(doc, child.node, drop, dropLayers, off);
    if (!bytes || !node.resources) continue;
    // Copy-on-write: the original form stays as it is for its other uses.
    const copy = doc.context.flateStream(bytes);
    for (const [key, value] of child.stream.dict.entries())
      if (!["Length", "Filter", "DecodeParms"].includes(key.decodeText()))
        copy.dict.set(key, value);
    const ref = addResource(
      doc,
      node.resources,
      "XObject",
      doc.context.register(copy),
      "PxX",
    );
    const op = node.ops[child.opIndex]!;
    cuts.push({ start: op.start, end: op.end, text: ` /${ref} Do ` });
  }
  if (cuts.length === 0) return null;
  cuts.sort((a, b) => a.start - b.start);
  const chunks: Uint8Array[] = [];
  let pos = 0;
  for (const cut of cuts) {
    if (cut.start < pos) continue; // inside a removed block
    chunks.push(node.bytes.subarray(pos, cut.start), ascii(cut.text));
    pos = cut.end;
  }
  chunks.push(node.bytes.subarray(pos));
  return concat(chunks);
}

function removeActions(doc: PDFDocument, holder: PDFDict) {
  holder.delete(name("AA"));
  const a = dictOf(doc, holder.get(name("A")));
  const s = a?.get(name("S"));
  if (s instanceof PDFName && RISKY_ACTIONS.has(s.decodeText()))
    holder.delete(name("A"));
  else if (a?.has(name("Next"))) a.delete(name("Next"));
}

function removeHiddenLayers(doc: PDFDocument, off: Set<PDFDict>) {
  const props = dictOf(doc, doc.catalog.get(name("OCProperties")));
  if (!props) return;
  const isOff = (o: PDFObject) => {
    const d = dictOf(doc, o);
    return !!d && off.has(d);
  };
  const prune = (arr: PDFArray, depth = 0) => {
    for (let i = arr.size() - 1; i >= 0; i--) {
      const item = lookup(doc, arr.get(i));
      if (item instanceof PDFArray && depth < MAX_DEPTH) prune(item, depth + 1);
      else if (isOff(arr.get(i))) arr.remove(i);
    }
  };
  const ocgs = lookup(doc, props.get(name("OCGs")));
  if (ocgs instanceof PDFArray) prune(ocgs);
  const configs = [
    dictOf(doc, props.get(name("D"))),
    ...((): (PDFDict | undefined)[] => {
      const c = lookup(doc, props.get(name("Configs")));
      return c instanceof PDFArray
        ? c.asArray().map((x) => dictOf(doc, x))
        : [];
    })(),
  ];
  for (const config of configs)
    for (const key of ["ON", "OFF", "Order", "RBGroups", "Locked"]) {
      const arr = lookup(doc, config?.get(name(key)));
      if (arr instanceof PDFArray) prune(arr);
    }
  if (ocgs instanceof PDFArray && ocgs.size() === 0)
    doc.catalog.delete(name("OCProperties"));
}

/**
 * A copy of `bytes` without what `kinds` names, written whole: no earlier
 * versions and no objects nothing points to (CA13).
 */
export async function cleanPrivacy(
  bytes: Uint8Array,
  kinds: ReadonlySet<PrivacyKind>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  const has = (k: PrivacyKind) => kinds.has(k);
  const pages = doc.getPages();
  const off = hiddenGroups(doc);

  // Page content first: it reads the layers and the fonts as they are.
  const texts = new Set<Classes>();
  if (has("hiddenText"))
    ["hidden", "outside", "tiny"].forEach((c) => texts.add(c as Classes));
  if (has("whiteText")) texts.add("white");
  if (has("ocrText")) texts.add("ocr");
  const dropLayers = has("hiddenLayers") && off.size > 0;
  if (texts.size > 0 || dropLayers)
    for (const page of pages) {
      const scan = scanPage(doc, page, off);
      const box = pageBox(page);
      const bytesOut = rewriteNode(
        doc,
        scan.root,
        (show) => {
          const c = classify(show, scan, box);
          return c !== null && texts.has(c);
        },
        dropLayers,
        off,
      );
      if (bytesOut)
        page.node.set(
          name("Contents"),
          doc.context.obj([
            doc.context.register(doc.context.flateStream(bytesOut)),
          ]),
        );
    }

  if (dropLayers) {
    for (const page of pages)
      removeAnnotations(doc, page, (a) =>
        isHiddenContent(doc, a.get(name("OC")), off),
      );
    removeHiddenLayers(doc, off);
  }

  if (has("metadata")) {
    clearMetadata(doc);
    for (const holder of holdersOf(doc, "Metadata"))
      holder.delete(name("Metadata"));
  }
  if (has("pieceInfo"))
    for (const holder of holdersOf(doc, "PieceInfo"))
      holder.delete(name("PieceInfo"));
  if (has("thumbnails"))
    for (const page of pages) page.node.delete(name("Thumb"));

  if (has("attachments")) {
    const names = dictOf(doc, doc.catalog.get(name("Names")));
    names?.delete(name("EmbeddedFiles"));
    doc.catalog.delete(name("AF"));
    for (const page of pages) {
      page.node.delete(name("AF"));
      removeAnnotations(
        doc,
        page,
        (a) => a.get(name("Subtype")) === name("FileAttachment"),
      );
    }
  }

  if (has("javascript")) {
    const names = dictOf(doc, doc.catalog.get(name("Names")));
    names?.delete(name("JavaScript"));
    const open = dictOf(doc, doc.catalog.get(name("OpenAction")));
    const s = open?.get(name("S"));
    if (s instanceof PDFName && RISKY_ACTIONS.has(s.decodeText()))
      doc.catalog.delete(name("OpenAction"));
    doc.catalog.delete(name("AA"));
    dictOf(doc, doc.catalog.get(name("AcroForm")))?.delete(name("XFA"));
    for (const page of pages) {
      page.node.delete(name("AA"));
      for (const annot of annotationsOf(doc, page)) removeActions(doc, annot);
    }
    for (const field of allFields(doc)) removeActions(doc, field);
  }

  if (has("links"))
    for (const page of pages)
      removeAnnotations(doc, page, (a) => {
        if (a.get(name("Subtype")) !== name("Link")) return false;
        const action = dictOf(doc, a.get(name("A")));
        return action?.get(name("S")) === name("URI");
      });

  if (has("authors"))
    for (const page of pages)
      for (const annot of annotationsOf(doc, page))
        if (annot.get(name("Subtype")) !== name("Widget"))
          annot.delete(name("T"));

  pruneUnreachable(doc);
  return doc.save({ updateFieldAppearances: false });
}
