// Spec 005, CA7, CA8, CA11: new annotation types, and changing or removing
// the annotations of the original file (fixture forms-annotations.pdf, page 2).
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { applyEdits } from "../src/engine/applyEdits";
import { readAnnotations, type ExistingAnnot } from "../src/engine/annotRead";
import { textOf } from "../src/engine/formRead";
import type { AnnotationItem, EditorState, Item } from "../src/model/document";
import {
  fixture,
  openPdf,
  qpdfCheck,
  qpdfPath,
  stateFor,
  testDeps,
} from "./helpers";
import { inkShare, renderPage } from "./renderHelpers";

let original: Uint8Array;
let base: EditorState;
let existing: ExistingAnnot[];

beforeAll(async () => {
  original = await fixture("forms-annotations.pdf");
  base = await stateFor(original);
  existing = readAnnotations(await PDFDocument.load(original), 1, "p1");
});

async function save(items: Item[]) {
  const { bytes } = await applyEdits(original, { ...base, items }, testDeps);
  if (qpdfPath) await qpdfCheck(bytes);
  return bytes;
}

/** Annotation dictionaries of page 2 (index 1) of `bytes`. */
async function annotsOf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const annots = doc.getPage(1).node.lookup(PDFName.of("Annots"));
  const dicts =
    annots instanceof PDFArray
      ? annots.asArray().map((a) => doc.context.lookup(a) as PDFDict)
      : [];
  return { doc, dicts };
}

const subtypeOf = (d: PDFDict) => textOf(d.lookup(PDFName.of("Subtype")));
const numbers = (d: PDFDict, key: string) =>
  (d.lookup(PDFName.of(key)) as PDFArray | undefined)
    ?.asArray()
    .map((v) => Number(String(v)));

const annotation = (
  id: string,
  patch: Partial<AnnotationItem> & Pick<AnnotationItem, "shape">,
): AnnotationItem => ({
  kind: "annotation",
  id,
  pageId: "p1",
  color: "#d9480f",
  width: 2,
  ...patch,
});

const line = (i: number) => ({
  x: 56,
  y: 757 - i * 30,
  width: 180,
  height: 15,
});

describe("new annotation types (CA7)", () => {
  it("are saved as standard annotations with their own appearance", async () => {
    const items: Item[] = [
      annotation("u1", { shape: "underline", rects: [line(1)], width: 0 }),
      annotation("s1", { shape: "strikeout", rects: [line(2)], width: 0 }),
      annotation("n1", {
        shape: "note",
        rects: [{ x: 300, y: 700, width: 20, height: 20 }],
        color: "#ffd400",
        text: "Revisar esta línea",
        width: 0,
      }),
      annotation("t1", {
        shape: "freeText",
        rects: [{ x: 300, y: 600, width: 200, height: 50 }],
        color: "#0000ff",
        text: "Un comentario libre con tildes: árbol",
        font: "Times",
        fontSize: 14,
        width: 0,
      }),
      annotation("a1", {
        shape: "arrow",
        paths: [
          [
            { x: 60, y: 300 },
            { x: 200, y: 340 },
          ],
        ],
      }),
      annotation("q1", {
        shape: "square",
        rects: [{ x: 300, y: 250, width: 100, height: 60 }],
        fill: "#2266cc",
      }),
    ];
    const bytes = await save(items);
    const { dicts } = await annotsOf(bytes);
    const byNm = Object.fromEntries(
      dicts.map((d) => [textOf(d.lookup(PDFName.of("NM"))) ?? "", d]),
    );
    expect(subtypeOf(byNm.u1!)).toBe("Underline");
    expect(numbers(byNm.u1!, "QuadPoints")).toHaveLength(8);
    expect(subtypeOf(byNm.s1!)).toBe("StrikeOut");
    expect(subtypeOf(byNm.n1!)).toBe("Text");
    expect(textOf(byNm.n1!.lookup(PDFName.of("Contents")))).toBe(
      "Revisar esta línea",
    );
    expect(subtypeOf(byNm.t1!)).toBe("FreeText");
    expect(textOf(byNm.t1!.lookup(PDFName.of("DA")))).toBe(
      "/TiRo 14 Tf 0 0 1 rg",
    );
    expect(subtypeOf(byNm.a1!)).toBe("Line");
    expect(numbers(byNm.a1!, "L")).toEqual([60, 300, 200, 340]);
    expect(
      (byNm.a1!.lookup(PDFName.of("LE")) as PDFArray).asArray().map(String),
    ).toEqual(["/None", "/OpenArrow"]);
    expect(subtypeOf(byNm.q1!)).toBe("Square");
    expect(numbers(byNm.q1!, "IC")!.map((v) => Math.round(v * 255))).toEqual([
      34, 102, 204,
    ]);
    for (const d of Object.values(byNm))
      if (d.has(PDFName.of("NM"))) expect(d.has(PDFName.of("AP"))).toBe(true);

    // pdf.js reads them, and their appearances are drawn.
    const pdf = await openPdf(bytes);
    const read = await (await pdf.getPage(2)).getAnnotations();
    const note = read.find(
      (a) =>
        a.subtype === "Text" &&
        a.id &&
        a.contentsObj?.str === "Revisar esta línea",
    );
    expect(note).toBeDefined();
    await pdf.loadingTask.destroy();
    const render = await renderPage(bytes, 2);
    expect(
      inkShare(render, { x: 300, y: 700, width: 20, height: 20 }),
    ).toBeGreaterThan(0.3);
    expect(
      inkShare(render, { x: 300, y: 600, width: 200, height: 50 }),
    ).toBeGreaterThan(0.02);
    expect(
      inkShare(render, { x: 300, y: 250, width: 100, height: 60 }),
    ).toBeGreaterThan(0.5);
  });
});

