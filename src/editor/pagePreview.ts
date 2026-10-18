import { AnnotationMode } from "pdfjs-dist/legacy/build/pdf.mjs";
import { applyEdits } from "../engine/applyEdits";
import {
  effectiveRotation,
  type Item,
  type PageEntry,
} from "../model/document";
import type { PdfFile } from "../storage/pdfFile";
import { canvasScale } from "../viewer/canvasScale";
import { loadDocumentBytes } from "../viewer/pdfjs";
import { loadFont } from "./loadFont";

/**
 * Preview of edited page text (spec 001, CA3b), filled and created form
 * fields, and changed or removed annotations of the file (spec 005, CA4): the
 * page is rebuilt with the same engine that saves, and rendered with pdf.js.
 * What the user sees is what will be saved: original font, color and size,
 * and the background under the text intact (nothing is painted over it).
 * Returns an object URL, or null when the page cannot be previewed.
 */
export async function renderEditedPage(
  file: PdfFile,
  entry: PageEntry,
  edits: Item[],
  zoom: number,
): Promise<string | null> {
  if (entry.source.kind !== "original") return null;
  const { bytes } = await applyEdits(
    file.copyBytes(),
    { pages: [entry], items: edits },
    { loadFont },
  );
  const doc = await loadDocumentBytes(bytes);
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({
      scale: zoom,
      rotation: effectiveRotation(entry),
    });
    const outputScale = canvasScale(viewport.width, viewport.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    await page.render({
      canvas,
      viewport,
      annotationMode: AnnotationMode.ENABLE,
      transform:
        outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
    }).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    return blob ? URL.createObjectURL(blob) : null;
  } finally {
    await doc.loadingTask.destroy();
  }
}
