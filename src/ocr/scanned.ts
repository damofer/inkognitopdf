/**
 * Scanned page detection (spec 003, CA1): almost no text, and images that
 * cover more than half of the page.
 */
import { OPS } from "pdfjs-dist";
import type { PDFPageProxy } from "../viewer/pdfjs";

type Matrix = [number, number, number, number, number, number];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  n[0] * m[0] + n[1] * m[2],
  n[0] * m[1] + n[1] * m[3],
  n[2] * m[0] + n[3] * m[2],
  n[2] * m[1] + n[3] * m[3],
  n[4] * m[0] + n[5] * m[2] + m[4],
  n[4] * m[1] + n[5] * m[3] + m[5],
];

/** Share of the page area covered by images (unit squares under the CTM). */
export async function imageCoverage(page: PDFPageProxy): Promise<number> {
  const list = await page.getOperatorList();
  const [x0, y0, x1, y1] = page.view as [number, number, number, number];
  const pageArea = (x1 - x0) * (y1 - y0);
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  let covered = 0;
  list.fnArray.forEach((fn, i) => {
    const args = list.argsArray[i] as unknown[];
    switch (fn) {
      case OPS.save:
        stack.push(ctm);
        break;
      case OPS.restore:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.transform:
        ctm = multiply(ctm, args as Matrix);
        break;
      case OPS.paintFormXObjectBegin:
        stack.push(ctm);
        if (Array.isArray(args[0])) ctm = multiply(ctm, args[0] as Matrix);
        break;
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() ?? ctm;
        break;
      case OPS.paintImageXObject:
      case OPS.paintInlineImageXObject:
      case OPS.paintImageMaskXObject:
        // Area of the unit square under the CTM.
        covered += Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]);
        break;
    }
  });
  return Math.min(1, covered / pageArea);
}

export async function isScannedPage(page: PDFPageProxy): Promise<boolean> {
  const content = await page.getTextContent();
  const chars = content.items.reduce(
    (n, item) => n + ("str" in item ? item.str.replace(/\s/g, "").length : 0),
    0,
  );
  if (chars >= 5) return false;
  return (await imageCoverage(page)) > 0.5;
}
