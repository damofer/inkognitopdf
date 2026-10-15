// Checks that the synthetic fixtures (T003) open in pdf.js and contain what the
// tests expect. Uses the legacy build, which is the one supported in Node.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);
const pdfjsRoot = join(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
  "..",
);
const standardFontDataUrl = join(pdfjsRoot, "standard_fonts") + "/";

async function open(name: string) {
  const data = new Uint8Array(await readFile(fixture(name)));
  return getDocument({ data, useSystemFonts: false, standardFontDataUrl })
    .promise;
}

async function pageText(name: string, pageNumber = 1) {
  const doc = await open(name);
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const text = content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join("");
  await doc.loadingTask.destroy();
  return text;
}

describe("fixtures", () => {
  it.each([
    ["simple-text.pdf", 1, "Documento de prueba pdfcraft"],
    ["table.pdf", 1, "Ejemplo Uno"],
    ["two-pages.pdf", 2, "Pagina 2 de 2"],
    ["subset-font.pdf", 1, "Fuente incrustada como subconjunto"],
    ["many-pages.pdf", 200, "Pagina 200 de 200"],
  ])("%s, page %i contains «%s»", async (name, page, expected) => {
    expect(await pageText(name, page)).toContain(expected);
  });

  it("tj-kerning.pdf joins the TJ runs into one text", async () => {
    expect((await pageText("tj-kerning.pdf")).replace(/\s+/g, " ")).toContain(
      "Kerning TJ",
    );
  });

  it("rotated-page.pdf has /Rotate 90 on page 1 only", async () => {
    const doc = await open("rotated-page.pdf");
    expect((await doc.getPage(1)).rotate).toBe(90);
    expect((await doc.getPage(2)).rotate).toBe(0);
    await doc.loadingTask.destroy();
  });

  it("many-pages.pdf has 200 pages", async () => {
    const doc = await open("many-pages.pdf");
    expect(doc.numPages).toBe(200);
    await doc.loadingTask.destroy();
  });
});
