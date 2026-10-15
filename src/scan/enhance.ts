/**
 * Enhancement modes (spec 002, HU5–HU7): original colour, greyscale and the
 * black-and-white "photocopy". The photocopy first divides the image by an
 * estimate of the paper (which removes shadows and grey paper) and then
 * applies a local adaptive threshold computed with a summed-area table.
 */
import {
  areaMean,
  blur,
  gray,
  integral,
  rankFilter,
  resize,
  rotatePixels,
  shrink,
  toGray,
  type Gray,
  type Rgba,
} from "./image";

export type ScanMode = "original" | "gray" | "bw";

/** 1 bit per pixel, rows padded to whole bytes, most significant bit first; 1 = white (as in a PDF DeviceGray image). */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

export const rowBytes = (width: number) => Math.ceil(width / 8);

/** Brightness of the paper at each pixel (text removed). */
export function paperLevel(src: Gray): Gray {
  const factor = 8;
  const sw = Math.max(1, Math.round(src.width / factor));
  const sh = Math.max(1, Math.round(src.height / factor));
  const small = shrink(src, sw, sh);
  // Closing with a window larger than the strokes: bright paper wins.
  const radius = Math.max(3, Math.round(Math.min(sw, sh) / 40));
  const closed = rankFilter(rankFilter(small, radius, true), radius, false);
  return resize(blur(closed, radius / 2), src.width, src.height);
}

/** Grey image with the paper normalised to white. */
export function normalize(src: Gray): Gray {
  const paper = paperLevel(src);
  const out = gray(src.width, src.height);
  for (let i = 0; i < out.data.length; i++)
    out.data[i] = Math.min(
      255,
      (src.data[i]! / Math.max(1, paper.data[i]!)) * 255,
    );
  return out;
}

export interface PhotocopyOptions {
  /** Window of the local mean, as a share of the short side. */
  window?: number;
  /** A pixel is ink when it is this much darker than its neighbourhood. */
  k?: number;
  /** And darker than this absolute level (after normalisation). */
  ceiling?: number;
  /** Always ink below this level (keeps large dark areas solid). */
  floor?: number;
}

/** Black-and-white photocopy of a rectified page. */
export function photocopy(image: Rgba, options: PhotocopyOptions = {}): Bitmap {
  return photocopyGray(toGray(image), options);
}

/** The photocopy of a greyscale page (OCR prepares its own grey first). */
export function photocopyGray(
  source: Gray,
  options: PhotocopyOptions = {},
): Bitmap {
  const v = normalize(source);
  const { width: w, height: h } = v;
  const table = integral(v);
  const half = Math.max(
    4,
    Math.round((Math.min(w, h) * (options.window ?? 1 / 24)) / 2),
  );
  const k = options.k ?? 0.15;
  const ceiling = options.ceiling ?? 215;
  const floor = options.floor ?? 100;
  const stride = rowBytes(w);
  const data = new Uint8Array(stride * h).fill(0xff);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const value = v.data[y * w + x]!;
      if (value >= ceiling) continue;
      if (value < floor) {
        data[y * stride + (x >> 3)]! &= ~(0x80 >> (x & 7));
        continue;
      }
      const mean = areaMean(
        table,
        w,
        Math.max(0, x - half),
        y0,
        Math.min(w, x + half + 1),
        y1,
      );
      if (value < mean * (1 - k))
        data[y * stride + (x >> 3)]! &= ~(0x80 >> (x & 7));
    }
  }
  return { width: w, height: h, data };
}

/** Greyscale of a rectified page: paper normalised, contrast stretched slightly. */
export function grayscale(image: Rgba): Gray {
  const v = normalize(toGray(image));
  // Stretch so that the darkest 1% is black.
  const hist = new Uint32Array(256);
  for (const value of v.data)
    hist[Math.min(255, Math.max(0, Math.round(value)))]!++;
  let seen = 0;
  let low = 0;
  for (; low < 255; low++) {
    seen += hist[low]!;
    if (seen >= v.data.length * 0.01) break;
  }
  const scale = 255 / Math.max(1, 255 - low);
  for (let i = 0; i < v.data.length; i++)
    v.data[i] = Math.min(255, Math.max(0, (v.data[i]! - low) * scale));
  return v;
}

/** Bitmap → RGBA (for previews). */
export function bitmapToRgba(bitmap: Bitmap): Rgba {
  const { width: w, height: h } = bitmap;
  const stride = rowBytes(w);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const on = bitmap.data[y * stride + (x >> 3)]! & (0x80 >> (x & 7));
      const o = (y * w + x) * 4;
      const c = on ? 255 : 0;
      out[o] = out[o + 1] = out[o + 2] = c;
      out[o + 3] = 255;
    }
  return { width: w, height: h, data: out };
}

/** Grey → RGBA (for previews and JPEG encoding). */
export function grayToRgba(src: Gray): Rgba {
  const out = new Uint8ClampedArray(src.width * src.height * 4);
  for (let i = 0; i < src.data.length; i++) {
    const c = src.data[i]!;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = c;
    out[i * 4 + 3] = 255;
  }
  return { width: src.width, height: src.height, data: out };
}

/** Rotates a page image by quarter turns clockwise, without resampling. */
export function rotateRgba(image: Rgba, quarters: number): Rgba {
  return rotatePixels(image.data, image.width, image.height, 4, quarters);
}
