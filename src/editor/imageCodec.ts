import type { ImageCodec } from "../engine/redact";

/** A 2D canvas of the given size (off screen when the browser has it). */
function canvas2d(width: number, height: number) {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d");
    return {
      ctx,
      toJpeg: () => canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 }),
    };
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d");
  return {
    ctx,
    toJpeg: () =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("jpeg"))),
          "image/jpeg",
          0.92,
        ),
      ),
  };
}

/**
 * JPEG decoding and encoding with the browser's own canvas, to redact JPEG
 * images of a document (spec 012). Nothing leaves the device.
 */
export const browserImageCodec: ImageCodec = {
  async decodeJpeg(bytes) {
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
      type: "image/jpeg",
    });
    // PDF viewers ignore EXIF orientation; older browsers lack the option.
    const bitmap = await createImageBitmap(blob, {
      imageOrientation: "none",
    } as ImageBitmapOptions).catch(() => createImageBitmap(blob));
    try {
      const { width, height } = bitmap;
      const { ctx } = canvas2d(width, height);
      ctx.drawImage(bitmap, 0, 0);
      return {
        width,
        height,
        data: ctx.getImageData(0, 0, width, height).data,
      };
    } finally {
      bitmap.close();
    }
  },
  async encodeJpeg(rgba, width, height) {
    const { ctx, toJpeg } = canvas2d(width, height);
    ctx.putImageData(
      new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height),
      0,
      0,
    );
    return new Uint8Array(await (await toJpeg()).arrayBuffer());
  },
};
