// Spec 001, phase 5: editing existing text (T019–T021, CA3).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { Font, FontNames } from "@pdf-lib/standard-fonts";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { textBoxes, textEditFor, type TextBox } from "../src/editor/textBoxes";
import { applyEdits } from "../src/engine/applyEdits";
import { parseContentStream } from "../src/engine/contentStream";
import { pageFonts } from "../src/engine/pdfFonts";
import { pageContentBytes } from "../src/engine/textEdit";
import { findTextShows } from "../src/engine/textShows";
import type { EditorState, TextEditItem } from "../src/model/document";
import { applyOperation } from "../src/model/operations";
import {
  fixture,
  openPdf,
  qpdfCheck,
  qpdfPath,
  standardFontsDir,
  stateFor,
  testDeps,
  textRuns,
} from "./helpers";

async function shows(bytes: Uint8Array, pageIndex = 0) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  return findTextShows(
    parseContentStream(pageContentBytes(doc, page)),
    pageFonts(doc, page),
  );
}

async function boxes(bytes: Uint8Array, pageNumber = 1): Promise<TextBox[]> {
  const doc = await openPdf(bytes);
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  await doc.loadingTask.destroy();
  return textBoxes(content);
}

async function boxWith(bytes: Uint8Array, text: string, pageNumber = 1) {
  const box = (await boxes(bytes, pageNumber)).find((b) => b.text === text);
  if (!box)
    throw new Error(
      `no box "${text}" in ${(await boxes(bytes, pageNumber)).map((b) => b.text).join(" | ")}`,
    );
  return box;
}

async function edit(
  original: Uint8Array,
  edits: { pageId: string; item: TextEditItem }[],
) {
  let state: EditorState = await stateFor(original);
  for (const { item } of edits)
    state = applyOperation(state, { kind: "addItem", item });
  const result = await applyEdits(original, state, testDeps);
  if (qpdfPath) await qpdfCheck(result.bytes);
  return result;
}

async function editText(
  name: string,
  from: string,
  to: string,
  pageNumber = 1,
) {
  const original = await fixture(name);
  const box = await boxWith(original, from, pageNumber);
  const pageId = `p${pageNumber - 1}`;
  const result = await edit(original, [
    { pageId, item: textEditFor(box, pageId, "e1", to) },
  ]);
  return { ...result, box, runs: await textRuns(result.bytes, pageNumber) };
}

const fontCount = async (bytes: Uint8Array, pageIndex = 0) => {
  const doc = await PDFDocument.load(bytes);
  const fonts = doc.getPage(pageIndex).node.normalizedEntries().Font;
  return fonts instanceof PDFDict ? fonts.keys().length : 0;
};

