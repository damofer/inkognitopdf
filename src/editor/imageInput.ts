import { t } from "../i18n";

export interface LoadedImage {
  mime: "image/png" | "image/jpeg";
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Reads an image chosen by the user. PNG and JPEG are kept as they are; other
 * formats the browser can decode (WebP, GIF, BMP…) are converted to PNG,
 * because PDF only embeds those two directly.
 */
export async function loadImageFile(file: Blob): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  try {
    if (file.type === "image/png" || file.type === "image/jpeg")
      return {
        mime: file.type,
        data: new Uint8Array(await file.arrayBuffer()),
        width,
        height,
      };
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error(t("editor.imageConvertFailed"))),
        "image/png",
      ),
    );
    return {
      mime: "image/png",
      data: new Uint8Array(await png.arrayBuffer()),
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}
