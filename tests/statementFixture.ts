// Synthetic "account statement" page that mimics what web-to-PDF producers
// write (spec 001, phase 6, T032): Type0/Identity-H subsets of one font split
// in two subset objects, navy text whose color is set outside BT/ET, an
// ExtGState, text scaled through Tm with Tf 1, a line split in two text
// objects, TJ kerning, and text over a colored band and over an image.
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName } from "pdf-lib";
import { SubstituteFont } from "../src/engine/substituteFont";
import { bundledFontPath } from "./helpers";

export const NAVY = "#1a3373";
export const BAND = "#e8f0fe";

export interface StatementOptions {
  /** Leave out the text drawn over the image (reference for background tests). */
  withoutImageText?: boolean;
}

/** Text of each line, top to bottom. */
export const LINES = {
  opening: "Saldo inicial a fecha de 1 abr 2026",
  activity: "Total de actividades nuevas",
  fees: "QUIZ: Comisiones 0,00",
  payments: "Pagos recibidos -25,00",
};

export async function buildStatement(
  options: StatementOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([595.28, 841.89]);
  const bold = await readFile(bundledFontPath("Arimo", "Bold"));
  const regular = await readFile(bundledFontPath("Arimo", "Regular"));
  // Two subsets of the same bold font, as some producers write them.
  const boldA = new SubstituteFont(doc, "Arimo", "Bold", bold);
  const boldB = new SubstituteFont(doc, "Arimo", "Bold", bold);
  const body = new SubstituteFont(doc, "Arimo", "Regular", regular);
  const hex = (font: SubstituteFont, text: string) =>
    font.encode(text).toString();

  // A small vertical gradient image.
  const w = 64;
  const h = 16;
  const pixels = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      pixels[i] = 200 - y * 4;
      pixels[i + 1] = 230 - x;
      pixels[i + 2] = 180 + y * 3;
    }
  const image = doc.context.register(
    doc.context.flateStream(pixels, {
      Type: "XObject",
      Subtype: "Image",
      Width: w,
      Height: h,
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
    }),
  );
  const gs = doc.context.register(
    doc.context.obj({ Type: "ExtGState", ca: 1, CA: 1 }),
  );
  page.node.set(
    PDFName.of("Resources"),
    doc.context.obj({
      Font: { FA: boldA.ref, FB: boldB.ref, FR: body.ref },
      XObject: { Im1: image },
      ExtGState: { GS1: gs },
    }),
  );

  const content = [
    // Colored band behind the first two lines.
    "0.9098 0.9412 0.9961 rg 40 600 515 48 re f",
    // Image behind the last line.
    "q 515 22 0 0 40 528 cm /Im1 Do Q",
    // Navy, bold; color set outside BT, as many producers do.
    "/GS1 gs 0.102 0.2 0.451 rg",
    // Opening balance: one line in two text objects, scaled through Tm.
    `BT /FA 1 Tf 10.5 0 0 10.5 56 628 Tm ${hex(boldA, "Saldo inicial a fecha de ")} Tj ET`,
    `BT /FA 1 Tf 10.5 0 0 10.5 ${(56 + boldA.widthOf("Saldo inicial a fecha de ") * 10.5).toFixed(4)} 628 Tm [${hex(boldA, "1 ")} -20 ${hex(boldA, "abr 2026")}] TJ ET`,
    `BT /FA 10.5 Tf 56 610 Td [${hex(boldA, "To")} 30 ${hex(boldA, "tal de actividades nuevas")}] TJ ET`,
    // Glyphs only in the second subset.
    `BT /FB 10.5 Tf 56 580 Td ${hex(boldB, "QUIZ: Comisiones 0,00")} Tj ET`,
    // Regular black text over the image.
    ...(options.withoutImageText
      ? []
      : [
          `0 g BT /FR 10.5 Tf 56 533 Td ${hex(body, "Pagos recibidos -25,00")} Tj ET`,
        ]),
  ].join("\n");
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(doc.context.flateStream(content)),
  );
  boldA.embed(doc);
  boldB.embed(doc);
  body.embed(doc);
  return doc.save({ useObjectStreams: false });
}
