// Spec 013: merging and splitting keep links, bookmarks and fields, and a
// file never carries the pages it does not show.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFObject,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/engine/applyEdits";
import { appendPdfs, splitPdf } from "../src/engine/organize";
import { describeGroup, everyN, parseRanges } from "../src/engine/pageRanges";
import {
  fileContains,
  openPdf,
  pageText,
  qpdfCheck,
  qpdfPath,
  stateFor,
  testDeps,
} from "./helpers";

interface Spec {
  pages: string[];
  /** Bookmarks: title and page index. */
  marks?: [string, number][];
  /** A link on page `from` to page `to`, explicit or by name. */
  links?: { from: number; to: number; named?: boolean }[];
  /** A text field on a page. */
  fields?: { page: number; name: string; value: string }[];
}

async function makePdf(spec: Spec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = spec.pages.map((text) => {
    const page = doc.addPage([300, 300]);
    page.drawText(text, { x: 40, y: 250, size: 14, font });
    return page;
  });
  const ctx = doc.context;
  if (spec.marks?.length) {
    const root = ctx.obj({ Type: "Outlines", Count: spec.marks.length });
    const rootRef = ctx.register(root);
    const refs = spec.marks.map(() => ctx.nextRef());
    spec.marks.forEach(([title, page], i) => {
      const item = ctx.obj({
        Title: PDFHexString.fromText(title),
        Parent: rootRef,
        Dest: [pages[page]!.ref, "Fit"],
      });
      if (i > 0) item.set(PDFName.of("Prev"), refs[i - 1]!);
      if (i < refs.length - 1) item.set(PDFName.of("Next"), refs[i + 1]!);
      ctx.assign(refs[i]!, item);
    });
    root.set(PDFName.of("First"), refs[0]!);
    root.set(PDFName.of("Last"), refs[refs.length - 1]!);
    doc.catalog.set(PDFName.of("Outlines"), rootRef);
  }
  const named: PDFObject[] = [];
  for (const [k, link] of (spec.links ?? []).entries()) {
    const dest = ctx.obj([pages[link.to]!.ref, "XYZ", 0, 300, 0]);
    if (link.named) named.push(PDFString.of(`d${k}`), dest);
    pages[link.from]!.node.addAnnot(
      ctx.register(
        ctx.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [40, 40, 120, 60],
          Dest: link.named ? PDFString.of(`d${k}`) : dest,
        }),
      ),
    );
  }
  if (named.length)
    doc.catalog.set(
      PDFName.of("Names"),
      ctx.obj({ Dests: ctx.register(ctx.obj({ Names: named })) }),
    );
  const form = doc.getForm();
  for (const f of spec.fields ?? []) {
    const field = form.createTextField(f.name);
    field.setText(f.value);
    field.addToPage(pages[f.page]!, { x: 40, y: 100, width: 150, height: 20 });
  }
  return doc.save();
}

async function outline(bytes: Uint8Array) {
  const doc = await openPdf(bytes);
  const read = async (
    items: { title: string; dest: unknown; items: unknown[] }[] | null,
  ): Promise<unknown[]> =>
    Promise.all(
      (items ?? []).map(async (item) => {
        const dest = Array.isArray(item.dest)
          ? await doc.getPageIndex(item.dest[0] as { num: number; gen: number })
          : null;
        const children = await read(item.items as typeof items);
        return children.length
          ? [item.title, dest, children]
          : [item.title, dest];
      }),
    );
  const result = await read(
    (await doc.getOutline()) as Parameters<typeof read>[0],
  );
  await doc.loadingTask.destroy();
  return result;
}

/** Page index each link of a page goes to (null: no longer a link). */
async function links(bytes: Uint8Array, pageNumber: number) {
  const doc = await openPdf(bytes);
  const page = await doc.getPage(pageNumber);
  const annots = (await page.getAnnotations()) as {
    subtype: string;
    dest?: unknown;
  }[];
  const out: (number | null)[] = [];
  for (const a of annots.filter((x) => x.subtype === "Link")) {
    let dest = a.dest;
    if (typeof dest === "string") dest = await doc.getDestination(dest);
    out.push(
      Array.isArray(dest)
        ? await doc.getPageIndex(dest[0] as { num: number; gen: number })
        : null,
    );
  }
  await doc.loadingTask.destroy();
  return out;
}

async function fields(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc
    .getForm()
    .getFields()
    .map((f) => [
      f.getName(),
      doc.getForm().getTextField(f.getName()).getText(),
    ]);
}

