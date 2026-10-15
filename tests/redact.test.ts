// Spec 012: secure redaction removes the content from the file, never just covers it.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  type PDFPage,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/engine/applyEdits";
import { clearBits, unpredict, type ImageCodec } from "../src/engine/redact";
import {
  type EditorState,
  type Item,
  type RedactionItem,
} from "../src/model/document";
import type { Rect } from "../src/model/geometry";
import {
  fileContains,
  pageText,
  qpdfCheck,
  qpdfPath,
  stateFor,
  testDeps,
} from "./helpers";
import { renderPage } from "./renderHelpers";

const SECRET = "4711-0815";

/** JPEG through @napi-rs/canvas, as the browser does with a canvas. */
const codec: ImageCodec = {
  async decodeJpeg(bytes) {
    const image = await loadImage(Buffer.from(bytes));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    return { width: image.width, height: image.height, data };
  },
  async encodeJpeg(rgba, width, height) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(width, height);
    image.data.set(rgba);
    ctx.putImageData(image, 0, 0);
    return new Uint8Array(await canvas.encode("jpeg", 92));
  },
};
const deps = { ...testDeps, images: codec };

let nextId = 1;
const redaction = (
  pageId: string,
  rect: Rect,
  extra: Partial<RedactionItem> = {},
): RedactionItem => ({
  kind: "redaction",
  id: `r${nextId++}`,
  pageId,
  rect,
  applied: true,
  ...extra,
});

async function save(bytes: Uint8Array, items: (state: EditorState) => Item[]) {
  const state = await stateFor(bytes);
  return applyEdits(bytes, { ...state, items: items(state) }, deps);
}

/** A page with a line of text whose number is redacted. */
async function textPdf(draw?: (page: PDFPage, doc: PDFDocument) => void) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText(`Cuenta ${SECRET} Banco`, { x: 50, y: 200, size: 12, font });
  page.drawText("Otra linea intacta", { x: 50, y: 170, size: 12, font });
  draw?.(page, doc);
  const before = font.widthOfTextAtSize("Cuenta ", 12);
  const width = font.widthOfTextAtSize(SECRET, 12);
  return {
    bytes: await doc.save(),
    area: { x: 50 + before + 1, y: 196, width: width - 2, height: 14 },
  };
}

