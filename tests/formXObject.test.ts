// Spec 001, phase 6 (T027): editing text inside Form XObjects.
import { PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { textBoxes, textEditFor, type TextBox } from "../src/editor/textBoxes";
import { applyEdits } from "../src/engine/applyEdits";
import { pageTextShows } from "../src/engine/textEdit";
import type { EditorState } from "../src/model/document";
import { applyOperation } from "../src/model/operations";
import {
  fixture,
  openPdf,
  qpdfCheck,
  qpdfPath,
  stateFor,
  testDeps,
  textRuns,
} from "./helpers";

async function boxes(bytes: Uint8Array, pageNumber = 1): Promise<TextBox[]> {
  const doc = await openPdf(bytes);
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  await doc.loadingTask.destroy();
  return textBoxes(content);
}

/** Boxes with `text`, top to bottom. */
async function boxesWith(bytes: Uint8Array, text: string, pageNumber = 1) {
  return (await boxes(bytes, pageNumber))
    .filter((b) => b.text === text)
    .sort((a, b) => b.at.y - a.at.y);
}

async function editBoxes(
  original: Uint8Array,
  edits: { box: TextBox; text: string; pageIndex?: number }[],
) {
  let state: EditorState = await stateFor(original);
  for (const [i, { box, text, pageIndex = 0 }] of edits.entries())
    state = applyOperation(state, {
      kind: "addItem",
      item: textEditFor(box, `p${pageIndex}`, `e${i}`, text),
    });
  const result = await applyEdits(original, state, testDeps);
  if (qpdfPath) await qpdfCheck(result.bytes);
  return result;
}

const strings = async (bytes: Uint8Array, pageNumber = 1) =>
  (await textRuns(bytes, pageNumber)).map((r) => r.str).sort();

describe("text in Form XObjects (T027)", () => {
  it("edits one use of a shared form and keeps the other uses (copy-on-write)", async () => {
    const original = await fixture("form-xobjects.pdf");
    const [top, bottom] = await boxesWith(original, "Tarjeta compartida");
    expect(bottom).toBeDefined();
    const { bytes, warnings } = await editBoxes(original, [
      { box: top!, text: "Tarjeta editada" },
    ]);
    expect(warnings).toEqual([]);
    expect(await strings(bytes)).toEqual(
      [
        "Tarjeta editada",
        "Tarjeta compartida",
        "Texto anidado",
        "Texto anidado",
        "Formulario girado",
        "Texto de la pagina",
      ].sort(),
    );
    const edited = (await boxesWith(bytes, "Tarjeta editada"))[0]!;
    expect(edited.at.x).toBeCloseTo(top!.at.x, 1);
    expect(edited.at.y).toBeCloseTo(top!.at.y, 1);
    expect(edited.size).toBeCloseTo(top!.size, 2);
    // Page 2 draws the same form and is not touched.
    expect(await strings(bytes, 2)).toEqual([
      "Tarjeta compartida",
      "Texto anidado",
    ]);

    // The original form stream is unchanged and still used.
    const doc = await PDFDocument.load(bytes);
    const resources = (i: number) =>
      doc.getPage(i).node.normalizedEntries().Resources!;
    const xobjects = (i: number) =>
      resources(i).lookup(PDFName.of("XObject"), PDFDict);
    const card = xobjects(1).lookup(PDFName.of("Card"));
    expect(card).toBeInstanceOf(PDFStream);
    expect(xobjects(0).lookup(PDFName.of("Card"))).toBe(card);
  });

  it("keeps color and size of form text", async () => {
    const original = await fixture("form-xobjects.pdf");
    const [, bottom] = await boxesWith(original, "Tarjeta compartida");
    const { bytes } = await editBoxes(original, [
      { box: bottom!, text: "Otra tarjeta" },
    ]);
    const doc = await PDFDocument.load(bytes);
    const show = pageTextShows(doc, doc.getPage(0)).find(
      (s) => s.text === "Otra tarjeta",
    );
    expect(show?.color).toBe("#006600");
    expect(show?.fontSize).toBe(14);
    expect(show?.state.fillOps).toBe("0 0.4 0 rg");
  });

  it("edits text in a nested form, only in the use that was edited", async () => {
    const original = await fixture("form-xobjects.pdf");
    const [, bottom] = await boxesWith(original, "Texto anidado");
    const { bytes, warnings } = await editBoxes(original, [
      { box: bottom!, text: "Anidado editado" },
    ]);
    expect(warnings).toEqual([]);
    const runs = await strings(bytes);
    expect(runs).toContain("Anidado editado");
    expect(runs.filter((r) => r === "Texto anidado")).toHaveLength(1);
    expect(runs.filter((r) => r === "Tarjeta compartida")).toHaveLength(2);
    const edited = (await boxesWith(bytes, "Anidado editado"))[0]!;
    expect(edited.at.x).toBeCloseTo(bottom!.at.x, 1);
    expect(edited.at.y).toBeCloseTo(bottom!.at.y, 1);
    // CMYK color, replayed as is.
    const doc = await PDFDocument.load(bytes);
    const show = pageTextShows(doc, doc.getPage(0)).find(
      (s) => s.text === "Anidado editado",
    );
    expect(show?.state.fillOps).toBe("0.1 0.9 0.8 0.05 k");
  });

  it("edits text in a rotated form that inherits the page resources", async () => {
    const original = await fixture("form-xobjects.pdf");
    const [box] = await boxesWith(original, "Formulario girado");
    expect(box!.rotate).toBeCloseTo(30, 1);
    const { bytes, warnings } = await editBoxes(original, [
      { box: box!, text: "Girado y editado" },
    ]);
    expect(warnings).toEqual([]);
    const edited = (await boxesWith(bytes, "Girado y editado"))[0]!;
    expect(edited.at.x).toBeCloseTo(box!.at.x, 1);
    expect(edited.at.y).toBeCloseTo(box!.at.y, 1);
    expect(edited.rotate).toBeCloseTo(30, 1);
    expect(await strings(bytes)).not.toContain("Formulario girado");
  });

  it("edits form text and page text together, on two pages", async () => {
    const original = await fixture("form-xobjects.pdf");
    const [top] = await boxesWith(original, "Tarjeta compartida");
    const [page] = await boxesWith(original, "Texto de la pagina");
    const [onPage2] = await boxesWith(original, "Tarjeta compartida", 2);
    const { bytes } = await editBoxes(original, [
      { box: top!, text: "Uno" },
      { box: page!, text: "Dos" },
      { box: onPage2!, text: "Tres", pageIndex: 1 },
    ]);
    const runs = await strings(bytes);
    expect(runs).toContain("Uno");
    expect(runs).toContain("Dos");
    expect(runs.filter((r) => r === "Tarjeta compartida")).toHaveLength(1);
    expect(await strings(bytes, 2)).toEqual(["Texto anidado", "Tres"]);
  });

  it("uses a substitute inside a form when glyphs are missing", async () => {
    const original = await fixture("form-xobjects.pdf");
    const [top] = await boxesWith(original, "Tarjeta compartida");
    const { bytes, warnings } = await editBoxes(original, [
      { box: top!, text: "Tarjeta Ŵ" },
    ]);
    expect(warnings.join(" ")).toContain("Arimo Regular");
    const runs = await textRuns(bytes);
    expect(runs.map((r) => r.str).join("")).toContain("Ŵ");
  });
});
