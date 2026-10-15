import type { ScanImage } from "../model/document";

const cache = new WeakMap<ScanImage, Promise<ImageBitmap>>();

/** Decoded image of a scanned page (spec 002), cached per image. */
export function scanBitmap(image: ScanImage): Promise<ImageBitmap> {
  let bitmap = cache.get(image);
  if (!bitmap) {
    bitmap =
      image.format === "jpeg"
        ? createImageBitmap(
            new Blob([image.data as Uint8Array<ArrayBuffer>], {
              type: "image/jpeg",
            }),
          )
        : createImageBitmap(bitsToImageData(image));
    cache.set(image, bitmap);
  }
  return bitmap;
}

function bitsToImageData({ data, width, height }: ScanImage): ImageData {
  const out = new ImageData(width, height);
  const stride = Math.ceil(width / 8);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const c = data[y * stride + (x >> 3)]! & (0x80 >> (x & 7)) ? 255 : 0;
      const o = (y * width + x) * 4;
      out.data[o] = out.data[o + 1] = out.data[o + 2] = c;
      out.data[o + 3] = 255;
    }
  return out;
}

/**
 * Draws a scanned page on a canvas that shows the page turned by `rotation`
 * degrees clockwise (the canvas is already sized for the rotated page).
 */
export async function drawScanPage(
  canvas: HTMLCanvasElement,
  image: ScanImage,
  rotation: number,
): Promise<void> {
  const bitmap = await scanBitmap(image);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const turned = rotation % 180 !== 0;
  const w = turned ? canvas.height : canvas.width;
  const h = turned ? canvas.width : canvas.height;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, -w / 2, -h / 2, w, h);
  ctx.restore();
}