describe("text state interpreter (T019)", () => {
  it("finds every text operator where pdf.js places it", async () => {
    for (const name of [
      "simple-text.pdf",
      "table.pdf",
      "subset-font.pdf",
      "tj-kerning.pdf",
      "text-operators.pdf",
      "type3-font.pdf",
    ]) {
      const bytes = await fixture(name);
      const found = await shows(bytes);
      for (const run of await textRuns(bytes)) {
        // pdf.js may split one operator into several runs (e.g. with large
        // Tc), so a run must start on the baseline of some operator.
        const match = found.find((s) => {
          const a = (s.angle * Math.PI) / 180;
          const dx = run.x - s.origin.x;
          const dy = run.y - s.origin.y;
          const along = dx * Math.cos(a) + dy * Math.sin(a);
          const across = -dx * Math.sin(a) + dy * Math.cos(a);
          return Math.abs(across) < 0.5 && along > -0.5 && along < s.advance;
        });
        expect(match, `${name}: "${run.str}"`).toBeDefined();
        expect(match!.size).toBeCloseTo(run.size, 1);
      }
    }
  });

  it("follows split text, ', Tc, colors and rotated matrices", async () => {
    const found = await shows(await fixture("text-operators.pdf"));
    expect(found.map((s) => s.text)).toEqual([
      "Texto ",
      "dividido",
      " en partes",
      "Primera linea",
      "Segunda linea",
      "Tercera linea",
      "Texto girado",
      "Espaciado rojo",
    ]);
    // Glyph widths without kerning: Tj and TJ do not apply font kerning.
    const metrics = Font.load(FontNames.Helvetica);
    const width = (text: string, size: number) =>
      [...text].reduce(
        (w, ch) =>
          w +
          ((metrics.getWidthOfGlyph(ch === " " ? "space" : ch) as number) *
            size) /
            1000,
        0,
      );
    const [texto, dividido, , , segunda, tercera, girado, rojo] = found;
    expect(dividido!.origin.x).toBeCloseTo(
      texto!.origin.x + width("Texto ", 12),
      3,
    );
    expect(segunda!.origin).toEqual({ x: 56, y: 706 });
    expect(tercera!.origin).toEqual({ x: 56, y: 692 });
    expect(girado!.origin.x).toBeCloseTo(200, 3);
    expect(girado!.origin.y).toBeCloseTo(400, 3);
    expect(girado!.size).toBeCloseTo(18, 2);
    expect(girado!.angle).toBeCloseTo(45, 2);
    expect(rojo!.color).toBe("#cc0000");
    expect(rojo!.advance).toBeCloseTo(width("Espaciado rojo", 12) + 3 * 14, 3);
  });

  it("measures Type0 (subset) and Type3 fonts", async () => {
    const [subset] = await shows(await fixture("subset-font.pdf"));
    expect(subset!.text).toBe("Fuente incrustada como subconjunto: abc");
    expect(subset!.font!.bytesPerCode).toBe(2);
    const [t3] = await shows(await fixture("type3-font.pdf"));
    expect(t3!.text).toBe("ABCCBA");
    expect(t3!.advance).toBeCloseTo(6 * 0.6 * 24, 3);
  });
});