describe("annotations of the original file (CA8)", () => {
  const find = (subtype: string) =>
    existing.find((e) => e.subtype === subtype)!;

  it("are read with their geometry, colors and text", () => {
    expect(existing.map((e) => e.subtype)).toEqual([
      "Highlight",
      "Text",
      "FreeText",
      "Ink",
      "Square",
      "Circle",
      "Stamp",
    ]);
    expect(find("Highlight").item).toMatchObject({
      shape: "highlight",
      color: "#ffe600",
    });
    expect(find("Text").item).toMatchObject({
      shape: "note",
      text: "nota existente",
    });
    expect(find("FreeText").item).toMatchObject({
      shape: "freeText",
      text: "texto libre existente",
      fontSize: 12,
      color: "#0000ff",
    });
    expect(find("Ink").item!.paths![0]).toHaveLength(5);
    expect(find("Square").item!.rects![0]).toEqual({
      x: 57,
      y: 421,
      width: 142,
      height: 78,
    });
    expect(find("Stamp").item).toBeNull();
    expect(find("Text").author).toBe("Generador");
  });

  it("a change rewrites the annotation in place and keeps its other entries", async () => {
    const highlight = find("Highlight").item!;
    const note = find("Text").item!;
    const bytes = await save([
      { ...highlight, color: "#00ff00" },
      {
        ...note,
        text: "nota cambiada",
        rects: [{ ...note.rects![0]!, x: 400 }],
      },
    ]);
    const { dicts } = await annotsOf(bytes);
    const highlights = dicts.filter((d) => subtypeOf(d) === "Highlight");
    expect(highlights).toHaveLength(1);
    expect(numbers(highlights[0]!, "C")).toEqual([0, 1, 0]);
    expect(textOf(highlights[0]!.lookup(PDFName.of("T")))).toBe("Generador");
    expect(textOf(highlights[0]!.lookup(PDFName.of("CreationDate")))).toBe(
      "D:20260101000000Z",
    );
    const notes = dicts.filter((d) => subtypeOf(d) === "Text");
    expect(notes).toHaveLength(1);
    expect(textOf(notes[0]!.lookup(PDFName.of("Contents")))).toBe(
      "nota cambiada",
    );
    expect(numbers(notes[0]!, "Rect")![0]).toBe(400);
    // Its popup still points to it.
    const popup = notes[0]!.lookup(PDFName.of("Popup")) as PDFDict;
    expect(popup.get(PDFName.of("Parent"))).toEqual(
      dicts.find((d) => d === notes[0]) &&
        notes[0]!.context.getObjectRef(notes[0]!),
    );
    expect(dicts).toHaveLength(8);
  });

  it("a removal takes it and its popup out of the file", async () => {
    const remove = (source: string): Item => ({
      kind: "annotRemoval",
      id: `r-${source}`,
      pageId: "p1",
      source,
    });
    const bytes = await save([
      remove(find("Text").source),
      remove(find("Stamp").source),
    ]);
    const { doc, dicts } = await annotsOf(bytes);
    expect(dicts.map(subtypeOf)).toEqual([
      "Highlight",
      "FreeText",
      "Ink",
      "Square",
      "Circle",
    ]);
    // Nothing of the note's text is left in any object.
    for (const [, object] of doc.context.enumerateIndirectObjects())
      if (object instanceof PDFDict) {
        expect(textOf(object.lookup(PDFName.of("Contents")))).not.toBe(
          "nota existente",
        );
        expect(textOf(object.lookup(PDFName.of("Subtype")))).not.toBe("Popup");
      }
    const ref = PDFRef.of(Number(find("Text").source.split(" ")[0]), 0);
    expect(doc.context.lookup(ref)).toBeUndefined();
  });
});
