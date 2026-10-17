import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from "pdf-lib";
import type { Needles } from "../model/document";
import type { Rect } from "../model/geometry";
import type { FontCache } from "./fonts";
import { inherited, rawFields, type RawField } from "./formRead";
import { clearFieldValues } from "./forms";
import { overlaps, rectOfAnnot, removeAnnotations } from "./redact";
import { findRanges } from "./textMatch";

/**
 * Secure redaction, elsewhere in the file (spec 012, CA13). What was under
 * the areas, or was searched to mark them, can also be written outside the
 * page content: in notes and comments, bookmark titles, attachments, the
 * values of form fields away from the areas, and the document metadata. This
 * finds those places and, when asked, removes the notes, bookmarks (their
 * children move up) and attachments that hold it, empties the fields (their
 * appearance is drawn again) and drops the metadata entries.
 *
 * Annotations and fields that touch an applied area are not counted: the
 * area itself removes them.
 */

export type ElsewhereKind =
  "annotations" | "bookmarks" | "attachments" | "fields" | "metadata";

export type ElsewhereCounts = Record<ElsewhereKind, number>;

export const noElsewhere = (): ElsewhereCounts => ({
  annotations: 0,
  bookmarks: 0,
  attachments: 0,
  fields: 0,
  metadata: 0,
});

/** Up to this many bytes of an attachment are read as text. */
const MAX_ATTACHMENT_TEXT = 4 * 1024 * 1024;
const MAX_DEPTH = 64;
const INFO_KEYS = ["Title", "Author", "Subject", "Keywords"];

/** The document information dictionary, if any. */
function infoDict(doc: PDFDocument): PDFDict | undefined {
  const info = doc.context.trailerInfo.Info;
  const dict = info ? doc.context.lookup(info) : undefined;
  return dict instanceof PDFDict ? dict : undefined;
}

/** Joins needles of several areas, without repeats. */
export function mergeNeedles(list: (Needles | undefined)[]): Needles | null {
  const texts = new Set<string>();
  const patterns = new Set<string>();
  for (const n of list) {
    n?.texts.forEach((t) => texts.add(t));
    n?.patterns.forEach((p) => patterns.add(p));
  }
  return texts.size + patterns.size > 0
    ? { texts: [...texts], patterns: [...patterns] }
    : null;
}

/** True when `text` holds one of the needles (any case and accents). */
export function matcherOf(needles: Needles): (text: string) => boolean {
  return (text) => {
    const flat = text.replace(/\s+/g, " ");
    return (
      needles.texts.some((n) => findRanges(flat, n, false).length > 0) ||
      needles.patterns.some((p) => {
        try {
          return findRanges(flat, p, true).length > 0;
        } catch {
          return false;
        }
      })
    );
  };
}

/** Text of a string, a name, an array of them or a (rich text) stream. */
export function textOf(
  doc: PDFDocument,
  obj: PDFObject | undefined,
  depth = 0,
): string {
  const v = obj ? doc.context.lookup(obj) : undefined;
  if (v instanceof PDFString || v instanceof PDFHexString)
    return v.decodeText();
  if (v instanceof PDFName) return v.decodeText();
  if (v instanceof PDFArray && depth < 4)
    return v
      .asArray()
      .map((o) => textOf(doc, o, depth + 1))
      .join(" ");
  if (v instanceof PDFRawStream) return streamText(v) ?? "";
  return "";
}

/** Rich text and XMP: the words, without the markup. */
const withoutMarkup = (xml: string) =>
  xml
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&");

/**
 * Decoded content of a stream read as text, when it is text: valid UTF-8 (or
 * UTF-16 with a byte order mark) that is mostly printable. Null otherwise.
 */
