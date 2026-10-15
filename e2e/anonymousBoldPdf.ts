// A bold heading set with a subset font whose name and descriptor say nothing
// of its weight ("F", Flags 4, StemV 0), as some producers write it.
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  decodePDFRawStream,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
} from "pdf-lib";

const fontsDir = join(
  import.meta.dirname,
  "..",
  "node_modules",
  "pdfjs-dist",
  "standard_fonts",
);

/** Clears the bold bit of the `head` table (macStyle) of a TrueType program. */
function clearMacStyle(program: Uint8Array) {
  const out = program.slice();
  const view = new DataView(out.buffer);
  const count = view.getUint16(4);
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    if (String.fromCharCode(...out.subarray(rec, rec + 4)) === "head")
      view.setUint16(view.getUint32(rec + 8) + 44, 0);
  }
  return out;
}

/**
 * `program`: whether the embedded font program still says it is bold (in
 * its `head` table). Without it, only the strokes show the weight.
 */
export async function anonymousBoldPdf(program = true): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = async (variant: string) =>
    doc.embedFont(
      await readFile(join(fontsDir, `LiberationSans-${variant}.ttf`)),
      { subset: true },
    );
  const regular = await font("Regular");
  const bold = await font("Bold");
  const page = doc.addPage([595, 842]);
  page.drawText("Resumen de la cuenta", {
    x: 56,
    y: 770,
    size: 18,
    font: bold,
  });
  for (let i = 0; i < 6; i++)
    page.drawText("Texto normal de la cuenta con importes y fechas", {
      x: 56,
      y: 740 - i * 16,
      size: 11,
      font: regular,
    });
  const loaded = await PDFDocument.load(await doc.save());
  for (const [, obj] of loaded.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const type = obj.get(PDFName.of("Type"));
    if (type === PDFName.of("Font"))
      obj.set(PDFName.of("BaseFont"), PDFName.of("AAAAAA+F"));
    if (type !== PDFName.of("FontDescriptor")) continue;
    obj.set(PDFName.of("FontName"), PDFName.of("AAAAAA+F"));
    const ref = obj.get(PDFName.of("FontFile2"));
    const stream = loaded.context.lookup(ref);
    if (
      program ||
      !(ref instanceof PDFRef) ||
      !(stream instanceof PDFRawStream)
    )
      continue;
    const bytes = clearMacStyle(decodePDFRawStream(stream).decode());
    loaded.context.assign(
      ref,
      loaded.context.flateStream(bytes, { Length1: bytes.length }),
    );
  }
  return loaded.save();
}