describe("CA3: editing existing text (T020–T021)", () => {
  it("replaces a line written with a standard font, reusing that font", async () => {
    const original = "El rapido zorro marron salta sobre el perro perezoso.";
    const { runs, box, warnings, bytes } = await editText(
      "simple-text.pdf",
      original,
      "Texto editado con pdfcraft",
    );
    expect(warnings).toEqual([]);
    expect(runs.map((r) => r.str)).not.toContain(original);
    expect(runs.map((r) => r.str).join(" ")).not.toContain("zorro");
    const added = runs.find((r) => r.str === "Texto editado con pdfcraft")!;
    expect(added.x).toBeCloseTo(box.at.x, 1);
    expect(added.y).toBeCloseTo(box.at.y, 1);
    expect(added.size).toBeCloseTo(12, 1);
    expect(runs.map((r) => r.str)).toContain("Documento de prueba pdfcraft");
    expect(await fontCount(bytes)).toBe(2); // Helvetica and Helvetica-Bold, no new font
  });

  it("reuses an embedded subset font when it has every glyph", async () => {
    const { runs, warnings, bytes } = await editText(
      "subset-font.pdf",
      "Fuente incrustada como subconjunto: abc",
      "Fuente si: abc",
    );
    expect(warnings).toEqual([]);
    expect(runs.map((r) => r.str)).toEqual(["Fuente si: abc"]);
    expect(await fontCount(bytes)).toBe(1);
  });

  it("uses a substitute font, with a warning, when glyphs are missing", async () => {
    const { runs, warnings, bytes } = await editText(
      "subset-font.pdf",
      "Fuente incrustada como subconjunto: abc",
      "Nueva fuente (con W y Z)",
    );
    expect(warnings.join(" ")).toContain("fuente sustituta");
    // Characters the subset has keep the original font; the rest use Arimo.
    expect(
      runs
        .map((r) => r.str)
        .join("")
        .replace(/\s/g, ""),
    ).toBe("Nuevafuente(conWyZ)");
    expect(new Set(runs.map((r) => r.fontName)).size).toBe(2);
    expect(await fontCount(bytes)).toBe(2);
  });

  it("handles TJ with kerning", async () => {
    const original = await fixture("tj-kerning.pdf");
    const [box] = await boxes(original);
    const { runs } = await editText("tj-kerning.pdf", box!.text, "Sin kerning");
    expect(runs.map((r) => r.str)).toEqual(["Sin kerning"]);
  });

  it("handles a page with /Rotate 90 and leaves other pages alone", async () => {
    const { runs, box, bytes } = await editText(
      "rotated-page.pdf",
      "Pagina con /Rotate 90",
      "Editada",
    );
    expect(runs.map((r) => r.str)).toEqual(["Editada"]);
    expect(runs[0]!.x).toBeCloseTo(box.at.x, 1);
    expect(runs[0]!.y).toBeCloseTo(box.at.y, 1);
    expect((await textRuns(bytes, 2)).map((r) => r.str)).toEqual([
      "Pagina sin rotar",
    ]);
  });

  it("keeps the next lines in place when a ' operator is removed", async () => {
    const { runs } = await editText(
      "text-operators.pdf",
      "Segunda linea",
      "Cambiada",
    );
    const tercera = runs.find((r) => r.str === "Tercera linea")!;
    expect(tercera.x).toBeCloseTo(56, 2);
    expect(tercera.y).toBeCloseTo(692, 2);
    expect(runs.find((r) => r.str === "Cambiada")!.y).toBeCloseTo(706, 2);
    expect(runs.map((r) => r.str)).not.toContain("Segunda linea");
  });

  it("removes part of a line and keeps the rest of the line in place", async () => {
    const original = await fixture("text-operators.pdf");
    const [, dividido, enPartes] = await shows(original);
    const item: TextEditItem = {
      kind: "textEdit",
      id: "e1",
      pageId: "p0",
      area: dividido!.bbox,
      originalText: "dividido",
      text: "partido",
      at: dividido!.origin,
      size: 12,
      rotate: 0,
      color: "#000000",
    };
    const { bytes } = await edit(original, [{ pageId: "p0", item }]);
    const after = await shows(bytes);
    const rest = after.find((s) => s.text === " en partes")!;
    expect(rest.origin.x).toBeCloseTo(enPartes!.origin.x, 3);
    expect(after.map((s) => s.text)).not.toContain("dividido");
    expect(after.map((s) => s.text)).toContain("partido");
  });

  it("replaces text drawn with a rotated text matrix", async () => {
    const { runs, bytes } = await editText(
      "text-operators.pdf",
      "Texto girado",
      "Girado nuevo",
    );
    const added = (await shows(bytes)).find((s) => s.text === "Girado nuevo")!;
    expect(runs.map((r) => r.str)).not.toContain("Texto girado");
    expect(added.angle).toBeCloseTo(45, 1);
    expect(added.size).toBeCloseTo(18, 1);
    expect(added.origin.x).toBeCloseTo(200, 1);
    expect(added.origin.y).toBeCloseTo(400, 1);
  });

  it("removes only the glyphs of a run that pdf.js split from its operator, keeping the color", async () => {
    // With Tc 3, pdf.js shows "Espaciado rojo" as "E s p a c i a d o" and "r o j o".
    const { bytes, runs } = await editText(
      "text-operators.pdf",
      "r o j o",
      "verde",
    );
    const after = await shows(bytes);
    const rest = after.find((s) => s.text.startsWith("Espaciado"))!;
    expect(rest.text.trimEnd()).toBe("Espaciado");
    expect(rest.origin).toEqual({ x: 56, y: 600 });
    const added = after.find((s) => s.text === "verde")!;
    expect(added.color).toBe("#cc0000");
    expect(runs.map((r) => r.str).join(" ")).not.toContain("r o j o");
  });

  it("replaces Type3 text with a substitute font and a warning", async () => {
    const { runs, warnings } = await editText(
      "type3-font.pdf",
      "ABCCBA",
      "Nuevo",
    );
    expect(warnings.join(" ")).toContain("fuente sustituta");
    expect(runs.map((r) => r.str).sort()).toEqual([
      "Nuevo",
      "Texto normal debajo",
    ]);
  });

  it("covers the area and warns when the original text cannot be found", async () => {
    const original = await fixture("simple-text.pdf");
    const item: TextEditItem = {
      kind: "textEdit",
      id: "e1",
      pageId: "p0",
      area: { x: 300, y: 300, width: 100, height: 20 },
      originalText: "fantasma",
      text: "Nuevo",
      at: { x: 300, y: 305 },
      size: 12,
      rotate: 0,
      color: "#000000",
    };
    const { bytes, warnings } = await edit(original, [{ pageId: "p0", item }]);
    expect(warnings.join(" ")).toContain("No se encontró el texto «fantasma»");
    const doc = await openPdf(bytes);
    const ops = await (await doc.getPage(1)).getOperatorList();
    expect(ops.fnArray).toContain(OPS.constructPath);
    await doc.loadingTask.destroy();
  });
});

