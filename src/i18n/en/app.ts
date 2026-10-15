// English messages: app shell (header, start screen, language switch).
import type { app as es } from "../es/app";

export const app: typeof es = {
  "app.version": "App version",
  "app.openPdf": "Open PDF",
  "app.blankDocument": "Blank document",
  "app.scan": "Scan",
  "app.newDocument": "New document",
  "app.emptyHint":
    "Open or drop a PDF, or start with a blank document. Your documents are processed only on this device.",
  "app.merging": (files: number) => `Merging ${files} PDFs…`,
  "app.opening": (name: string) => `Opening “${name}”…`,
  "app.home": "Go to the InkognitoPDF home page",
  "app.sourceCode": "Source code",
  "app.sourceCodeHint": "Open source on GitHub (opens in a new tab)",
  "app.description":
    "Open source PDF editor that processes your documents on your device.",
  "lang.label": "Language",
  "lang.es": "Español",
  "lang.en": "English",
};
