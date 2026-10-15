// English messages: PDF engine, document model and storage.
import type { engine as es } from "../es/engine";

export const engine: typeof es = {
  "signField.signature": "Signature",
  "signField.initials": "Initials",
  "signField.date": "Date",
  "signField.name": "Name",
  "signField.text": "Text",

  "engine.encrypted":
    "The PDF is encrypted. This version cannot save protected PDFs yet.",
  "engine.fallbackFonts":
    "Some characters are missing from the standard fonts; their free equivalent was used (Arimo, Tinos or Cousine).",
  "engine.missingPage": (page: number) =>
    `Page ${page} does not exist in the original.`,
  "engine.substituteFont": (text: string, font: string) =>
    `The original font of “${text}” lacks some characters of the new text; a substitute font was used (${font}).`,
  "engine.textNotFound": (text: string) =>
    `The text “${text}” was not found in the page content; it was covered with white, but it may still be in the file.`,
  "engine.notTrueType": "The font is not TrueType with glyf outlines.",
  "engine.defaultFieldName": "field",
  "engine.defaultOption": (n: number) => `Option${n}`,

  "operations.unknownPage": (id: string) => `Unknown page: ${id}`,
  "operations.duplicateItem": (id: string) => `Duplicate item: ${id}`,
  "operations.unknownItem": (id: string) => `Unknown item: ${id}`,
  "operations.lastPage": "A PDF must keep at least one page.",
  "operations.duplicatePage": (id: string) => `Duplicate page: ${id}`,

  "storage.noIndexedDb": "IndexedDB is not available.",
  "storage.notAPdf": (name: string) =>
    `“${name}” does not look like a PDF (no %PDF- header found).`,
};
