// A two-page PDF whose pages are only grey, slightly noisy images of text
// (spec 003 and 010). Page 2 adds a smudged line near the bottom, for
// low-confidence words.
import { createCanvas } from "@napi-rs/canvas";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { rng, testPage } from "../tests/scan/synthPhoto";

const PPI = 200;

/** Writes the PDF to a temporary folder and returns its path. */
export async function writeScannedPdf(): Promise<string> {
  const page = testPage(PPI);
  const { width, height, data } = page.page;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  const next = rng(3);
  for (let i = 0; i < data.length; i++) {
    const v = data[i]! * 0.85 + 25 + (next() - 0.5) * 16;
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  const clean = canvas.toBuffer("image/jpeg", 85);
  const k = PPI / 72;
  ctx.fillStyle = "rgb(150,150,150)";
  ctx.font = `${7 * k}px Arimo`;
  ctx.filter = `blur(${1.2 * k}px)`;
  ctx.fillText("Mancha ilegible qzx borrosa wkj", 56 * k, 800 * k);
  const smudged = canvas.toBuffer("image/jpeg", 85);
  const pdf = await PDFDocument.create();
  for (const jpeg of [clean, smudged])
    pdf
      .addPage([page.widthPt, page.heightPt])
      .drawImage(await pdf.embedJpg(jpeg), {
        x: 0,
        y: 0,
        width: page.widthPt,
        height: page.heightPt,
      });
  const dir = await mkdtemp(join(tmpdir(), "pdfcraft-ocr-"));
  const path = join(dir, "escaneado.pdf");
  await writeFile(path, await pdf.save());
  return path;
}