describe("secure redaction (spec 012)", () => {
  it("removes the glyphs under the area and keeps the rest in place", async () => {
    const { bytes, area } = await textPdf();
    expect(await fileContains(bytes, SECRET)).toBe(true);
    const { bytes: out, warnings } = await save(bytes, (s) => [
      redaction(s.pages[0]!.id, area),
    ]);
    expect(warnings).toEqual([]);
    const text = await pageText(out);
    expect(text).toContain("Cuenta");
    expect(text).toContain("Banco");
    expect(text).toContain("Otra linea intacta");
    expect(text).not.toMatch(/4711|0815/);
    for (const part of [SECRET, "4711", "0815"])
      expect(await fileContains(out, part)).toBe(false);
    // The words around keep their position.
    const page = await renderPage(out);
    const black = page.toPixel(area.x + area.width / 2, area.y + 6);
    const k = (Math.round(black.y) * page.width + Math.round(black.x)) * 4;
    expect([...page.data.subarray(k, k + 3)]).toEqual([0, 0, 0]);
    if (qpdfPath) await qpdfCheck(out);
  });

  it("removes text added or edited in the editor under the area", async () => {
    const { bytes, area } = await textPdf();
    const out = (
      await save(bytes, (s) => [
        {
          kind: "text",
          id: "t1",
          pageId: s.pages[0]!.id,
          at: { x: area.x, y: 120 },
          text: "Nuevo 5566",
          style: {
            font: "Helvetica",
            size: 12,
            color: "#000000",
            bold: false,
            italic: false,
            lineHeight: 1.2,
          },
          rotate: 0,
        },
        redaction(s.pages[0]!.id, { ...area, y: 116, height: 14 }),
      ])
    ).bytes;
    expect(await pageText(out)).toContain(SECRET);
    expect(await pageText(out)).not.toContain("5566");
    expect(await fileContains(out, "5566")).toBe(false);
  });

  it("only marks: nothing is removed and the user is warned", async () => {
    const { bytes, area } = await textPdf();
    const { bytes: out, warnings } = await save(bytes, (s) => [
      redaction(s.pages[0]!.id, area, { applied: false }),
    ]);
    expect(await pageText(out)).toContain(SECRET);
    expect(warnings.join(" ")).toMatch(/sin aplicar/);
  });

  it("removes invisible text (an OCR layer) and alternate text", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([400, 300]);
    page.drawText("visible", { x: 50, y: 250, size: 12, font });
    const fontName = page.node
      .normalizedEntries()
      .Resources.lookup(PDFName.of("Font"), PDFDict)
      .keys()[0]!
      .decodeText();
    const hex = Buffer.from(SECRET, "latin1").toString("hex");
    const content = doc.context.stream(
      `/Span <</ActualText (${SECRET})>> BDC BT 3 Tr /${fontName} 12 Tf 50 200 Td <${hex}> Tj ET EMC`,
    );
    page.node.addContentStream(doc.context.register(content));
    const bytes = await doc.save();
    expect(await pageText(bytes)).toContain(SECRET);
    const out = (
      await save(bytes, (s) => [
        redaction(s.pages[0]!.id, { x: 45, y: 195, width: 80, height: 16 }),
      ])
    ).bytes;
    expect(await pageText(out)).toContain("visible");
    expect(await fileContains(out, SECRET)).toBe(false);
  });

  it("copies a shared form: the other page keeps its text", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const p1 = doc.addPage([400, 300]);
    const p2 = doc.addPage([400, 300]);
    p1.drawText(" ", { x: 0, y: 0, size: 1, font }); // registers the font
    const fontRef = p1.node
      .normalizedEntries()
      .Resources.lookup(PDFName.of("Font"), PDFDict);
    const hex = Buffer.from(`Nota ${SECRET}`, "latin1").toString("hex");
    const form = doc.context.stream(`BT /F 12 Tf 50 200 Td <${hex}> Tj ET`, {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, 400, 300],
      Resources: { Font: { F: fontRef.values()[0]! } },
    });
    const formRef = doc.context.register(form);
    for (const page of [p1, p2]) {
      const name = page.node.newXObject("Fm", formRef);
      page.node.addContentStream(
        doc.context.register(doc.context.stream(`q ${name} Do Q`)),
      );
    }
    const bytes = await doc.save();
    const out = (
      await save(bytes, (s) => [
        redaction(s.pages[0]!.id, { x: 80, y: 195, width: 80, height: 16 }),
      ])
    ).bytes;
    expect(await pageText(out, 1)).toContain("Nota");
    expect(await pageText(out, 1)).not.toContain("4711");
    expect(await pageText(out, 2)).toContain(`Nota ${SECRET}`);
  });

  it("overwrites the pixels of a Flate image with a PNG predictor", async () => {
    const W = 20;
    const H = 10;
    // Gray image, value 200, rows filtered with PNG "Sub" (Predictor 15).
    const rows: number[] = [];
    for (let y = 0; y < H; y++) {
      rows.push(1);
      for (let x = 0; x < W; x++) rows.push(x === 0 ? 200 : 0);
    }
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    const image = doc.context.flateStream(Uint8Array.from(rows), {
      Type: "XObject",
      Subtype: "Image",
      Width: W,
      Height: H,
      ColorSpace: "DeviceGray",
      BitsPerComponent: 8,
      DecodeParms: {
        Predictor: 15,
        Colors: 1,
        BitsPerComponent: 8,
        Columns: W,
      },
    });
    const name = page.node.newXObject("Im", doc.context.register(image));
    // 200 × 100 points at (100, 100): one pixel is 10 points.
    page.node.addContentStream(
      doc.context.register(
        doc.context.stream(`q 200 0 0 100 100 100 cm ${name} Do Q`),
      ),
    );
    const bytes = await doc.save();
    // Left half of the image, top 3 rows.
    const out = (
      await save(bytes, (s) => [
        redaction(s.pages[0]!.id, { x: 100, y: 170, width: 100, height: 30 }),
      ])
    ).bytes;
    const saved = await PDFDocument.load(out);
    const images = imagesOf(saved.getPage(0));
    expect(images).toHaveLength(1);
    const samples = decodePDFRawStream(images[0]! as PDFRawStream).decode();
    expect(samples).toHaveLength(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        expect([x, y, samples[y * W + x]]).toEqual([
          x,
          y,
          x < 10 && y < 3 ? 0 : 200,
        ]);
    // The original image object is not in the file anymore.
    let count = 0;
    for (const [, obj] of saved.context.enumerateIndirectObjects())
      if (
        obj instanceof PDFStream &&
        obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
      )
        count++;
    expect(count).toBe(1);
  });

  it("redacts a JPEG and the soft mask of a PNG", async () => {
    const canvas = createCanvas(40, 40);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 40, 40);
    const jpeg = new Uint8Array(await canvas.encode("jpeg", 95));
    ctx.clearRect(0, 0, 40, 40);
    ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    ctx.fillRect(0, 0, 40, 40);
    const png = new Uint8Array(await canvas.encode("png"));
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 300]);
    page.drawImage(await doc.embedJpg(jpeg), {
      x: 0,
      y: 0,
      width: 40,
      height: 40,
    });
    page.drawImage(await doc.embedPng(png), {
      x: 100,
      y: 0,
      width: 40,
      height: 40,
    });
    const bytes = await doc.save();
    const out = (
      await save(bytes, (s) => [
        redaction(s.pages[0]!.id, { x: 0, y: 20, width: 20, height: 20 }),
        redaction(s.pages[0]!.id, { x: 100, y: 20, width: 20, height: 20 }),
      ])
    ).bytes;
    const saved = await PDFDocument.load(out);
    const [first, second] = imagesOf(saved.getPage(0));
    // JPEG: top-left quarter black, the rest white.
    const decoded = await codec.decodeJpeg((first as PDFRawStream).contents);
    const at = (x: number, y: number) => decoded.data[(y * 40 + x) * 4]!;
    expect(at(5, 5)).toBeLessThan(30);
    expect(at(35, 35)).toBeGreaterThan(225);
    // PNG: its alpha (the soft mask) is cleared in the top-left quarter too.
    const smask = (second as PDFStream).dict.lookup(PDFName.of("SMask"));
    expect(smask).toBeInstanceOf(PDFRawStream);
    const alpha = decodePDFRawStream(smask as PDFRawStream).decode();
    expect(alpha[5 * 40 + 5]).toBe(0);
    expect(alpha[35 * 40 + 35]).toBeGreaterThan(100);
  });

  it("removes paths inside the area and keeps those that cross it", async () => {
    const { bytes, area } = await textPdf((page) => {
      page.drawRectangle({ x: 150, y: 198, width: 10, height: 8 });
      page.drawLine({ start: { x: 10, y: 202 }, end: { x: 390, y: 202 } });
    });
    const out = (
      await save(bytes, (s) => [
        redaction(s.pages[0]!.id, { ...area, x: 100, width: 100 }),
      ])
    ).bytes;
    const saved = await PDFDocument.load(out);
    const content = Buffer.from(
      decodePDFRawStream(
        saved.context.lookup(
          (saved.getPage(0).node.Contents() as PDFArray).get(0),
        ) as PDFRawStream,
      ).decode(),
    ).toString("latin1");
    expect(content).not.toMatch(/150 198 10 8 re/);
    expect(content).toMatch(/10 202 m/);
  });

  it("removes annotations, popups and form fields under the area", async () => {
    const { bytes } = await textPdf((page, doc) => {
      const popup = doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Popup",
          Rect: [300, 200, 380, 260],
        }),
      );
      const note = doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Text",
          Rect: [60, 100, 80, 120],
          Contents: PDFString.of("Nota 9988"),
          Popup: popup,
        }),
      );
      (doc.context.lookup(popup) as PDFDict).set(PDFName.of("Parent"), note);
      page.node.addAnnot(note);
      page.node.addAnnot(popup);
      page.node.addAnnot(
        doc.context.register(
          doc.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [300, 20, 380, 40],
            Contents: PDFHexString.fromText("Enlace"),
          }),
        ),
      );
      const field = doc.getForm().createTextField("cuenta");
      field.setText("5522-0011");
      field.addToPage(page, { x: 60, y: 40, width: 120, height: 20 });
    });
    for (const secret of ["Nota 9988", "5522-0011"])
      expect(await fileContains(bytes, secret)).toBe(true);
    const out = (
      await save(bytes, (s) => [
        redaction(s.pages[0]!.id, { x: 50, y: 30, width: 150, height: 100 }),
      ])
    ).bytes;
    for (const secret of ["Nota 9988", "5522-0011"])
      expect(await fileContains(out, secret)).toBe(false);
    const saved = await PDFDocument.load(out);
    const annots = saved.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray);
    expect(annots.size()).toBe(1);
    expect(saved.getForm().getFields()).toHaveLength(0);
  });

  it("clears the metadata only when asked", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle(`Informe ${SECRET}`);
    doc.setAuthor("Ana Perez");
    doc.addPage([400, 300]);
    const bytes = await doc.save();
    const area = { x: 10, y: 10, width: 10, height: 10 };
    const kept = (await save(bytes, (s) => [redaction(s.pages[0]!.id, area)]))
      .bytes;
    expect((await PDFDocument.load(kept)).getTitle()).toBe(`Informe ${SECRET}`);
    const cleared = (
      await save(bytes, (s) => [
        redaction(s.pages[0]!.id, area, { clearMetadata: true }),
      ])
    ).bytes;
    const reloaded = await PDFDocument.load(cleared, { updateMetadata: false });
    expect(reloaded.getTitle()).toBeUndefined();
    expect(reloaded.getAuthor()).toBeUndefined();
    expect(await fileContains(cleared, SECRET)).toBe(false);
    expect(await fileContains(cleared, "Ana Perez")).toBe(false);
  });

  it("does not keep deleted pages or old streams in the file", async () => {
    const { bytes, area } = await textPdf();
    const doc = await PDFDocument.load(bytes);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc
      .addPage([400, 300])
      .drawText("pagina borrada 9999", { x: 50, y: 50, font });
    const two = await doc.save();
    const state = await stateFor(two);
    const out = (
      await applyEdits(
        two,
        {
          pages: [state.pages[0]!],
          items: [redaction(state.pages[0]!.id, area)],
        },
        deps,
      )
    ).bytes;
    expect(await fileContains(out, "9999")).toBe(false);
    expect(await fileContains(out, SECRET)).toBe(false);
  });

  it("redacts a scanned page: pixels and recognized words", async () => {
    const width = 80;
    const height = 40;
    // 1 bit per pixel, 1 = white: all black, so cleared pixels stay black too.
    const data = new Uint8Array((width / 8) * height).fill(0xff);
    const state: EditorState = {
      pages: [
        {
          id: "s1",
          source: {
            kind: "scan",
            image: { format: "bw", data, width, height },
          },
          box: [0, 0, 400, 200],
          baseRotation: 0,
          extraRotation: 0,
        },
      ],
      items: [
        {
          kind: "ocr",
          id: "o1",
          pageId: "s1",
          lang: "spa",
          rotate: 0,
          lines: [
            {
              at: { x: 20, y: 100 },
              width: 300,
              height: 20,
              words: [
                {
                  at: { x: 20, y: 100 },
                  width: 100,
                  height: 20,
                  text: "Cuenta",
                  confidence: 90,
                },
                {
                  at: { x: 140, y: 100 },
                  width: 120,
                  height: 20,
                  text: SECRET,
                  confidence: 90,
                },
              ],
            },
          ],
        },
        redaction("s1", { x: 135, y: 95, width: 130, height: 30 }),
      ],
    };
    const out = (await applyEdits(new Uint8Array(), state, deps)).bytes;
    const text = await pageText(out);
    expect(text).toContain("Cuenta");
    expect(text).not.toContain("4711");
    const saved = await PDFDocument.load(out);
    const [scan] = imagesOf(saved.getPage(0));
    const bits = decodePDFRawStream(scan as PDFRawStream).decode();
    // Pixel (35, 20) is under the area: 5 points per pixel, row 0 at the top.
    const bit = (x: number, y: number) =>
      (bits[y * (width / 8) + (x >> 3)]! >> (7 - (x % 8))) & 1;
    expect(bit(35, 20)).toBe(0);
    expect(bit(5, 5)).toBe(1);
  });

  it("decodes predictors and clears bit ranges", () => {
    // PNG "Up" over two rows of 3 bytes.
    const up = unpredict(
      Uint8Array.from([0, 1, 2, 3, 2, 1, 1, 1]),
      { predictor: 12, colors: 1, bpc: 8, columns: 3 },
      3,
    );
    expect([...up!]).toEqual([1, 2, 3, 2, 3, 4]);
    const tiff = unpredict(
      Uint8Array.from([10, 1, 1, 5, 5, 5]),
      { predictor: 2, colors: 1, bpc: 8, columns: 3 },
      3,
    );
    expect([...tiff!]).toEqual([10, 11, 12, 5, 10, 15]);
    const bytes = Uint8Array.from([0xff, 0xff, 0xff]);
    clearBits(bytes, 3, 19);
    expect([...bytes]).toEqual([0xe0, 0x00, 0x1f]);
  });
});

/** Image XObjects drawn by the page, in resource order. */
function imagesOf(page: PDFPage): PDFStream[] {
  const xobjects = page.node
    .normalizedEntries()
    .Resources.lookup(PDFName.of("XObject"), PDFDict);
  return xobjects
    .values()
    .map((v) => page.doc.context.lookup(v))
    .filter(
      (s): s is PDFStream =>
        s instanceof PDFStream &&
        s.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    );
}
