// English messages: app shell (header, start screen, language switch).
import type { app as es } from "../es/app";

export const app: typeof es = {
  "app.version": "App version",
  "app.openPdf": "Open PDF",
  "app.blankShort": "Blank",
  "app.scan": "Scan",
  "app.newDocument": "New document",
  "app.emptyHint":
    "Open or drop a PDF, or write one from scratch. Your documents are processed only on this device.",
  "app.merging": (files: number) => `Merging ${files} PDFs…`,
  "app.opening": (name: string) => `Opening “${name}”…`,
  "app.home": "Go to the InkognitoPDF home page",
  "app.sourceCode": "Source code",
  "app.sourceCodeHint": "Open source on GitHub (opens in a new tab)",
  "app.description":
    "Open source PDF editor that processes your documents on your device.",
  "draft.title": "You have unsaved work",
  "draft.detail": (name: string, when: string) =>
    `“${name}”, edited ${when}. It is kept only on this device.`,
  "draft.resume": "Resume",
  "draft.discard": "Discard",
  "draft.resuming": (name: string) => `Resuming “${name}”…`,
  "draft.failed": (reason: string) =>
    `The unsaved work could not be resumed: ${reason}`,
  "lang.label": "Language",
  "lang.es": "Español",
  "lang.en": "English",
};