function streamText(stream: PDFRawStream): string | null {
  let bytes: Uint8Array;
  try {
    bytes = decodePDFRawStream(stream).decode();
  } catch {
    return null;
  }
  if (bytes.length > MAX_ATTACHMENT_TEXT)
    bytes = bytes.subarray(0, MAX_ATTACHMENT_TEXT);
  let text: string;
  try {
    const utf16 =
      (bytes[0] === 0xfe && bytes[1] === 0xff) ||
      (bytes[0] === 0xff && bytes[1] === 0xfe);
    text = new TextDecoder(
      // i18n-ignore: encoding labels
      utf16 ? (bytes[0] === 0xfe ? "utf-16be" : "utf-16le") : "utf-8",
      { fatal: true },
    ).decode(bytes);
  } catch {
    return null;
  }
  if (text.length === 0) return "";
  const printable = text.replace(/[^\P{C}\t\n\r]/gu, "").length;
  return printable / text.length > 0.9 ? text : null;
}

interface Found {
  /** Annotations to remove, by page (FileAttachment ones count as attachments). */
  annotations: Map<PDFPage, Set<PDFDict>>;
  bookmarks: Set<PDFDict>;
  /** File specifications of the document's attachments to remove. */
  attachments: Set<PDFDict>;
  fields: RawField[];
  info: string[];
  xmp: boolean;
  counts: ElsewhereCounts;
}

/** What a file specification says: names, description and text content. */
function fileSpecText(doc: PDFDocument, spec: PDFObject | undefined): string {
  const fs = spec ? doc.context.lookup(spec) : undefined;
  if (fs instanceof PDFString || fs instanceof PDFHexString)
    return fs.decodeText();
  if (!(fs instanceof PDFDict)) return "";
  const parts = ["F", "UF", "Desc"].map((k) =>
    textOf(doc, fs.get(PDFName.of(k))),
  );
  const ef = fs.lookup(PDFName.of("EF"));
  if (ef instanceof PDFDict)
    for (const k of ["UF", "F"]) {
      const file = ef.lookup(PDFName.of(k));
      if (file instanceof PDFRawStream) {
        parts.push(streamText(file) ?? "");
        break;
      }
    }
  return parts.join("\n");
}

/** Leaves [name, file specification] of the EmbeddedFiles name tree. */
export function embeddedFiles(doc: PDFDocument): [string, PDFObject][] {
  const names = doc.catalog.lookup(PDFName.of("Names"));
  if (!(names instanceof PDFDict)) return [];
  const root = names.lookup(PDFName.of("EmbeddedFiles"));
  const out: [string, PDFObject][] = [];
  const seen = new Set<PDFDict>();
  const walk = (node: PDFObject | undefined, depth: number) => {
    const dict = node ? doc.context.lookup(node) : undefined;
    if (!(dict instanceof PDFDict) || seen.has(dict) || depth > MAX_DEPTH)
      return;
    seen.add(dict);
    const pairs = dict.lookup(PDFName.of("Names"));
    if (pairs instanceof PDFArray)
      for (let i = 0; i + 1 < pairs.size(); i += 2)
        out.push([textOf(doc, pairs.get(i)), pairs.get(i + 1)]);
    const kids = dict.lookup(PDFName.of("Kids"));
    if (kids instanceof PDFArray)
      for (const k of kids.asArray()) walk(k, depth + 1);
  };
  walk(root, 0);
  return out;
}

/** Items of the outline, depth first, with the title of each. */
function outlineItems(doc: PDFDocument): PDFDict[] {
  const root = doc.catalog.lookup(PDFName.of("Outlines"));
  const out: PDFDict[] = [];
  if (!(root instanceof PDFDict)) return out;
  const seen = new Set<PDFDict>();
  const walk = (parent: PDFDict, depth: number) => {
    let node = parent.lookup(PDFName.of("First"));
    while (node instanceof PDFDict && !seen.has(node) && depth < MAX_DEPTH) {
      seen.add(node);
      out.push(node);
      walk(node, depth + 1);
      node = node.lookup(PDFName.of("Next"));
    }
  };
  walk(root, 0);
  return out;
}

