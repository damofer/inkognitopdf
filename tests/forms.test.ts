// Spec 005, CA1–CA3, CA5, CA6, CA10, CA11: filling, creating and flattening
// AcroForm fields with the synthetic fixture forms-annotations.pdf.
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
} from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { applyEdits, type SaveOptions } from "../src/engine/applyEdits";
import { autoSize, metricsOf, wrapText } from "../src/engine/formAppearance";
import { rawFields, readFields, type FieldInfo } from "../src/engine/formRead";
import type {
  EditorState,
  FormFieldItem,
  FormValueItem,
  Item,
} from "../src/model/document";
import {
  fixture,
  openPdf,
  qpdfCheck,
  qpdfPath,
  stateFor,
  testDeps,
} from "./helpers";
import { renderPage, type Rendered } from "./renderHelpers";

let original: Uint8Array;
let base: EditorState;
let originalFields: FieldInfo[];

beforeAll(async () => {
  original = await fixture("forms-annotations.pdf");
  base = await stateFor(original);
  originalFields = readFields(await PDFDocument.load(original));
});

const value = (name: string, v: string | string[], i = 0): FormValueItem => ({
  kind: "formValue",
  id: `v-${name}-${i}`,
  pageId: "p0",
  name,
  value: v,
});

async function save(items: Item[], options: SaveOptions = {}) {
  const { bytes } = await applyEdits(
    original,
    { ...base, items },
    testDeps,
    options,
  );
  if (qpdfPath) await qpdfCheck(bytes);
  return bytes;
}

function streamText(doc: PDFDocument, stream: unknown): string {
  const s = stream instanceof PDFRef ? doc.context.lookup(stream) : stream;
  if (s instanceof PDFRawStream)
    return new TextDecoder("latin1").decode(decodePDFRawStream(s).decode());
  if (s instanceof PDFStream)
    return new TextDecoder("latin1").decode(s.getContents());
  return "";
}

/** Widget dictionary of the first widget of field `name`. */
function widgetOf(doc: PDFDocument, name: string): PDFDict {
  const info = readFields(doc).find((f) => f.name === name)!;
  const ref = info.widgets[0]!.ref;
  const [num, gen] = ref.split(" ").map(Number);
  return doc.context.lookup(PDFRef.of(num!, gen!)) as PDFDict;
}

function normalAppearance(doc: PDFDocument, widget: PDFDict) {
  const ap = widget.lookup(PDFName.of("AP"), PDFDict);
  const ref = ap.get(PDFName.of("N"));
  const stream = doc.context.lookup(ref) as PDFStream;
  const resources = stream.dict.lookup(PDFName.of("Resources"));
  const fonts =
    resources instanceof PDFDict
      ? resources.lookup(PDFName.of("Font"))
      : undefined;
  const f0 =
    fonts instanceof PDFDict ? fonts.lookup(PDFName.of("F0")) : undefined;
  const base =
    f0 instanceof PDFDict ? f0.lookup(PDFName.of("BaseFont")) : undefined;
  return {
    content: streamText(doc, ref),
    baseFont: base instanceof PDFName ? base.decodeText() : "",
  };
}

/** Share of pixels in `area` close to `rgb` (0–255). */
function colorShare(
  r: Rendered,
  area: { x: number; y: number; width: number; height: number },
  rgb: [number, number, number],
) {
  const a = r.toPixel(area.x, area.y + area.height);
  const b = r.toPixel(area.x + area.width, area.y);
  let hits = 0;
  let total = 0;
  for (let y = Math.floor(a.y); y < Math.ceil(b.y); y++)
    for (let x = Math.floor(a.x); x < Math.ceil(b.x); x++) {
      const i = (y * r.width + x) * 4;
      total++;
      if (
        Math.abs(r.data[i]! - rgb[0]) < 60 &&
        Math.abs(r.data[i + 1]! - rgb[1]) < 60 &&
        Math.abs(r.data[i + 2]! - rgb[2]) < 60
      )
        hits++;
    }
  return total ? hits / total : 0;
}

const rectOf = (name: string) =>
  originalFields.find((f) => f.name === name)!.widgets[0]!.rect;

