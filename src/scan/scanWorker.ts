/// <reference lib="webworker" />
/**
 * Scanner worker (spec 002, S010, CA11): detection, rectification, filters
 * and JPEG encoding run here so the interface stays responsive.
 */
import type { Quad } from "./homography";
import type { Rgba } from "./image";
import { detectPage } from "./detect";
import { toGray } from "./image";
import {
  composeIdPage,
  enhance,
  findCorners,
  fullQuad,
  pageSignature,
  rectify,
  type PaperSize,
  type Rectified,
} from "./pipeline";
import {
  ScanError,
  type AddResult,
  type ComposeResult,
  type DetectResult,
  type RenderResult,
  type ScanRequest,
} from "./protocol";
import { toScanImage } from "./scanImage";

declare const self: DedicatedWorkerGlobalScope;

const photos = new Map<string, Rgba>();
const pages = new Map<string, { key: string; page: Rectified }>();

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

/** The page of a photo rectified for `quad` and `paper`, reused while they hold. */
function rectified(id: string, quad: Quad, paper: PaperSize): Rectified {
  const photo = photos.get(id);
  if (!photo) throw new ScanError("scan.photoGone");
  const key = JSON.stringify([quad, paper]);
  let cached = pages.get(id);
  if (!cached || cached.key !== key) {
    cached = { key, page: rectify(photo, quad, paper) };
    pages.set(id, cached);
  }
  return cached.page;
}

async function handle(req: ScanRequest): Promise<{
  result: AddResult | RenderResult | DetectResult | ComposeResult | null;
  transfer: Transferable[];
}> {
  if (req.op === "detect") {
    const frame = pixels(req.bitmap);
    const found = detectPage(toGray(frame));
    const signature = found ? pageSignature(frame, found.quad) : null;
    return {
      result: { quad: found?.quad ?? null, signature },
      transfer: signature ? [signature.buffer] : [],
    };
  }
  if (req.op === "compose") {
    const sides = req.sides.map((side) =>
      enhance(
        rectified(side.id, side.quad, "card").image,
        side.mode,
        side.quarters,
      ),
    );
    const scan = await toScanImage(composeIdPage(sides), encodeJpeg);
    return { result: { scan }, transfer: [scan.data.buffer] };
  }
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
    pages.delete(req.id);
    return { result: null, transfer: [] };
  }
  const t0 = performance.now();
  // The rectified page is reused while only the mode or the rotation change.
  const page = enhance(
    rectified(req.id, req.quad, req.paper).image,
    req.mode,
    req.quarters,
  );
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
