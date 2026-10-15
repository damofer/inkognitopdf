// English messages: ocr.
import type { ocr as es } from "../es/ocr";

export const ocr: typeof es = {
  "ocr.langSpa": "Spanish",
  "ocr.langEng": "English",
  "ocr.langSpaEng": "Spanish and English",

  "ocr.title": "Recognize text",
  "ocr.heading": "Recognize text (OCR)",
  "ocr.close": "Close OCR",
  "ocr.pages": "Pages",
  "ocr.scopeScanned": "Scanned only",
  "ocr.scopeAll": "All",
  "ocr.scopeRange": "Range",
  "ocr.rangeLabel": "Page range",
  "ocr.includeText": "Include pages that already have text",
  "ocr.language": "Language",
  "ocr.cancel": "Cancel",
  "ocr.recognize": "Recognize",
  "ocr.exportTxt": "Export .txt",
  "ocr.note":
    "Text is recognized on this device and never leaves it. Uncertain words are marked in orange (on screen only).",
  "ocr.defaultFileName": "document",

  "ocr.statusLoadingCore": "Loading the engine",
  "ocr.statusInitializing": "Starting the engine",
  "ocr.statusLoadingLang": "Loading the language",
  "ocr.statusInitApi": "Preparing",
  "ocr.statusRecognizing": "Recognizing",

  "ocr.pageOf": (page: number, total: number) => `Page ${page} of ${total}`,
  "ocr.checking": (label: string) => `${label}: checking`,
  "ocr.progress": (label: string, status: string, percent: number) =>
    `${label}: ${status} ${percent}%`,
  "ocr.preparing": (label: string) => `${label}: preparing the image`,
  "ocr.cancelled": "OCR canceled.",
  "ocr.done": (done: number, skipped: number) =>
    `Recognized ${done} ${done === 1 ? "page" : "pages"}.` +
    (skipped > 0 ? ` ${skipped} unchanged (with text or blank).` : ""),
  "ocr.error": (message: string) => `OCR error: ${message}`,
};
