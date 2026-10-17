// Synthetic photos for the scanner e2e tests (spec 002), written as JPEG files.
import { createCanvas } from "@napi-rs/canvas";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rotatePixels } from "../src/scan/image";
import {
  synthPhoto,
  testPage,
  type PhotoOptions,
  type TestPage,
} from "../tests/scan/synthPhoto";

function jpeg(width: number, height: number, data: Uint8ClampedArray): Buffer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  image.data.set(data);
  ctx.putImageData(image, 0, 0);
  return canvas.toBuffer("image/jpeg", 90);
}

/** Adds an EXIF APP1 segment with the given orientation after SOI. */
function withOrientation(file: Buffer, orientation: number): Buffer {
  // Big endian TIFF header, one IFD at offset 8 with the Orientation entry
  // (tag 0x0112, SHORT, count 1), and no next IFD.
  const tiff = Buffer.from([
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    orientation,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
  const body = Buffer.concat([
    Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]), // "Exif\0\0"
    tiff,
  ]);
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([file.subarray(0, 2), header, body, file.subarray(2)]);
}

export interface PhotoFiles {
  dir: string;
  path(name: string): string;
}

export async function writePhotos(
  photos: Record<string, PhotoOptions & { exifRotated?: boolean }>,
): Promise<PhotoFiles> {
  const dir = await mkdtemp(join(tmpdir(), "pdfcraft-scan-"));
  const page = testPage(150);
  for (const [name, options] of Object.entries(photos)) {
    const { photo } = synthPhoto({ page, ...options });
    let bytes: Buffer;
    if (options.exifRotated) {
      // Stored turned 90° counter-clockwise; EXIF 6 turns it back.
      const r = rotatePixels(photo.data, photo.width, photo.height, 4, 3);
      bytes = withOrientation(jpeg(r.width, r.height, r.data), 6);
    } else bytes = jpeg(photo.width, photo.height, photo.data);
    await writeFile(join(dir, name), bytes);
  }
  return { dir, path: (name) => join(dir, name) };
}

/**
 * Spec 020: a made-up ID card (85.6 × 53.98 mm, landscape) to photograph:
 * a photo box and lines of text, different on each side.
 */
export function cardPage(side: "front" | "back", ppi = 300): TestPage {
  testPage(10); // registers the fonts
  const widthPt = 242.65;
  const heightPt = 153.01;
  const width = Math.round((widthPt / 72) * ppi);
  const height = Math.round((heightPt / 72) * ppi);
  const pt = ppi / 72;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.font = `${11 * pt}px ArimoBold`;
  ctx.fillText(
    side === "front" ? "DOCUMENTO DE PRUEBA" : "REVERSO DE PRUEBA",
    12 * pt,
    20 * pt,
  );
  ctx.font = `${8 * pt}px Arimo`;
  if (side === "front") {
    ctx.fillStyle = "#555";
    ctx.fillRect(12 * pt, 32 * pt, 62 * pt, 80 * pt);
    ctx.fillStyle = "#000";
    const lines = ["APELLIDOS", "EJEMPLO EJEMPLO", "NOMBRE", "PERSONA"];
    lines.forEach((line, i) => ctx.fillText(line, 86 * pt, (44 + i * 16) * pt));
  } else {
    for (let i = 0; i < 5; i++)
      ctx.fillText(
        "<<<<<<0123456789<<<<<<<<<<<<<",
        12 * pt,
        (40 + i * 18) * pt,
      );
    ctx.fillRect(12 * pt, 128 * pt, 218 * pt, 10 * pt);
  }
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++)
    data[i] =
      0.299 * rgba[i * 4]! +
      0.587 * rgba[i * 4 + 1]! +
      0.114 * rgba[i * 4 + 2]!;
  return {
    page: { width, height, data },
    widthPt,
    heightPt,
    ppi,
    rules: [],
    columns: [],
  };
}

/** A sheet with other content than the test page: the next page of a batch. */
export function otherSheet(ppi = 150): TestPage {
  const base = testPage(ppi);
  const { width, height } = base.page;
  const data = Float32Array.from(base.page.data);
  for (let y = Math.round(height * 0.35); y < height * 0.75; y++)
    for (let x = Math.round(width * 0.15); x < width * 0.85; x++)
      data[y * width + x] = (x >> 5) % 2 ? 30 : 255 - data[y * width + x]!;
  return { ...base, page: { width, height, data } };
}
