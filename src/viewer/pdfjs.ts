// The legacy build of pdf.js, page and worker: the modern one uses brand-new
// JavaScript (Map#getOrInsertComputed, Math.sumPrecise, Iterator helpers…)
// and, in a browser a few versions old (Chromium 141, Safari 17), the pages
// stay blank without an error. The legacy build brings its own polyfills.
import {
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PdfFile } from "../storage/pdfFile";

// The worker is bundled with the app, so viewing works offline (PWA).
GlobalWorkerOptions.workerSrc = workerUrl;

export type {
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";

/** Loads a document from a copy of the file's bytes; the original stays intact. */
export function loadDocument(file: PdfFile): Promise<PDFDocumentProxy> {
  return loadDocumentBytes(file.copyBytes());
}

/** Loads a document from bytes it may consume (pdf.js detaches the buffer). */
export function loadDocumentBytes(data: Uint8Array): Promise<PDFDocumentProxy> {
  return getDocument({
    data,
    // Never fetch anything from the network for a local document (spec 001, CA10).
    disableAutoFetch: true,
    useSystemFonts: true,
    // Standard fonts and CMaps are served from the app itself (scripts/copy-pdfjs-assets.mjs).
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`,
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
    cMapPacked: true,
  }).promise;
}
