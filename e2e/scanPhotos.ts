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
  photos: Record<
    string,
    Omit<PhotoOptions, "page"> & { exifRotated?: boolean }
  >,
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
