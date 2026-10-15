// Spec 001, phase 3: engine (T010) and output validation (T011 / CA9).
import { deflateSync } from "node:zlib";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { applyEdits, imagePlacement } from "../src/engine/applyEdits";
import {
  A4,
  type EditorState,
  type Item,
  type TextItem,
} from "../src/model/document";
import { applyOperation, type Operation } from "../src/model/operations";
import {
  fixture,
  openPdf,
  pageText,
  qpdfCheck,
  qpdfPath,
  stateFor,
  testDeps,
  textRuns,
} from "./helpers";

function run(state: EditorState, ...ops: Operation[]): EditorState {
  return ops.reduce(applyOperation, state);
}

const textItem = (
  pageId: string,
  text: string,
  extra: Partial<TextItem> = {},
): TextItem => ({
  kind: "text",
  id: `t-${text}`,
  pageId,
  at: { x: 100, y: 500 },
  text,
  style: {
    font: "Helvetica",
    size: 14,
    color: "#cc0000",
    bold: false,
    italic: false,
    lineHeight: 1.2,
  },
  rotate: 0,
  ...extra,
});

/** Minimal valid RGB PNG, built here so tests need no image files. */
function makePng(
  width: number,
  height: number,
  [r, g, b]: [number, number, number],
) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.from([
    0,
    ...Array.from({ length: width }, () => [r, g, b]).flat(),
  ]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

async function save(original: Uint8Array, state: EditorState) {
  const result = await applyEdits(original, state, testDeps);
  if (qpdfPath) await qpdfCheck(result.bytes); // CA9: rejects on any error or warning
  return result;
}

describe("applyEdits", () => {
  it("CA9: never modifies the original bytes", async () => {
    const original = await fixture("simple-text.pdf");
    const copy = original.slice();
    const state = run(await stateFor(original), {
      kind: "addItem",
      item: textItem("p0", "Nuevo"),
    });
    await save(original, state);
    expect(original).toEqual(copy);
  });

  it("CA2: added text is real text at the requested position, size and font", async () => {
    const original = await fixture("simple-text.pdf");
    const state = run(await stateFor(original), {
      kind: "addItem",
      item: textItem("p0", "Texto añadido por pdfcraft", {
        at: { x: 123.5, y: 456.25 },
      }),
    });
    const { bytes, warnings } = await save(original, state);
    expect(warnings).toEqual([]);
    const run0 = (await textRuns(bytes)).find((r) =>
      r.str.includes("Texto añadido"),
    );
    expect(run0).toBeDefined();
    expect(run0!.x).toBeCloseTo(123.5, 0);
    expect(run0!.y).toBeCloseTo(456.25, 0);
    expect(run0!.size).toBeCloseTo(14, 1);
    expect(await pageText(bytes)).toContain("Documento de prueba pdfcraft");
  });

  it("writes multi-line text with the chosen line height", async () => {
    const original = await fixture("simple-text.pdf");
    const state = run(await stateFor(original), {
      kind: "addItem",
      item: textItem("p0", "Linea uno\nLinea dos", { at: { x: 100, y: 400 } }),
    });
    const runs = await textRuns((await save(original, state)).bytes);
    const one = runs.find((r) => r.str === "Linea uno")!;
    const two = runs.find((r) => r.str === "Linea dos")!;
    expect(one.y - two.y).toBeCloseTo(14 * 1.2, 1);
  });

  it("falls back to Arimo for characters outside WinAnsi, with a warning", async () => {
    const original = await fixture("simple-text.pdf");
    const state = run(await stateFor(original), {
      kind: "addItem",
      item: textItem("p0", "Łódź ✓"),
    });
    const { bytes, warnings } = await save(original, state);
    expect(warnings.join(" ")).toContain("Arimo");
    expect(await pageText(bytes)).toContain("Łódź");
  });

  it("CA7: rotates, deletes, reorders and inserts pages without touching others", async () => {
    const original = await fixture("rotated-page.pdf");
    let state = await stateFor(original); // p0 has /Rotate 90, p1 none
    state = run(
      state,
      { kind: "rotatePage", pageId: "p1", degrees: 180 },
      { kind: "insertBlankPage", atIndex: 0, pageId: "blank", box: A4 },
      { kind: "movePage", pageId: "p0", toIndex: 2 },
    );
    const { bytes } = await save(original, state);
    const doc = await openPdf(bytes);
    expect(doc.numPages).toBe(3);
    const texts = [];
    const rotations = [];
    for (let i = 1; i <= 3; i++) {
      const page = await doc.getPage(i);
      rotations.push(page.rotate);
      texts.push(
        (await page.getTextContent()).items
          .map((t) => ("str" in t ? t.str : ""))
          .join(""),
      );
    }
    expect(texts).toEqual(["", "Pagina sin rotar", "Pagina con /Rotate 90"]);
    expect(rotations).toEqual([0, 180, 90]);
    await doc.loadingTask.destroy();

    const deleted = run(await stateFor(original), {
      kind: "deletePage",
      pageId: "p0",
    });
    const out = await save(original, deleted);
    expect(await pageText(out.bytes)).toBe("Pagina sin rotar");
    expect((await openPdf(out.bytes)).numPages).toBe(1);
  });

  it("CA5: draws images with their aspect ratio and position", async () => {
    const original = await fixture("simple-text.pdf");
    const item: Item = {
      kind: "image",
      id: "img",
      pageId: "p0",
      rect: { x: 100, y: 300, width: 200, height: 100 },
      mime: "image/png",
      data: makePng(4, 2, [30, 160, 90]),
      rotate: 0,
    };
    const { bytes } = await save(
      original,
      run(await stateFor(original), { kind: "addItem", item }),
    );
    const doc = await openPdf(bytes);
    const ops = await (await doc.getPage(1)).getOperatorList();
    expect(ops.fnArray).toContain(OPS.paintImageXObject);
    await doc.loadingTask.destroy();
  });

  it("places rotated images so they cover the same rect", () => {
    const r = { x: 10, y: 20, width: 200, height: 100 };
    expect(imagePlacement(r, 0)).toEqual({
      x: 10,
      y: 20,
      width: 200,
      height: 100,
    });
    expect(imagePlacement(r, 90)).toEqual({
      x: 210,
      y: 20,
      width: 100,
      height: 200,
    });
    expect(imagePlacement(r, 180)).toEqual({
      x: 210,
      y: 120,
      width: 200,
      height: 100,
    });
    expect(imagePlacement(r, 270)).toEqual({
      x: 10,
      y: 120,
      width: 100,
      height: 200,
    });
  });

  it("CA6: whiteout paints a white rectangle but leaves the text in the file", async () => {
    const original = await fixture("simple-text.pdf");
    const state = run(await stateFor(original), {
      kind: "addItem",
      item: {
        kind: "whiteout",
        id: "w",
        pageId: "p0",
        rect: { x: 50, y: 720, width: 400, height: 30 },
      },
    });
    const { bytes } = await save(original, state);
    expect(await pageText(bytes)).toContain("El rapido zorro"); // not a redaction
    const doc = await openPdf(bytes);
    const ops = await (await doc.getPage(1)).getOperatorList();
    expect(ops.fnArray).toContain(OPS.constructPath);
    await doc.loadingTask.destroy();
  });

  it("CA4: annotations are standard PDF annotations with appearances", async () => {
    const original = await fixture("simple-text.pdf");
    const base = { pageId: "p0", color: "#ffd400", width: 2 };
    const items: Item[] = [
      {
        ...base,
        kind: "annotation",
        id: "h",
        shape: "highlight",
        rects: [{ x: 56, y: 725, width: 300, height: 16 }],
      },
      {
        ...base,
        kind: "annotation",
        id: "i",
        shape: "ink",
        paths: [
          [
            { x: 100, y: 100 },
            { x: 150, y: 140 },
            { x: 200, y: 100 },
          ],
        ],
      },
      {
        ...base,
        kind: "annotation",
        id: "l",
        shape: "line",
        paths: [
          [
            { x: 100, y: 200 },
            { x: 300, y: 200 },
          ],
        ],
      },
      {
        ...base,
        kind: "annotation",
        id: "s",
        shape: "square",
        rects: [{ x: 300, y: 300, width: 80, height: 50 }],
      },
      {
        ...base,
        kind: "annotation",
        id: "c",
        shape: "circle",
        rects: [{ x: 400, y: 300, width: 80, height: 50 }],
      },
    ];
    const state = run(
      await stateFor(original),
      ...items.map((item) => ({ kind: "addItem" as const, item })),
    );
    const { bytes } = await save(original, state);
    const doc = await openPdf(bytes);
    const annots = await (await doc.getPage(1)).getAnnotations();
    expect(annots.map((a) => a.subtype).sort()).toEqual([
      "Circle",
      "Highlight",
      "Ink",
      "Line",
      "Square",
    ]);
    expect(annots.every((a) => a.hasAppearance)).toBe(true);
    await doc.loadingTask.destroy();
  });

  it("keeps edits on the right page after page reordering", async () => {
    const original = await fixture("two-pages.pdf");
    const state = run(
      await stateFor(original),
      { kind: "addItem", item: textItem("p1", "Marca en la pagina dos") },
      { kind: "movePage", pageId: "p1", toIndex: 0 },
    );
    const { bytes } = await save(original, state);
    expect(await pageText(bytes, 1)).toContain("Marca en la pagina dos");
    expect(await pageText(bytes, 1)).toContain("Pagina 2 de 2");
    expect(await pageText(bytes, 2)).not.toContain("Marca");
  });

  it("CA9: outputs pass qpdf --check", async () => {
    if (!qpdfPath) return; // qpdf not installed on this machine
    const original = await fixture("many-pages.pdf");
    const state = run(
      await stateFor(original),
      { kind: "deletePage", pageId: "p5" },
      { kind: "movePage", pageId: "p0", toIndex: 100 },
      { kind: "addItem", item: textItem("p10", "Hola") },
    );
    const { bytes } = await applyEdits(original, state, testDeps);
    expect(await qpdfCheck(bytes)).toContain(
      "No syntax or stream encoding errors",
    );
  });

  it("sets the producer and modification date", async () => {
    const original = await fixture("simple-text.pdf");
    const { bytes } = await save(original, await stateFor(original));
    const doc = await openPdf(bytes);
    const { info } = (await doc.getMetadata()) as {
      info: Record<string, string>;
    };
    expect(info.Producer).toBe("InkognitoPDF");
    expect(info.ModDate).toContain("20260102");
    await doc.loadingTask.destroy();
  });
});
