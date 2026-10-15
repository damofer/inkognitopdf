import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObjectCopier,
  PDFPage,
  PDFRef,
  PDFString,
  type PDFObject,
} from "pdf-lib";
import { BRAND } from "../brand";
import { t } from "../i18n";
import { OrganizeError } from "./pageRanges";
import { cleanFile } from "./redact";

/**
 * Merging and splitting (spec 013). Pages keep what makes them work in their
 * new file: links and bookmarks point to the same pages, form fields keep
 * their values (renamed when two files share a name), and nothing of a page
 * that is not in the file stays in it.
 */

export { OrganizeError };

const MAX_DEPTH = 64;

const name = (key: string) => PDFName.of(key);

function textOf(obj: PDFObject | undefined): string | null {
  if (obj instanceof PDFString || obj instanceof PDFHexString)
    return obj.decodeText();
  if (obj instanceof PDFName) return obj.decodeText();
  return null;
}

/** Value of `key` in a name tree (ISO 32000-1 §7.9.6). */
function lookupNameTree(
  doc: PDFDocument,
  node: PDFObject | undefined,
  key: string,
  depth = 0,
): PDFObject | undefined {
  const dict = node === undefined ? undefined : doc.context.lookup(node);
  if (!(dict instanceof PDFDict) || depth > MAX_DEPTH) return undefined;
  const names = dict.lookup(name("Names"));
  if (names instanceof PDFArray)
    for (let i = 0; i + 1 < names.size(); i += 2)
      if (textOf(doc.context.lookup(names.get(i))) === key)
        return names.get(i + 1);
  const kids = dict.lookup(name("Kids"));
  if (kids instanceof PDFArray)
    for (const kid of kids.asArray()) {
      const found = lookupNameTree(doc, kid, key, depth + 1);
      if (found !== undefined) return found;
    }
  return undefined;
}

export interface Destination {
  page: PDFRef;
  /** The rest of the explicit destination (/XYZ left top zoom, /Fit…). */
  rest: PDFObject[];
}

/**
 * The page and view of a destination: an explicit array, a name (catalog
 * /Dests or the /Names /Dests tree) or a GoTo action.
 */
export function resolveDest(
  doc: PDFDocument,
  dest: PDFObject | undefined,
  depth = 0,
): Destination | null {
  if (dest === undefined || depth > 4) return null;
  const value = doc.context.lookup(dest);
  if (value instanceof PDFArray && value.size() > 0) {
    const page = value.get(0);
    if (!(page instanceof PDFRef)) return null;
    return { page, rest: value.asArray().slice(1) };
  }
  if (value instanceof PDFDict) {
    // A GoTo action, or a dictionary destination { D: [...] }.
    const s = value.lookup(name("S"));
    if (s !== undefined && s !== name("GoTo")) return null;
    return resolveDest(doc, value.get(name("D")), depth + 1);
  }
  const key = textOf(value);
  if (key === null) return null;
  const catalogDests = doc.catalog.lookup(name("Dests"));
  if (catalogDests instanceof PDFDict) {
    const found = catalogDests.get(name(key));
    if (found) return resolveDest(doc, found, depth + 1);
  }
  const names = doc.catalog.lookup(name("Names"));
  if (names instanceof PDFDict) {
    const found = lookupNameTree(doc, names.get(name("Dests")), key);
    if (found) return resolveDest(doc, found, depth + 1);
  }
  return null;
}

/** The destination of a link annotation or a bookmark. */
function destOf(doc: PDFDocument, dict: PDFDict) {
  if (dict.has(name("Dest"))) return resolveDest(doc, dict.get(name("Dest")));
  const action = dict.lookup(name("A"));
  if (action instanceof PDFDict && action.lookup(name("S")) === name("GoTo"))
    return resolveDest(doc, action.get(name("D")));
  return null;
}

/** Whether a link or bookmark goes to a place in this file. */
function hasLocalDest(dict: PDFDict) {
  if (dict.has(name("Dest"))) return true;
  const action = dict.lookup(name("A"));
  return action instanceof PDFDict && action.lookup(name("S")) === name("GoTo");
}

const pageIndexes = (doc: PDFDocument) =>
  new Map(doc.getPages().map((p, i) => [p.ref, i] as const));

interface Bookmark {
  title: PDFObject;
  /** Page index in its own document, and the view. */
  dest: { index: number; rest: PDFObject[] } | null;
  color?: PDFObject;
  flags?: PDFObject;
  open: boolean;
  children: Bookmark[];
}