describe("merging (spec 013)", () => {
  it("appends the pages with their links, bookmarks and fields", async () => {
    const a = await makePdf({
      pages: ["A uno", "A dos"],
      marks: [["Capitulo A", 1]],
      links: [{ from: 0, to: 1 }],
      fields: [{ page: 0, name: "nombre", value: "Ana" }],
    });
    const b = await makePdf({
      pages: ["B uno", "B dos", "B tres"],
      marks: [["Seccion B", 2]],
      links: [{ from: 0, to: 2, named: true }],
      fields: [{ page: 1, name: "nombre", value: "Beto" }],
    });
    const { bytes, added } = await appendPdfs(a, [{ name: "b.pdf", bytes: b }]);
    expect(added).toEqual([{ start: 2, count: 3 }]);
    if (qpdfPath) await qpdfCheck(bytes);
    const texts = [];
    for (let i = 1; i <= 5; i++) texts.push(await pageText(bytes, i));
    expect(texts).toEqual(["A uno", "A dos", "B uno", "B dos", "B tres"]);
    expect(await links(bytes, 1)).toEqual([1]);
    expect(await links(bytes, 3)).toEqual([4]);
    expect(await outline(bytes)).toEqual([
      ["Capitulo A", 1],
      ["b", 2, [["Seccion B", 4]]],
    ]);
    expect(await fields(bytes)).toEqual([
      ["nombre", "Ana"],
      ["nombre_2", "Beto"],
    ]);
  });

  it("keeps the object numbers of the base", async () => {
    const a = await makePdf({ pages: ["A"], links: [{ from: 0, to: 0 }] });
    const b = await makePdf({ pages: ["B"] });
    const before = await PDFDocument.load(a);
    const annot = before.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    const ref = annot.get(0) as PDFRef;
    const { bytes } = await appendPdfs(a, [{ name: "b.pdf", bytes: b }]);
    const after = await PDFDocument.load(bytes);
    const same = after.context.lookup(ref);
    expect(same).toBeInstanceOf(PDFDict);
    expect((same as PDFDict).lookup(PDFName.of("Subtype"))).toBe(
      PDFName.of("Link"),
    );
  });

  it("starts a new document from nothing", async () => {
    const b = await makePdf({ pages: ["B uno", "B dos"] });
    const c = await makePdf({ pages: ["C uno"] });
    const { bytes, added } = await appendPdfs(new Uint8Array(), [
      { name: "b.pdf", bytes: b },
      { name: "c.pdf", bytes: c },
    ]);
    expect(added).toEqual([
      { start: 0, count: 2 },
      { start: 2, count: 1 },
    ]);
    expect(await pageText(bytes, 3)).toBe("C uno");
  });
});

describe("splitting (spec 013)", () => {
  const source = () =>
    makePdf({
      pages: [
        "Pagina 1 sec-111",
        "Pagina 2 sec-222",
        "Pagina 3 sec-333",
        "Pagina 4 sec-444",
      ],
      marks: [
        ["Uno", 0],
        ["Tres", 2],
        ["Cuatro", 3],
      ],
      links: [
        { from: 0, to: 1 },
        { from: 1, to: 3, named: true },
      ],
      fields: [
        { page: 1, name: "dos", value: "val-222" },
        { page: 2, name: "tres", value: "val-333" },
      ],
    });

  it("each part has only its pages, fields, links and bookmarks", async () => {
    const [first, second] = await splitPdf(await source(), [
      [0, 1],
      [2, 3],
    ]);
    if (qpdfPath) {
      await qpdfCheck(first!);
      await qpdfCheck(second!);
    }
    expect(await pageText(first!, 1)).toBe("Pagina 1 sec-111");
    expect(await pageText(first!, 2)).toBe("Pagina 2 sec-222");
    expect((await openPdf(first!)).numPages).toBe(2);
    for (const other of ["sec-333", "sec-444", "val-333"])
      expect(await fileContains(first!, other)).toBe(false);
    for (const other of ["sec-111", "sec-222", "val-222"])
      expect(await fileContains(second!, other)).toBe(false);
    expect(await fields(first!)).toEqual([["dos", "val-222"]]);
    expect(await fields(second!)).toEqual([["tres", "val-333"]]);
    // The link to page 2 stays; the one to page 4 (in the other part) goes.
    expect(await links(first!, 1)).toEqual([1]);
    expect(await links(first!, 2)).toEqual([null]);
    expect(await outline(first!)).toEqual([["Uno", 0]]);
    expect(await outline(second!)).toEqual([
      ["Tres", 0],
      ["Cuatro", 1],
    ]);
  });

  it("extracts pages in the order given", async () => {
    const [part] = await splitPdf(await source(), [[3, 0]]);
    expect(await pageText(part!, 1)).toBe("Pagina 4 sec-444");
    expect(await pageText(part!, 2)).toBe("Pagina 1 sec-111");
    expect(await fileContains(part!, "sec-222")).toBe(false);
  });

  it("a page deleted in the editor leaves the saved file", async () => {
    const bytes = await source();
    const state = await stateFor(bytes);
    const { bytes: out } = await applyEdits(
      bytes,
      { ...state, pages: state.pages.filter((_, i) => i !== 2) },
      testDeps,
    );
    expect((await openPdf(out)).numPages).toBe(3);
    expect(await fileContains(out, "sec-333")).toBe(false);
    expect(await fileContains(out, "val-333")).toBe(false);
    expect(await fields(out)).toEqual([["dos", "val-222"]]);
    expect(await outline(out)).toEqual([
      ["Uno", 0],
      ["Cuatro", 2],
    ]);
  });
});

describe("page ranges (spec 013)", () => {
  it("parses ranges, open ends and single pages", () => {
    expect(parseRanges("1-3, 5; 7-", 9)).toEqual([[0, 1, 2], [4], [6, 7, 8]]);
    expect(parseRanges(" -2 ", 5)).toEqual([[0, 1]]);
  });

  it("rejects what is not a range", () => {
    expect(() => parseRanges("a-b", 5)).toThrow(/no es un rango/);
    expect(() => parseRanges("4-9", 5)).toThrow(/entre 1 y 5/);
    expect(() => parseRanges("3-1", 5)).toThrow(/entre 1 y 5/);
    expect(() => parseRanges(" , ", 5)).toThrow(/al menos un rango/);
  });

  it("groups every N pages and describes groups", () => {
    expect(everyN(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
    expect(() => everyN(5, 0)).toThrow();
    expect(describeGroup([0, 1, 2, 4, 6, 7])).toBe("1-3, 5, 7-8");
  });
});
