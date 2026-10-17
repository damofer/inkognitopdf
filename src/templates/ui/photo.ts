// The CV photo (spec 021, CA9): any image the browser can read, made small
// and turned into JPEG so the PDF stays light.
import type { Photo } from "../types";

const MAX_SIDE = 600;

export async function loadPhoto(file: Blob): Promise<Photo> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d")!;
    // A transparent PNG gets a white background instead of black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) throw new Error("photo");
    return { bytes: new Uint8Array(await blob.arrayBuffer()), kind: "jpg" };
  } finally {
    bitmap.close();
  }
}