/** The bookmarks of a document, with destinations as page indexes. */
const readBookmarks = (doc: PDFDocument) =>
  readBookmarksAt(doc, pageIndexes(doc));

/** Drops bookmarks to pages that are not there (keeping their children). */
function keepBookmarks(
  items: Bookmark[],
  page: (index: number) => PDFRef | undefined,
): Bookmark[] {
  return items.flatMap((item) => {
    const children = keepBookmarks(item.children, page);
    const ok = item.dest && page(item.dest.index) !== undefined;
    if (!ok && children.length === 0) return [];
    return [{ ...item, dest: ok ? item.dest : null, children }];
  });
}

/** Writes the bookmarks as the document outline, replacing the old one. */
function writeBookmarks(
  doc: PDFDocument,
  items: Bookmark[],
  page: (index: number) => PDFRef | undefined,
) {
  const ctx = doc.context;
  if (items.length === 0) {
    doc.catalog.delete(name("Outlines"));
    return;
  }
  const root = ctx.obj({ Type: "Outlines" });
  const rootRef = ctx.register(root);
  /** Writes `list` under `parent`; returns how many items are visible. */
  const write = (list: Bookmark[], parent: PDFDict, parentRef: PDFRef) => {
    const refs = list.map(() => ctx.nextRef());
    let visible = 0;
    list.forEach((item, i) => {
      const dict = ctx.obj({});
      dict.set(name("Title"), item.title);
      dict.set(name("Parent"), parentRef);
      if (i > 0) dict.set(name("Prev"), refs[i - 1]!);
      if (i < list.length - 1) dict.set(name("Next"), refs[i + 1]!);
      if (item.color) dict.set(name("C"), item.color);
      if (item.flags) dict.set(name("F"), item.flags);
      const target = item.dest ? page(item.dest.index) : undefined;
      if (target && item.dest)
        dict.set(name("Dest"), ctx.obj([target, ...item.dest.rest]));
      ctx.assign(refs[i]!, dict);
      visible++;
      if (item.children.length > 0) {
        const below = write(item.children, dict, refs[i]!);
        dict.set(
          name("Count"),
          ctx.obj(item.open ? below : -item.children.length),
        );
        if (item.open) visible += below;
      }
    });
    parent.set(name("First"), refs[0]!);
    parent.set(name("Last"), refs[refs.length - 1]!);
    return visible;
  };
  root.set(name("Count"), ctx.obj(write(items, root, rootRef)));
  doc.catalog.set(name("Outlines"), rootRef);
}

/** Fully qualified names of the fields of a document. */
function fieldNames(doc: PDFDocument): Set<string> {
  const names = new Set<string>();
  const form = doc.catalog.lookup(name("AcroForm"));
  if (!(form instanceof PDFDict)) return names;
  const walk = (node: PDFObject, prefix: string, depth: number) => {
    const dict = doc.context.lookup(node);
    if (!(dict instanceof PDFDict) || depth > MAX_DEPTH) return;
    const own = textOf(dict.lookup(name("T")));
    const full = own === null ? prefix : prefix ? `${prefix}.${own}` : own;
    if (full) names.add(full);
    const kids = dict.lookup(name("Kids"));
    if (kids instanceof PDFArray)
      for (const kid of kids.asArray()) walk(kid, full, depth + 1);
  };
  const fields = form.lookup(name("Fields"));
  if (fields instanceof PDFArray)
    for (const f of fields.asArray()) walk(f, "", 0);
  return names;
}

/** The form of the document, created if needed. */
function acroForm(doc: PDFDocument): PDFDict {
  let form = doc.catalog.lookup(name("AcroForm"));
  if (!(form instanceof PDFDict)) {
    form = doc.context.obj({ Fields: [] });
    doc.catalog.set(name("AcroForm"), doc.context.register(form as PDFDict));
  }
  const dict = form as PDFDict;
  if (!(dict.lookup(name("Fields")) instanceof PDFArray))
    dict.set(name("Fields"), doc.context.obj([]));
  return dict;
}

interface LinkFix {
  page: number;
  annot: number;
  target: number;
  rest: PDFObject[];
}

/**
 * Prepares a document to be copied: link destinations become page indexes
 * (returned) and annotations lose their /P, so copying a page never copies
 * another page through them.
 */