describe("reading the form (formRead)", () => {
  it("finds every field with its kind, value and /DA style", () => {
    const byName = Object.fromEntries(originalFields.map((f) => [f.name, f]));
    expect(Object.keys(byName).sort()).toEqual([
      "acepto",
      "auto",
      "codigo",
      "colores",
      "comentarios",
      "nombre",
      "pais",
      "talla",
    ]);
    expect(byName.nombre).toMatchObject({
      kind: "text",
      value: "Valor inicial",
      style: { font: "Times", size: 14, color: "#cc1a1a" },
    });
    expect(byName.codigo!.style).toMatchObject({
      font: "Courier",
      size: 9,
      color: "#0000b3",
    });
    expect(byName.auto!.style).toMatchObject({
      font: "Helvetica",
      size: 0,
      color: "#008000",
    });
    expect(byName.comentarios!.kind).toBe("multiline");
    expect(byName.acepto).toMatchObject({ kind: "checkbox", value: "Off" });
    expect(byName.talla!.kind).toBe("radio");
    expect(byName.talla!.widgets).toHaveLength(3);
    expect(byName.pais).toMatchObject({ kind: "dropdown" });
    expect(byName.pais!.options.map((o) => o.label)).toEqual([
      "Colombia",
      "Mexico",
      "Peru",
    ]);
    expect(byName.colores!.kind).toBe("list");
    expect(byName.nombre!.widgets[0]!.pageIndex).toBe(0);
  });
});

describe("filling (CA1–CA3)", () => {
  it("CA1: text keeps the family, size and color of its /DA, in /V and in the appearance", async () => {
    const bytes = await save([
      value("nombre", "Ana Pérez Ñandú"),
      value("codigo", "AB-123"),
      value("auto", "texto automático"),
    ]);
    const doc = await PDFDocument.load(bytes);
    const fields = Object.fromEntries(readFields(doc).map((f) => [f.name, f]));
    expect(fields.nombre!.value).toBe("Ana Pérez Ñandú");
    expect(fields.codigo!.value).toBe("AB-123");

    const nombre = normalAppearance(doc, widgetOf(doc, "nombre"));
    expect(nombre.baseFont).toBe("Times-Roman");
    expect(nombre.content).toMatch(/\/F0 14 Tf/);
    expect(nombre.content).toMatch(/0\.8 0\.102 0\.102 rg/);
    const codigo = normalAppearance(doc, widgetOf(doc, "codigo"));
    expect(codigo.baseFont).toBe("Courier");
    expect(codigo.content).toMatch(/\/F0 9 Tf/);
    expect(codigo.content).toMatch(/0 0 0\.702 rg/);
    const auto = normalAppearance(doc, widgetOf(doc, "auto"));
    expect(auto.baseFont).toBe("Helvetica");
    const size = Number(/\/F0 ([\d.]+) Tf/.exec(auto.content)![1]);
    expect(size).toBeGreaterThan(8);
    expect(size).toBeLessThan(18);

    // pdf.js sees the values, and the page shows them in their color.
    const pdf = await openPdf(bytes);
    const objects = (await pdf.getFieldObjects())! as unknown as Map<
      string,
      { type: string; value: unknown }[]
    >;
    expect(objects.get("nombre")!.find((o) => o.type)!.value).toBe(
      "Ana Pérez Ñandú",
    );
    await pdf.loadingTask.destroy();
    const render = await renderPage(bytes);
    expect(colorShare(render, rectOf("nombre"), [204, 26, 26])).toBeGreaterThan(
      0.01,
    );
    expect(colorShare(render, rectOf("codigo"), [0, 0, 179])).toBeGreaterThan(
      0.003,
    );
  });

  it("CA1: characters outside WinAnsi use the open font of the same family", async () => {
    const doc = await PDFDocument.load(await save([value("nombre", "Łódź")]));
    expect(normalAppearance(doc, widgetOf(doc, "nombre")).baseFont).toMatch(
      /Tinos/,
    );
  });

  it("CA2: multiline text wraps inside the field", async () => {
    const long =
      "Una frase bastante larga para que no quepa en una sola linea del campo de comentarios.\nY otra.";
    const doc = await PDFDocument.load(
      await save([value("comentarios", long)]),
    );
    const { content } = normalAppearance(doc, widgetOf(doc, "comentarios"));
    const ys = [...content.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)].map((m) =>
      Number(m[2]),
    );
    expect(ys.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeLessThan(ys[i - 1]!);
  });

  it("CA3: check box, radio button, dropdown and list", async () => {
    const talla = originalFields.find((f) => f.name === "talla")!;
    const m = talla.widgets[1]!.onState!;
    const bytes = await save([
      value("acepto", "Yes"),
      value("talla", m),
      value("pais", "Peru"),
      value("colores", ["Rojo", "Azul"]),
    ]);
    const doc = await PDFDocument.load(bytes);
    const fields = Object.fromEntries(readFields(doc).map((f) => [f.name, f]));
    expect(fields.acepto!.value).toBe("Yes");
    expect(widgetOf(doc, "acepto").lookup(PDFName.of("AS"))).toEqual(
      PDFName.of("Yes"),
    );
    expect(fields.talla!.value).toBe(m);
    const states = readFields(doc)
      .find((f) => f.name === "talla")!
      .widgets.map((w) => {
        const [num] = w.ref.split(" ").map(Number);
        const dict = doc.context.lookup(PDFRef.of(num!, 0)) as PDFDict;
        return (dict.lookup(PDFName.of("AS")) as PDFName).decodeText();
      });
    expect(states).toEqual(["Off", m, "Off"]);
    expect(fields.pais!.value).toBe("Peru");
    expect(fields.colores!.value).toEqual(["Rojo", "Azul"]);
    const list = rawFields(doc).find((f) => f.name === "colores")!;
    expect(
      (list.dict.lookup(PDFName.of("I")) as PDFArray).asArray().map(String),
    ).toEqual(["0", "2"]);
    expect(normalAppearance(doc, widgetOf(doc, "pais")).content).toMatch(/Tj/);
  });

  it("the last value of a name wins, and untouched fields keep their appearance", async () => {
    const bytes = await save([
      value("codigo", "uno", 1),
      value("codigo", "dos", 2),
    ]);
    const doc = await PDFDocument.load(bytes);
    expect(readFields(doc).find((f) => f.name === "codigo")!.value).toBe("dos");
    const before = await PDFDocument.load(original);
    expect(normalAppearance(doc, widgetOf(doc, "nombre")).content).toBe(
      normalAppearance(before, widgetOf(before, "nombre")).content,
    );
  });

  it("CA10: the page content is not rewritten", async () => {
    const pageContent = async (bytes: Uint8Array) => {
      const doc = await PDFDocument.load(bytes);
      const contents = doc.getPage(0).node.Contents();
      const list =
        contents instanceof PDFArray ? contents.asArray() : [contents];
      return list.map((c) => streamText(doc, c)).join("\n");
    };
    const after = await pageContent(await save([value("nombre", "Otro")]));
    expect(after).toContain(await pageContent(original));
  });
});