/** Finds the data elsewhere than under the applied `areas` (by page). */
export function findElsewhere(
  doc: PDFDocument,
  needles: Needles,
  areas: Map<PDFPage, Rect[]>,
): Found {
  const holds = matcherOf(needles);
  const counts = noElsewhere();
  const found: Found = {
    annotations: new Map(),
    bookmarks: new Set(),
    attachments: new Set(),
    fields: [],
    info: [],
    xmp: false,
    counts,
  };
  const touched = (page: PDFPage, dict: PDFDict) => {
    const rect = rectOfAnnot(doc, dict);
    return !!rect && (areas.get(page) ?? []).some((a) => overlaps(a, rect));
  };

  // Notes, comments and attachment annotations; widgets go with their field.
  const widgetPage = new Map<PDFDict, PDFPage>();
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (const entry of annots.asArray()) {
      const dict = doc.context.lookup(entry);
      if (!(dict instanceof PDFDict)) continue;
      const subtype = dict.lookup(PDFName.of("Subtype"));
      if (subtype === PDFName.of("Widget")) {
        widgetPage.set(dict, page);
        continue;
      }
      if (subtype === PDFName.of("Popup") || subtype === PDFName.of("Link"))
        continue;
      if (touched(page, dict)) continue;
      const attachment = subtype === PDFName.of("FileAttachment");
      const text = [
        ...["Contents", "T", "Subj"].map((k) =>
          textOf(doc, dict.get(PDFName.of(k))),
        ),
        withoutMarkup(textOf(doc, dict.get(PDFName.of("RC")))),
        attachment ? fileSpecText(doc, dict.get(PDFName.of("FS"))) : "",
      ].join("\n");
      if (!holds(text)) continue;
      const set = found.annotations.get(page) ?? new Set<PDFDict>();
      set.add(dict);
      found.annotations.set(page, set);
      counts[attachment ? "attachments" : "annotations"]++;
    }
  }

  for (const item of outlineItems(doc))
    if (holds(textOf(doc, item.get(PDFName.of("Title"))))) {
      found.bookmarks.add(item);
      counts.bookmarks++;
    }

  for (const [name, spec] of embeddedFiles(doc)) {
    const dict = doc.context.lookup(spec);
    if (!(dict instanceof PDFDict)) continue;
    if (holds(`${name}\n${fileSpecText(doc, spec)}`)) {
      found.attachments.add(dict);
      counts.attachments++;
    }
  }

  // Field values, unless every widget of the field is under an area.
  for (const raw of rawFields(doc)) {
    const value = ["V", "DV"]
      .map((k) => textOf(doc, inherited(raw.chain, k) as PDFObject))
      .join("\n");
    if (!holds(value)) continue;
    const removed = raw.widgets.every(({ dict }) => {
      const page = widgetPage.get(dict);
      return !!page && touched(page, dict);
    });
    if (removed) continue;
    found.fields.push(raw);
    counts.fields++;
  }

  const info = infoDict(doc);
  for (const key of INFO_KEYS)
    if (info && holds(textOf(doc, info.get(PDFName.of(key)))))
      found.info.push(key);
  const xmp = doc.catalog.lookup(PDFName.of("Metadata"));
  if (
    xmp instanceof PDFRawStream &&
    holds(withoutMarkup(streamText(xmp) ?? ""))
  )
    found.xmp = true;
  counts.metadata = found.info.length + (found.xmp ? 1 : 0);
  return found;
}

/** Links `kids` as the children of `parent`, in order. */
function rebuildOutline(doc: PDFDocument, parent: PDFDict, kids: PDFDict[]) {
  const refOf = (d: PDFDict) =>
    doc.context.getObjectRef(d) ?? doc.context.register(d);
  const parentRef = refOf(parent);
  kids.forEach((kid, i) => {
    kid.set(PDFName.of("Parent"), parentRef);
    if (i > 0) kid.set(PDFName.of("Prev"), refOf(kids[i - 1]!));
    else kid.delete(PDFName.of("Prev"));
    if (i < kids.length - 1) kid.set(PDFName.of("Next"), refOf(kids[i + 1]!));
    else kid.delete(PDFName.of("Next"));
  });
  if (kids.length > 0) {
    parent.set(PDFName.of("First"), refOf(kids[0]!));
    parent.set(PDFName.of("Last"), refOf(kids[kids.length - 1]!));
  } else {
    parent.delete(PDFName.of("First"));
    parent.delete(PDFName.of("Last"));
  }
}

