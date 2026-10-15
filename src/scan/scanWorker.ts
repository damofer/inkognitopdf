/// <reference lib="webworker" />
/**
 * Scanner worker (spec 002, S010, CA11): detection, rectification, filters
 * and JPEG encoding run here so the interface stays responsive.
 */
import type { Rgba } from "./image";
import {
  enhance,
  findCorners,
  fullQuad,
  rectify,
  type Rectified,
} from "./pipeline";
import {
  ScanError,
  type AddResult,
  type RenderResult,
  type ScanRequest,
} from "./protocol";
import { toScanImage } from "./scanImage";

declare const self: DedicatedWorkerGlobalScope;

const photos = new Map<string, Rgba>();
const rectified = new Map<string, { key: string; page: Rectified }>();

function pixels(bitmap: ImageBitmap): Rgba {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: data.width, height: data.height, data: data.data };
}

function toCanvas(image: Rgba): OffscreenCanvas {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas
    .getContext("2d")!
    .putImageData(
      new ImageData(
        image.data as Uint8ClampedArray<ArrayBuffer>,
        image.width,
        image.height,
      ),
      0,
      0,
    );
  return canvas;
}

async function encodeJpeg(image: Rgba, quality: number): Promise<Uint8Array> {
  const blob = await toCanvas(image).convertToBlob({
    type: "image/jpeg",
    quality,
  });
  return new Uint8Array(await blob.arrayBuffer());
}

async function handle(req: ScanRequest): Promise<{
  result: AddResult | RenderResult | null;
  transfer: Transferable[];
}> {
  if (req.op === "add") {
    const photo = pixels(req.bitmap);
    photos.set(req.id, photo);
    const { quad, found } = req.detect
      ? findCorners(photo)
      : { quad: fullQuad(photo.width, photo.height), found: false };
    return {
      result: { width: photo.width, height: photo.height, quad, found },
      transfer: [],
    };
  }
  if (req.op === "drop") {
    photos.delete(req.id);
    rectified.delete(req.id);
    return { result: null, transfer: [] };
  }
  const t0 = performance.now();
  const photo = photos.get(req.id);
  if (!photo) throw new ScanError("scan.photoGone");
  // The rectified page is reused while only the mode or the rotation change.
  const key = JSON.stringify([req.quad, req.paper]);
  let cached = rectified.get(req.id);
  if (!cached || cached.key !== key) {
    cached = { key, page: rectify(photo, req.quad, req.paper) };
    rectified.set(req.id, cached);
  }
  const page = enhance(cached.page.image, req.mode, req.quarters);
  const scan = await toScanImage(page, encodeJpeg);
  const scale = Math.min(
    1,
    1000 / Math.max(page.image.width, page.image.height),
  );
  const preview = await createImageBitmap(toCanvas(page.image), {
    resizeWidth: Math.max(1, Math.round(page.image.width * scale)),
    resizeHeight: Math.max(1, Math.round(page.image.height * scale)),
    resizeQuality: "high",
  });
  return {
    result: { preview, scan, ms: performance.now() - t0 },
    transfer: [preview, scan.data.buffer],
  };
}

self.onmessage = (event: MessageEvent<{ seq: number; req: ScanRequest }>) => {
  const { seq, req } = event.data;
  handle(req).then(
    ({ result, transfer }) =>
      self.postMessage({ seq, ok: true, result }, transfer),
    (cause: unknown) =>
      self.postMessage({
        seq,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
        code: cause instanceof ScanError ? cause.code : undefined,
      }),
  );
};