/**
 * Bold text set with a subset whose name and descriptor say nothing of its
 * weight ("F2", Flags 4, no FontWeight, StemV 0), as some producers write it.
 */
async function anonymousBoldPdf() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = (variant: string) =>
    doc.embedFont(
      readFileSync(join(standardFontsDir, `LiberationSans-${variant}.ttf`)),
      { subset: true },
    );
  const regular = await font("Regular");
  const bold = await font("Bold");
  const page = doc.addPage([595, 842]);
  page.drawText("Resumen", { x: 56, y: 770, size: 18, font: bold });
  page.drawText("Texto normal de la cuenta", {
    x: 56,
    y: 740,
    size: 11,
    font: regular,
  });
  const bytes = await doc.save();
  // Anonymous names, as in the PDF of the bug report.
  const loaded = await PDFDocument.load(bytes);
  let n = 0;
  for (const [, obj] of loaded.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of("Type"));
    if (type === PDFName.of("Font"))
      obj.set(
        PDFName.of("BaseFont"),
        PDFName.of(`AAAAA${n++ % 2 ? "B" : "A"}+F`),
      );
    if (type === PDFName.of("FontDescriptor"))
      obj.set(PDFName.of("FontName"), PDFName.of("AAAAAA+F"));
  }
  return loaded.save();
}

describe("bold text with an anonymous subset font", () => {
  it("reads the weight from the embedded font program", async () => {
    const doc = await PDFDocument.load(await anonymousBoldPdf());
    const fonts = [...pageFonts(doc, doc.getPage(0)).values()];
    expect(fonts.map((f) => f.baseFont.replace(/^[A-Z]{6}\+/, ""))).toEqual([
      "F",
      "F",
    ]);
    expect(fonts.map((f) => f.bold).sort()).toEqual([false, true]);
  });

  it("characters the subset lacks come from the bold substitute", async () => {
    const original = await anonymousBoldPdf();
    const box = await boxWith(original, "Resumen");
    const { bytes } = await edit(original, [
      { pageId: "p0", item: textEditFor(box, "p0", "e1", "Resumen QXZ") },
    ]);
    const doc = await PDFDocument.load(bytes);
    const names = [...pageFonts(doc, doc.getPage(0)).values()].map(
      (f) => f.baseFont,
    );
    expect(names.some((n) => /Arimo-Bold$/.test(n))).toBe(true);
    expect(names.some((n) => /Arimo-Regular$/.test(n))).toBe(false);
    const runs = await textRuns(bytes, 1);
    expect(runs.map((r) => r.str).join(" ")).toContain("QXZ");
  });

  it("the weight seen by the editor wins when the font says nothing", async () => {
    const original = await fixture("type3-font.pdf");
    const box = await boxWith(original, "ABCCBA");
    const { bytes } = await edit(original, [
      {
        pageId: "p0",
        item: { ...textEditFor(box, "p0", "e1", "Nuevo"), bold: true },
      },
    ]);
    const doc = await PDFDocument.load(bytes);
    const names = [...pageFonts(doc, doc.getPage(0)).values()].map(
      (f) => f.baseFont,
    );
    expect(names.some((n) => /Arimo-Bold$/.test(n))).toBe(true);
  });
});