/** Removes outline items; their children take their place. */
function removeBookmarks(doc: PDFDocument, gone: Set<PDFDict>) {
  const root = doc.catalog.lookup(PDFName.of("Outlines"));
  if (!(root instanceof PDFDict)) return;
  const seen = new Set<PDFDict>();
  const childrenOf = (parent: PDFDict, depth: number): PDFDict[] => {
    const out: PDFDict[] = [];
    let node = parent.lookup(PDFName.of("First"));
    while (node instanceof PDFDict && !seen.has(node) && depth < MAX_DEPTH) {
      seen.add(node);
      const next = node.lookup(PDFName.of("Next"));
      const kids = childrenOf(node, depth + 1);
      if (gone.has(node)) out.push(...kids);
      else {
        rebuildOutline(doc, node, kids);
        out.push(node);
      }
      node = next;
    }
    return out;
  };
  const top = childrenOf(root, 0);
  rebuildOutline(doc, root, top);
  // Count: open items count their visible descendants, closed ones negative.
  const visible = (item: PDFDict): number => {
    let n = 0;
    let node = item.lookup(PDFName.of("First"));
    while (node instanceof PDFDict) {
      const count = node.lookup(PDFName.of("Count"));
      const open = count instanceof PDFNumber && count.asNumber() > 0;
      const below = visible(node);
      if (below === 0) node.delete(PDFName.of("Count"));
      else node.set(PDFName.of("Count"), PDFNumber.of(open ? below : -below));
      n += 1 + (open ? below : 0);
      node = node.lookup(PDFName.of("Next"));
    }
    return n;
  };
  root.set(PDFName.of("Count"), PDFNumber.of(visible(root)));
}

/** Removes attachments from the EmbeddedFiles name tree and the catalog /AF. */
function removeAttachments(doc: PDFDocument, gone: Set<PDFDict>) {
  const names = doc.catalog.lookup(PDFName.of("Names"));
  if (names instanceof PDFDict) {
    const kept = embeddedFiles(doc).filter(
      ([, spec]) => !gone.has(doc.context.lookup(spec) as PDFDict),
    );
    if (kept.length === 0) names.delete(PDFName.of("EmbeddedFiles"));
    else
      names.set(
        PDFName.of("EmbeddedFiles"),
        doc.context.obj({
          Names: kept
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .flatMap(([name, spec]) => [PDFHexString.fromText(name), spec]),
        }),
      );
  }
  const af = doc.catalog.lookup(PDFName.of("AF"));
  if (af instanceof PDFArray)
    for (let i = af.size() - 1; i >= 0; i--)
      if (gone.has(doc.context.lookup(af.get(i)) as PDFDict)) af.remove(i);
}

/**
 * Finds the data elsewhere than under the applied areas and, if `remove`,
 * removes it. Returns how many places hold it, by kind.
 */
export async function redactElsewhere(
  doc: PDFDocument,
  needles: Needles,
  areas: Map<PDFPage, Rect[]>,
  fonts: FontCache,
  remove: boolean,
): Promise<ElsewhereCounts> {
  const found = findElsewhere(doc, needles, areas);
  if (!remove) return found.counts;
  for (const [page, dicts] of found.annotations)
    removeAnnotations(doc, page, (dict) => dicts.has(dict));
  if (found.bookmarks.size > 0) removeBookmarks(doc, found.bookmarks);
  if (found.attachments.size > 0) removeAttachments(doc, found.attachments);
  await clearFieldValues(doc, fonts, found.fields);
  const info = infoDict(doc);
  for (const key of found.info) info?.delete(PDFName.of(key));
  if (found.xmp) doc.catalog.delete(PDFName.of("Metadata"));
  return found.counts;
}
