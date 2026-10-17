// A PDF that hides a bit of everything, for the privacy x-ray (spec 015).
import { createCanvas } from "@napi-rs/canvas";
import {
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFString,
  StandardFonts,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setTextRenderingMode,
  type PDFPage,
} from "pdf-lib";

const encoder = new TextEncoder();

function invisible(page: PDFPage, draw: () => void) {
  page.pushOperators(pushGraphicsState(), setTextRenderingMode(3));
  draw();
  page.pushOperators(popGraphicsState());
}

/** A PDF that hides a bit of everything (CA3–CA12). */
export async function leaky(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle("Contrato de alquiler");
  doc.setAuthor("Ana Secreta");
  doc.setKeywords(["borrador", "interno"]);
  doc.setProducer("Programa X 1.0");
  await doc.attach(encoder.encode("nombre;salario\nAna;3000"), "nomina.csv", {
    mimeType: "text/csv",
  });
  doc.addJavaScript("saludo", "app.alert('hola');");
  doc.catalog.set(
    PDFName.of("PieceInfo"),
    doc.context.obj({ Illustrator: { Private: "datos" } }),
  );

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText("Contrato visible", { x: 72, y: 760, size: 18, font });
  page.drawText("TEXTO BLANCO OCULTO", {
    x: 72,
    y: 700,
    size: 12,
    font,
    color: rgb(1, 1, 1),
  });
  invisible(page, () =>
    page.drawText("INVISIBLE SECRETO", { x: 72, y: 680, size: 12, font }),
  );
  page.drawText("MINI", { x: 72, y: 660, size: 0.5, font });
  page.drawText("FUERA DE LA HOJA", { x: -500, y: 640, size: 12, font });
  // White text on a dark banner is meant to be seen.
  page.drawRectangle({
    x: 60,
    y: 590,
    width: 300,
    height: 30,
    color: rgb(0.1, 0.1, 0.3),
  });
  page.drawText("Titulo en banner", {
    x: 72,
    y: 600,
    size: 14,
    font,
    color: rgb(1, 1, 1),
  });
  // A scanned image with its OCR text layer.
  const canvas = createCanvas(40, 20);
  canvas.getContext("2d").fillRect(0, 0, 40, 20);
  const image = await doc.embedPng(canvas.toBuffer("image/png"));
  page.drawImage(image, { x: 72, y: 400, width: 200, height: 100 });
  invisible(page, () =>
    page.drawText("capa ocr", { x: 80, y: 440, size: 12, font }),
  );

  // A hidden layer.
  const layer = doc.context.register(
    doc.context.obj({ Type: "OCG", Name: PDFString.of("Borrador") }),
  );
  doc.catalog.set(
    PDFName.of("OCProperties"),
    doc.context.obj({ OCGs: [layer], D: { OFF: [layer] } }),
  );
  const resources = page.node.Resources()!;
  resources.set(PDFName.of("Properties"), doc.context.obj({ oc1: layer }));
  page.pushOperators(
    PDFOperator.of("BDC" as never, [PDFName.of("OC"), PDFName.of("oc1")]),
  );
  page.drawText("CAPA OCULTA", { x: 72, y: 300, size: 12, font });
  page.pushOperators(PDFOperator.of("EMC" as never));

  // A link, a comment with its author, a thumbnail.
  const annots = doc.context.obj([
    doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [72, 750, 200, 780],
      A: { S: "URI", URI: PDFString.of("https://www.ejemplo.com/ruta?id=7") },
    }),
    doc.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [400, 700, 420, 720],
      Contents: PDFString.of("Revisar cláusula"),
      T: PDFString.of("Pedro Revisor"),
    }),
  ]);
  page.node.set(PDFName.of("Annots"), annots);
  page.node.set(
    PDFName.of("Thumb"),
    doc.context.register(doc.context.stream("thumbnail", {})),
  );
  return withUpdate(await doc.save({ useObjectStreams: false }));
}

/** Appends an incremental update that changes the title. */
function withUpdate(bytes: Uint8Array): Uint8Array {
  const text = new TextDecoder("latin1").decode(bytes);
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(text)![1]);
  const size = Number(/\/Size (\d+)/.exec(text)![1]);
  const root = /\/Root (\d+ \d+ R)/.exec(text)![1];
  const head = `${text}\n`;
  const obj = `${size} 0 obj\n<< /Title (Contrato final) /Author (Ana Secreta) >>\nendobj\n`;
  const xrefAt = head.length + obj.length;
  const tail =
    `xref\n${size} 1\n${String(head.length).padStart(10, "0")} 00000 n \n` +
    `trailer\n<< /Size ${size + 1} /Root ${root} /Info ${size} 0 R /Prev ${prev} >>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;
  return Uint8Array.from(head + obj + tail, (c) => c.charCodeAt(0));
}
