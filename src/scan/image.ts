/**
 * Image primitives for the scanner (spec 002). Plain typed arrays so the same
 * code runs in a Web Worker and in Node tests.
 */

/** One channel, values 0–255 (floating point while processing). */
export interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}

/** RGBA, 8 bits per channel (the layout of ImageData). */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function gray(width: number, height: number): Gray {
  return { width, height, data: new Float32Array(width * height) };
}

/** Luminance (BT.601) of an RGBA image. */
export function toGray(image: Rgba): Gray {
  const out = gray(image.width, image.height);
  const src = image.data;
  for (let i = 0, j = 0; j < out.data.length; i += 4, j++)
    out.data[j] = 0.299 * src[i]! + 0.587 * src[i + 1]! + 0.114 * src[i + 2]!;
  return out;
}

/** Size that fits `maxSide` keeping the aspect ratio (never enlarges). */
export function fitSize(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/** Downscale by area averaging (good for shrinking; use `resize` to enlarge). */
export function shrink(src: Gray, width: number, height: number): Gray {
  const out = gray(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(
        x0 + 1,
        Math.min(src.width, Math.floor((x + 1) * sx)),
      );
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) {
        const row = yy * src.width;
        for (let xx = x0; xx < x1; xx++) sum += src.data[row + xx]!;
      }
      out.data[y * width + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

/** Bilinear sample at (x, y), pixel centres at integer + 0.5; clamps at edges. */
export function sample(src: Gray, x: number, y: number): number {
  const fx = Math.min(Math.max(x - 0.5, 0), src.width - 1);
  const fy = Math.min(Math.max(y - 0.5, 0), src.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, src.width - 1);
  const y1 = Math.min(y0 + 1, src.height - 1);
  const ax = fx - x0;
  const ay = fy - y0;
  const d = src.data;
  const w = src.width;
  const top = d[y0 * w + x0]! * (1 - ax) + d[y0 * w + x1]! * ax;
  const bottom = d[y1 * w + x0]! * (1 - ax) + d[y1 * w + x1]! * ax;
  return top * (1 - ay) + bottom * ay;
}

/** Bilinear resize (for enlarging smooth images such as a background estimate). */
export function resize(src: Gray, width: number, height: number): Gray {
  const out = gray(width, height);
  const sx = src.width / width;
  const sy = src.height / height;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      out.data[y * width + x] = sample(src, (x + 0.5) * sx, (y + 0.5) * sy);
  return out;
}

function kernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i]! /= sum;
  return k;
}

/** Separable Gaussian blur; edges are clamped. */
export function blur(src: Gray, sigma: number): Gray {
  if (sigma <= 0) return { ...src, data: src.data.slice() };
  const k = kernel(sigma);
  const r = (k.length - 1) / 2;
  const { width: w, height: h } = src;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        s += src.data[y * w + xx]! * k[i + r]!;
      }
      tmp[y * w + x] = s;
    }
  const out = gray(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        s += tmp[yy * w + x]! * k[i + r]!;
      }
      out.data[y * w + x] = s;
    }
  return out;
}

/** Separable max (dilate) or min (erode) filter with a square window. */
export function rankFilter(src: Gray, radius: number, max: boolean): Gray {
  const { width: w, height: h } = src;
  const pick = max ? Math.max : Math.min;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = src.data[y * w + x]!;
      for (
        let i = Math.max(0, x - radius);
        i <= Math.min(w - 1, x + radius);
        i++
      )
        v = pick(v, src.data[y * w + i]!);
      tmp[y * w + x] = v;
    }
  const out = gray(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x]!;
      for (
        let i = Math.max(0, y - radius);
        i <= Math.min(h - 1, y + radius);
        i++
      )
        v = pick(v, tmp[i * w + x]!);
      out.data[y * w + x] = v;
    }
  return out;
}

/** Summed-area table, (width + 1) × (height + 1). */
export function integral(src: Gray): Float64Array {
  const { width: w, height: h } = src;
  const out = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src.data[y * w + x]!;
      out[(y + 1) * (w + 1) + x + 1] = out[y * (w + 1) + x + 1]! + row;
    }
  }
  return out;
}

/** Mean of [x0, x1) × [y0, y1) from a summed-area table. */
export function areaMean(
  table: Float64Array,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const s = width + 1;
  const sum =
    table[y1 * s + x1]! -
    table[y0 * s + x1]! -
    table[y1 * s + x0]! +
    table[y0 * s + x0]!;
  return sum / ((x1 - x0) * (y1 - y0));
}

/**
 * Rotates pixels by `quarters` × 90° clockwise. `channels` values per pixel.
 */
export function rotatePixels<T extends Float32Array | Uint8ClampedArray>(
  data: T,
  width: number,
  height: number,
  channels: number,
  quarters: number,
): { data: T; width: number; height: number } {
  const q = ((quarters % 4) + 4) % 4;
  if (q === 0) return { data: data.slice() as T, width, height };
  const ow = q === 2 ? width : height;
  const oh = q === 2 ? height : width;
  const out = new (data.constructor as new (n: number) => T)(data.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let nx: number;
      let ny: number;
      if (q === 1) {
        nx = height - 1 - y;
        ny = x;
      } else if (q === 2) {
        nx = width - 1 - x;
        ny = height - 1 - y;
      } else {
        nx = y;
        ny = width - 1 - x;
      }
      const si = (y * width + x) * channels;
      const di = (ny * ow + nx) * channels;
      for (let c = 0; c < channels; c++) out[di + c] = data[si + c]!;
    }
  return { data: out, width: ow, height: oh };
}