function detachForCopy(doc: PDFDocument): LinkFix[] {
  const indexes = pageIndexes(doc);
  const fixes: LinkFix[] = [];
  doc.getPages().forEach((page, p) => {
    const annots = page.node.lookup(name("Annots"));
    if (!(annots instanceof PDFArray)) return;
    annots.asArray().forEach((entry, a) => {
      const annot = doc.context.lookup(entry);
      if (!(annot instanceof PDFDict)) return;
      annot.delete(name("P"));
      if (!hasLocalDest(annot)) return;
      const dest = destOf(doc, annot);
      const target = dest ? indexes.get(dest.page) : undefined;
      annot.delete(name("Dest"));
      annot.delete(name("A"));
      if (target !== undefined)
        fixes.push({ page: p, annot: a, target, rest: dest!.rest });
    });
  });
  return fixes;
}

export interface Appended {
  /** Index of the first added page in the result. */
  start: number;
  count: number;
}

/**
 * Adds every page of `others` at the end of `base` (an empty `base` starts a
 * new document). Object numbers of the base do not change.
 */
export async function appendPdfs(
  base: Uint8Array,
  others: { name: string; bytes: Uint8Array }[],
): Promise<{ bytes: Uint8Array; added: Appended[] }> {
  const doc =
    base.length === 0
      ? await PDFDocument.create({ updateMetadata: false })
      : await PDFDocument.load(base.slice(), { updateMetadata: false });
  if (base.length === 0) {
    doc.setProducer(BRAND);
    doc.setCreator(BRAND);
  }
  const added: Appended[] = [];
  let bookmarks = readBookmarks(doc);
  const basePages = doc.getPages().map((p) => p.ref);
  const pageRefs = [...basePages];
  const taken = fieldNames(doc);

  for (const other of others) {
    let src: PDFDocument;
    try {
      src = await PDFDocument.load(other.bytes.slice(), {
        updateMetadata: false,
      });
    } catch (cause) {
      if (cause instanceof Error && /encrypt/i.test(cause.message))
        throw new OrganizeError(t("organize.encrypted", other.name));
      throw new OrganizeError(t("organize.unreadable", other.name));
    }
    const fixes = detachForCopy(src);
    const marks = readBookmarks(src);
    const copier = PDFObjectCopier.for(src.context, doc.context);
    const start = doc.getPageCount();
    const copied = src.getPages().map((page) => {
      const leaf = copier.copy(page.node);
      const ref = doc.context.register(leaf);
      const added = PDFPage.of(leaf, ref, doc);
      doc.addPage(added);
      return added;
    });
    for (const p of copied) pageRefs.push(p.ref);
    added.push({ start, count: copied.length });

    // Links to the same pages, now in this document.
    for (const fix of fixes) {
      const annots = copied[fix.page]!.node.lookup(name("Annots"));
      const annot =
        annots instanceof PDFArray
          ? doc.context.lookup(annots.get(fix.annot))
          : undefined;
      if (annot instanceof PDFDict)
        annot.set(
          name("Dest"),
          doc.context.obj([copied[fix.target]!.ref, ...fix.rest]),
        );
    }
    for (const page of copied) {
      const annots = page.node.lookup(name("Annots"));
      if (annots instanceof PDFArray)
        for (const entry of annots.asArray()) {
          const annot = doc.context.lookup(entry);
          if (annot instanceof PDFDict) annot.set(name("P"), page.ref);
        }
    }

    // Fields: the roots of the widgets on the added pages.
    const srcForm = src.catalog.lookup(name("AcroForm"));
    const roots: PDFDict[] = [];
    for (const page of copied) {
      const annots = page.node.lookup(name("Annots"));
      if (!(annots instanceof PDFArray)) continue;
      for (const entry of annots.asArray()) {
        const widget = doc.context.lookup(entry);
        if (
          !(widget instanceof PDFDict) ||
          widget.lookup(name("Subtype")) !== name("Widget")
        )
          continue;
        let node: PDFDict = widget;
        for (let d = 0; d < MAX_DEPTH; d++) {
          const parent: PDFObject | undefined = node.lookup(name("Parent"));
          if (!(parent instanceof PDFDict)) break;
          node = parent;
        }
        if (!roots.includes(node)) roots.push(node);
      }
    }
    if (roots.length > 0) {
      const form = acroForm(doc);
      const fields = form.lookup(name("Fields"), PDFArray);
      const own = new Set<string>();
      for (const root of roots) {
        const title = textOf(root.lookup(name("T")));
        if (title !== null) {
          let unique = title;
          for (let n = 2; taken.has(unique) || own.has(unique); n++)
            unique = `${title}_${n}`;
          if (unique !== title)
            root.set(name("T"), PDFHexString.fromText(unique));
          own.add(unique);
        }
        fields.push(doc.context.getObjectRef(root) ?? root);
      }
      for (const n of own) taken.add(n);
      // Fonts of the default appearances.
      if (srcForm instanceof PDFDict) {
        const dr = srcForm.lookup(name("DR"));
        if (dr instanceof PDFDict) {
          const copiedDr = copier.copy(dr);
          let mine = form.lookup(name("DR"));
          if (!(mine instanceof PDFDict)) {
            mine = doc.context.obj({});
            form.set(name("DR"), mine as PDFDict);
          }
          for (const [key, value] of copiedDr.entries()) {
            const into = (mine as PDFDict).lookup(key);
            const from = doc.context.lookup(value);
            if (into instanceof PDFDict && from instanceof PDFDict) {
              for (const [k, v] of from.entries())
                if (!into.has(k)) into.set(k, v);
            } else if (!(mine as PDFDict).has(key))
              (mine as PDFDict).set(key, value);
          }
        }
        if (!form.has(name("DA")) && srcForm.has(name("DA")))
          form.set(name("DA"), srcForm.get(name("DA"))!);
        const need = srcForm.get(name("NeedAppearances"));
        if (need?.toString() === "true")
          form.set(name("NeedAppearances"), need);
      }
    }

    // Its bookmarks, under one with the name of the file.
    if (marks.length > 0 || bookmarks.length > 0) {
      const shift = (items: Bookmark[]): Bookmark[] =>
        items.map((item) => ({
          ...item,
          dest: item.dest
            ? { index: item.dest.index + start, rest: item.dest.rest }
            : null,
          children: shift(item.children),
        }));
      bookmarks = [
        ...bookmarks,
        {
          title: PDFHexString.fromText(other.name.replace(/\.pdf$/i, "")),
          dest: { index: start, rest: [name("Fit")] },
          open: false,
          children: shift(marks),
        },
      ];
    }
  }

  if (others.length > 0 && bookmarks.length > 0)
    writeBookmarks(doc, bookmarks, (i) => pageRefs[i]);
  return { bytes: await doc.save(), added };
}