describe("appearance layout", () => {
  it("wraps by words and breaks words longer than the line", async () => {
    const doc = await PDFDocument.create();
    const font = metricsOf(await doc.embedFont("Helvetica"));
    expect(wrapText("uno dos tres", font, 10, 40)).toEqual(["uno dos", "tres"]);
    const parts = wrapText("abcdefghijklmnopqrstuvwxyz", font, 10, 40);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.join("")).toBe("abcdefghijklmnopqrstuvwxyz");
    expect(wrapText("a\n\nb", font, 10, 40)).toEqual(["a", "", "b"]);
  });

  it("automatic size fills the height and shrinks to the width", async () => {
    const doc = await PDFDocument.create();
    const font = metricsOf(await doc.embedFont("Helvetica"));
    const tall = autoSize("Hola", font, 200, 16, false);
    expect(tall).toBeGreaterThan(14);
    const wide = autoSize(
      "Un texto muy largo que no cabe",
      font,
      60,
      16,
      false,
    );
    expect(wide).toBeLessThan(tall);
    expect(
      font.width("Un texto muy largo que no cabe") * wide,
    ).toBeLessThanOrEqual(60.01);
    expect(autoSize("corto", font, 100, 100, true)).toBe(12);
  });
});

describe("creating fields (CA5)", () => {
  const field = (
    id: string,
    patch: Partial<FormFieldItem> & Pick<FormFieldItem, "field" | "name">,
    y: number,
  ): FormFieldItem => ({
    kind: "formField",
    id,
    pageId: "p1",
    rect: { x: 300, y, width: 150, height: 20 },
    align: "left",
    required: false,
    style: { font: "Helvetica", size: 0, color: "#000000" },
    ...patch,
  });

  it("creates the six kinds; pdf.js recognizes them and they can be filled", async () => {
    const items: Item[] = [
      field(
        "f1",
        {
          field: "text",
          name: "nuevo",
          style: { font: "Times", size: 12, color: "#0000ff" },
          required: true,
        },
        300,
      ),
      field("f2", { field: "multiline", name: "notas" }, 260),
      field("f3", { field: "checkbox", name: "casilla" }, 230),
      field("f4", { field: "radio", name: "grupo", exportValue: "uno" }, 200),
      field("f5", { field: "radio", name: "grupo", exportValue: "dos" }, 175),
      field(
        "f6",
        { field: "dropdown", name: "lista", options: ["A", "B"] },
        150,
      ),
      field(
        "f7",
        {
          field: "list",
          name: "varios",
          options: ["X", "Y", "Z"],
          multiSelect: true,
        },
        80,
      ),
      field(
        "f8",
        { field: "text", name: "peine", maxLength: 5, comb: true },
        40,
      ),
      { ...value("nuevo", "hola"), pageId: "p1" },
      { ...value("grupo", "dos"), pageId: "p1" },
      { ...value("casilla", "Yes"), pageId: "p1" },
      { ...value("varios", ["X", "Z"]), pageId: "p1" },
      { ...value("peine", "12345"), pageId: "p1" },
    ];
    const bytes = await save(items);
    const pdf = await openPdf(bytes);
    const objects = (await pdf.getFieldObjects())! as unknown as Map<
      string,
      { type: string; value: unknown }[]
    >;
    expect(objects.get("nuevo")!.find((o) => o.type)!).toMatchObject({
      type: "text",
      value: "hola",
    });
    expect(objects.get("notas")!.find((o) => o.type)!.type).toBe("text");
    expect(objects.get("casilla")!.find((o) => o.type)!).toMatchObject({
      type: "checkbox",
      value: "Yes",
    });
    expect(
      objects
        .get("grupo")!
        .map((o) => o.type)
        .filter(Boolean),
    ).toEqual(["radiobutton", "radiobutton"]);
    expect(objects.get("lista")!.find((o) => o.type)!).toMatchObject({
      type: "combobox",
      value: "A",
    });
    expect(objects.get("varios")!.find((o) => o.type)!.type).toBe("listbox");
    await pdf.loadingTask.destroy();

    const doc = await PDFDocument.load(bytes);
    const fields = Object.fromEntries(readFields(doc).map((f) => [f.name, f]));
    expect(fields.nuevo).toMatchObject({
      required: true,
      style: { font: "Times", size: 12, color: "#0000ff" },
      value: "hola",
    });
    expect(fields.nuevo!.widgets[0]!.pageIndex).toBe(1);
    expect(fields.grupo!.value).toBe("dos");
    expect(fields.grupo!.widgets.map((w) => w.onState)).toEqual(["uno", "dos"]);
    expect(fields.varios!.value).toEqual(["X", "Z"]);
    expect(normalAppearance(doc, widgetOf(doc, "nuevo")).baseFont).toBe(
      "Times-Roman",
    );
    // Comb: one character per box of 30 pt.
    const xs = [
      ...normalAppearance(doc, widgetOf(doc, "peine")).content.matchAll(
        /1 0 0 1 ([\d.]+) [\d.]+ Tm/g,
      ),
    ].map((m) => Number(m[1]));
    expect(xs).toHaveLength(5);
    for (let i = 1; i < 5; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(30, 0);
  });

  it("names are unique", async () => {
    const bytes = await save([
      field("f1", { field: "text", name: "nombre" }, 300),
    ]);
    const names = readFields(await PDFDocument.load(bytes)).map((f) => f.name);
    expect(names.filter((n) => n.startsWith("nombre"))).toEqual([
      "nombre",
      "nombre_2",
    ]);
  });
});

describe("flattening (CA6)", () => {
  it("draws the values into the page and removes the fields and widgets", async () => {
    const items = [
      value("nombre", "Ana Plana"),
      value("acepto", "Yes"),
      value("pais", "Mexico"),
    ];
    const kept = await save(items);
    const flat = await save(items, { flattenForms: true });
    const doc = await PDFDocument.load(flat);
    expect(doc.catalog.lookup(PDFName.of("AcroForm"))).toBeUndefined();
    for (const page of doc.getPages()) {
      const annots = page.node.lookup(PDFName.of("Annots"));
      const subtypes =
        annots instanceof PDFArray
          ? annots
              .asArray()
              .map((a) =>
                String(
                  (doc.context.lookup(a) as PDFDict).get(PDFName.of("Subtype")),
                ),
              )
          : [];
      expect(subtypes).not.toContain("/Widget");
    }
    // The other annotations are not flattened.
    expect(
      (doc.getPage(1).node.lookup(PDFName.of("Annots")) as PDFArray).size(),
    ).toBe(8);

    const pdf = await openPdf(flat);
    const text = await (await pdf.getPage(1)).getTextContent();
    const strings = text.items.map((i) => ("str" in i ? i.str : "")).join(" ");
    expect(strings).toContain("Ana Plana");
    expect(strings).toContain("Mexico");
    await pdf.loadingTask.destroy();

    const [a, b] = [await renderPage(kept), await renderPage(flat)];
    for (const name of ["nombre", "acepto", "pais"])
      expect(
        colorShare(b, rectOf(name), [0, 0, 0]) +
          colorShare(b, rectOf(name), [204, 26, 26]),
      ).toBeCloseTo(
        colorShare(a, rectOf(name), [0, 0, 0]) +
          colorShare(a, rectOf(name), [204, 26, 26]),
        2,
      );
  });
});
