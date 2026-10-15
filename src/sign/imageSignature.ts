/**
 * A photo or scan of a handwritten signature turned into ink on a transparent
 * background (spec 004, CA3), with the adaptive threshold of spec 002.
 */
import { photocopy } from "../scan/enhance";
import type { Rgba } from "../scan/image";

/** Ink pixels keep their color; paper becomes transparent. Cropped to the ink. */
export function transparentSignature(image: Rgba, pad = 4): Rgba | null {
  const { width, height, data } = image;
  const bitmap = photocopy(image, { window: 1 / 12 });
  const stride = Math.ceil(width / 8);
  const ink = (x: number, y: number) =>
    (bitmap.data[y * stride + (x >> 3)]! & (0x80 >> (x & 7))) === 0;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (ink(x, y)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = x + x0;
      const sy = y + y0;
      if (!ink(sx, sy)) continue;
      const i = (sy * width + sx) * 4;
      const o = (y * w + x) * 4;
      out[o] = data[i]!;
      out[o + 1] = data[i + 1]!;
      out[o + 2] = data[i + 2]!;
      out[o + 3] = 255;
    }
  return { width: w, height: h, data: out };
}