/** Removes the widgets of pages that are not in the document, and empty fields. */
function keepFields(doc: PDFDocument, widgets: Set<PDFObject>) {
  const form = doc.catalog.lookup(name("AcroForm"));
  if (!(form instanceof PDFDict)) return;
  /** Whether the field still has a widget on a page. */
  const prune = (node: PDFObject, depth: number): boolean => {
    const dict = doc.context.lookup(node);
    if (!(dict instanceof PDFDict) || depth > MAX_DEPTH) return false;
    const kids = dict.lookup(name("Kids"));
    if (kids instanceof PDFArray) {
      for (let i = kids.size() - 1; i >= 0; i--)
        if (!prune(kids.get(i), depth + 1)) kids.remove(i);
      return kids.size() > 0;
    }
    return widgets.has(node) || widgets.has(dict);
  };
  for (const key of ["Fields", "CO"]) {
    const list = form.lookup(name(key));
    if (!(list instanceof PDFArray)) continue;
    for (let i = list.size() - 1; i >= 0; i--)
      if (key === "Fields" ? !prune(list.get(i), 0) : !hasWidget(list.get(i)))
        list.remove(i);
  }
  function hasWidget(node: PDFObject): boolean {
    const dict = doc.context.lookup(node);
    if (!(dict instanceof PDFDict)) return false;
    if (widgets.has(node) || widgets.has(dict)) return true;
    const kids = dict.lookup(name("Kids"));
    return kids instanceof PDFArray && kids.asArray().some(hasWidget);
  }
}

/**
 * After pages left the page tree: links and bookmarks to them lose their
 * destination, named destinations become explicit, and the form, structure,
 * articles and page labels no longer refer to them.
 */
