/**
 * Image clean-up before OCR (spec 003): the page is turned into a
 * black-and-white photocopy (spec 002 filter) and ruling lines (table grids,
 * underlines, frames) are removed, because Tesseract tends to drop the text of
 * a ruled table as soon as the scan is noisy or slightly skewed.
 */
import { photocopy, rowBytes, type Bitmap } from "../scan/enhance";
import type { Rgba } from "../scan/image";

const isInk = (b: Bitmap, x: number, y: number) =>
  !(b.data[y * rowBytes(b.width) + (x >> 3)]! & (0x80 >> (x & 7)));

/**
 * Removes connected ink components that are long (over `minShare` of the page
 * side) and sparse (under `maxDensity` of their bounding box): rules and
 * grids, not letters and not solid blocks.
 */
export function removeRules(
  bitmap: Bitmap,
  minShare = 0.08,
  maxDensity = 0.25,
): Bitmap {
  const { width: w, height: h } = bitmap;
  const stride = rowBytes(w);
  const data = bitmap.data.slice();
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const pixels: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start]) continue;
    const sx = start % w;
    const sy = (start - sx) / w;
    if (!isInk(bitmap, sx, sy)) continue;
    // Flood fill (8-connected), remembering the pixels and the bounds.
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    pixels.length = 0;
    let x0 = sx;
    let x1 = sx;
    let y0 = sy;
    let y1 = sy;
    while (top > 0) {
      const i = stack[--top]!;
      pixels.push(i);
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (seen[j] || !isInk(bitmap, nx, ny)) continue;
          seen[j] = 1;
          stack[top++] = j;
        }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const long = bw > minShare * w || bh > minShare * h;
    if (!long || pixels.length / (bw * bh) >= maxDensity) continue;
    for (const i of pixels) {
      const x = i % w;
      const y = (i - x) / w;
      data[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { width: w, height: h, data };
}

/** The page as Tesseract should see it: black text on white, no rules. */
export function prepareForOcr(page: Rgba): Bitmap {
  return removeRules(photocopy(page));
}
