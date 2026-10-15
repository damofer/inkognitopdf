import {
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFDocument,
  type PDFPage,
  type PDFRef,
} from "pdf-lib";
import type { ScanImage } from "../model/document";
import type { Box } from "../model/geometry";

/**
 * Draws a scanned page image over the whole page box (spec 002, CA8): a JPEG
 * without re-encoding, or a 1-bit image compressed losslessly (Flate).
 */
export async function drawScan(
  doc: PDFDocument,
  page: PDFPage,
  image: ScanImage,
  box: Box,
): Promise<void> {
  let ref: PDFRef;
  if (image.format === "jpeg") ref = (await doc.embedJpg(image.data)).ref;
  else
    ref = doc.context.register(
      doc.context.flateStream(image.data, {
        Type: "XObject",
        Subtype: "Image",
        Width: image.width,
        Height: image.height,
        ColorSpace: "DeviceGray",
        BitsPerComponent: 1,
      }),
    );
  const name = page.node.newXObject("Scan", ref);
  const [x0, y0, x1, y1] = box;
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(x1 - x0, 0, 0, y1 - y0, x0, y0),
    drawObject(name),
    popGraphicsState(),
  );
}