export function detachRemovedPages(doc: PDFDocument, originalPages: PDFRef[]) {
  const kept = doc.getPages();
  const keptRefs = new Set<PDFObject>(kept.map((p) => p.ref));
  const indexOf = new Map(originalPages.map((r, i) => [r, i] as const));

  // Bookmarks, read against the original page order.
  const outline = doc.catalog.lookup(name("Outlines"));
  if (outline instanceof PDFDict) {
    const marks = readBookmarksAt(doc, indexOf);
    const page = (i: number) => {
      const ref = originalPages[i];
      return ref && keptRefs.has(ref) ? ref : undefined;
    };
    writeBookmarks(doc, keepBookmarks(marks, page), page);
  }

  const widgets = new Set<PDFObject>();
  for (const page of kept) {
    const annots = page.node.lookup(name("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const entry = annots.get(i);
      const annot = doc.context.lookup(entry);
      if (!(annot instanceof PDFDict)) continue;
      if (annot.lookup(name("Subtype")) === name("Widget")) {
        widgets.add(entry);
        widgets.add(annot);
      }
      annot.set(name("P"), page.ref);
      if (!hasLocalDest(annot)) continue;
      const dest = destOf(doc, annot);
      annot.delete(name("A"));
      if (dest && keptRefs.has(dest.page))
        annot.set(name("Dest"), doc.context.obj([dest.page, ...dest.rest]));
      else annot.delete(name("Dest"));
    }
  }
  keepFields(doc, widgets);

  const open = doc.catalog.get(name("OpenAction"));
  if (open) {
    const value = doc.context.lookup(open);
    const local =
      value instanceof PDFArray ||
      (value instanceof PDFDict && value.lookup(name("S")) === name("GoTo"));
    const dest = local ? resolveDest(doc, open) : null;
    if (local && (!dest || !keptRefs.has(dest.page)))
      doc.catalog.delete(name("OpenAction"));
    else if (dest)
      doc.catalog.set(
        name("OpenAction"),
        doc.context.obj([dest.page, ...dest.rest]),
      );
  }
  doc.catalog.delete(name("Dests"));
  const names = doc.catalog.lookup(name("Names"));
  if (names instanceof PDFDict) names.delete(name("Dests"));
  for (const key of ["StructTreeRoot", "MarkInfo", "Threads", "PageLabels"])
    doc.catalog.delete(name(key));
  for (const page of kept) {
    page.node.delete(name("StructParents"));
    page.node.delete(name("B"));
  }
}

/** Bookmarks with destinations as indexes of `indexOf` (the original order). */
function readBookmarksAt(
  doc: PDFDocument,
  indexOf: Map<PDFRef, number>,
): Bookmark[] {
  const outlines = doc.catalog.lookup(name("Outlines"));
  if (!(outlines instanceof PDFDict)) return [];
  const seen = new Set<PDFObject>();
  const read = (first: PDFObject | undefined, depth: number): Bookmark[] => {
    const items: Bookmark[] = [];
    let ref = first;
    while (ref !== undefined && !seen.has(ref) && depth < MAX_DEPTH) {
      seen.add(ref);
      const item = doc.context.lookup(ref);
      if (!(item instanceof PDFDict)) break;
      const dest = destOf(doc, item);
      const index = dest ? indexOf.get(dest.page) : undefined;
      const count = item.lookup(name("Count"));
      items.push({
        title: item.get(name("Title")) ?? PDFHexString.fromText(""),
        dest: index === undefined ? null : { index, rest: dest!.rest },
        color: item.get(name("C")),
        flags: item.get(name("F")),
        open: count instanceof PDFNumber && count.asNumber() > 0,
        children: read(item.get(name("First")), depth + 1),
      });
      ref = item.get(name("Next"));
    }
    return items;
  };
  return read(outlines.get(name("First")), 0);
}

/**
 * One file per group of page indexes (0-based, in the order given), each
 * with only its pages, their fields, links and bookmarks.
 */
export async function splitPdf(
  bytes: Uint8Array,
  groups: number[][],
): Promise<Uint8Array[]> {
  const parts: Uint8Array[] = [];
  for (const group of groups) {
    const doc = await PDFDocument.load(bytes.slice(), {
      updateMetadata: false,
    });
    const pages = doc.getPages();
    const originals = pages.map((p) => p.ref);
    for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
    group.forEach((index, k) => doc.insertPage(k, pages[index]!));
    detachRemovedPages(doc, originals);
    parts.push(await cleanFile(await doc.save(), { clearMetadata: false }));
  }
  return parts;
}
