// Renders PDF pages with pdf.js in Node (@napi-rs/canvas) for pixel checks.
import { createCanvas } from "@napi-rs/canvas";
import type { Rect } from "../src/model/geometry";
import { openPdf } from "./helpers";

export const SCALE = 2;

export interface Rendered {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** PDF user space → pixel. */
  toPixel(x: number, y: number): { x: number; y: number };
}

export async function renderPage(
  bytes: Uint8Array,
  pageNumber = 1,
): Promise<Rendered> {
  const doc = await openPdf(bytes);
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  const context = canvas.getContext("2d");
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const [a, b, c, d, e, f] = viewport.transform as number[];
  await doc.loadingTask.destroy();
  return {
    data: image.data,
    width: image.width,
    height: image.height,
    toPixel: (x, y) => ({
      x: a! * x + c! * y + e!,
      y: b! * x + d! * y + f!,
    }),
  };
}

/** Pixel bounds of a user-space rectangle. */
export function pixelBox(r: Rendered, area: Rect) {
  const p = r.toPixel(area.x, area.y);
  const q = r.toPixel(area.x + area.width, area.y + area.height);
  return {
    left: Math.max(0, Math.floor(Math.min(p.x, q.x))),
    right: Math.min(r.width, Math.ceil(Math.max(p.x, q.x))),
    top: Math.max(0, Math.floor(Math.min(p.y, q.y))),
    bottom: Math.min(r.height, Math.ceil(Math.max(p.y, q.y))),
  };
}

/** Share of the pixels of `area` where `a` and `b` differ by more than `threshold`. */
export function diffShare(
  a: Rendered,
  b: Rendered,
  area: Rect,
  threshold = 48,
): number {
  const { left, right, top, bottom } = pixelBox(a, area);
  let differ = 0;
  let total = 0;
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const i = (y * a.width + x) * 4;
      total++;
      for (let k = 0; k < 3; k++)
        if (Math.abs(a.data[i + k]! - b.data[i + k]!) > threshold) {
          differ++;
          break;
        }
    }
  return total === 0 ? 0 : differ / total;
}

/** Share of the pixels of `area` that are not close to `hex`. */
export function offColorShare(
  r: Rendered,
  area: Rect,
  hex: string,
  threshold = 12,
): number {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const { left, right, top, bottom } = pixelBox(r, area);
  let off = 0;
  let total = 0;
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const i = (y * r.width + x) * 4;
      total++;
      if (rgb.some((v, k) => Math.abs(r.data[i + k]! - v) > threshold)) off++;
    }
  return total === 0 ? 0 : off / total;
}

/** Share of dark ("ink") pixels in `area`. */
export function inkShare(r: Rendered, area: Rect): number {
  const { left, right, top, bottom } = pixelBox(r, area);
  let ink = 0;
  let total = 0;
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const i = (y * r.width + x) * 4;
      total++;
      if (r.data[i]! + r.data[i + 1]! + r.data[i + 2]! < 3 * 160) ink++;
    }
  return total === 0 ? 0 : ink / total;
}
