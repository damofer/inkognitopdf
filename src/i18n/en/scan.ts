// English messages: scan.
import type { scan as es } from "../es/scan";

export const scan: typeof es = {
  "scan.title": "Scan document",
  "scan.takePhoto": "Take photo",
  "scan.chooseImages": "Choose images",
  "scan.autoDetect": "Automatic detection",
  "scan.size": "Size",
  "scan.pageSize": "Page size",
  "scan.sizeAuto": "Automatic",
  "scan.sizeLetter": "Letter",
  "scan.withOcr": "Recognize text (OCR)",
  "scan.savePdf": "Save PDF",
  "scan.addToDocument": "Add to document",
  "scan.openInEditor": "Open in editor",
  "scan.close": "Close",
  "scan.hint":
    "Take a photo of a sheet or choose images. They are processed only on this device.",

  "scan.cornersCross":
    "The corners cross each other: place them in the order of the sheet.",
  "scan.detectedEdges": "Detected edges",
  "scan.fullImage": "Full image",
  "scan.continue": "Continue",
  "scan.cornerTopLeft": "Top-left corner",
  "scan.cornerTopRight": "Top-right corner",
  "scan.cornerBottomRight": "Bottom-right corner",
  "scan.cornerBottomLeft": "Bottom-left corner",
  "scan.photoAlt": (name: string) => `Photo ${name}`,

  "scan.resultAlt": (page: number) => `Scanned page ${page}`,
  "scan.mode": "Mode",
  "scan.modeOriginal": "Original",
  "scan.modeGray": "Grayscale",
  "scan.modeBw": "Photocopy",
  "scan.rotateLeft": "Rotate left",
  "scan.rotateRight": "Rotate right",
  "scan.adjustEdges": "Adjust edges",

  "scan.pages": "Scanned pages",
  "scan.thumb": (page: number, name: string) => `Page ${page}: ${name}`,
  "scan.moveBefore": (page: number) => `Move page ${page} earlier`,
  "scan.moveAfter": (page: number) => `Move page ${page} later`,
  "scan.remove": (page: number) => `Remove page ${page}`,

  "scan.reading": (name: string) => `Reading “${name}”…`,
  "scan.pageNotFound":
    "The page was not found in a photo, so the whole image is proposed. Adjust the corners.",
  "scan.unreadable": (name: string) =>
    `Could not read “${name}”. Use JPEG, PNG or WebP.`,
  "scan.processing": "Processing…",
  "scan.processingPages": "Processing pages…",
  "scan.recognizing": (page: number, total: number) =>
    `Recognizing text: page ${page} of ${total}…`,
  "scan.saving": "Saving…",
  "scan.saved": "Saved.",
  "scan.saveFailed": (error: string) => `Could not save: ${error}`,
  "scan.fileName": "scan.pdf",

  "scan.photoGone": "The photo is no longer available.",
  "scan.invalidQuad": "The crop is not a valid quadrilateral.",
  "scan.closed": "The scanner was closed.",

  "scan.shortTitle": "Scan",
  "scan.pageOf": (page: number, total: number) => `Page ${page} of ${total}`,
  "scan.pageCount": (total: number) =>
    total === 1 ? "1 page" : `${total} pages`,
  "scan.settings": "Scanner settings",
  "scan.closeSettings": "Close settings",
  "scan.settingsRemembered": "Settings are remembered on this device.",
  "scan.addPage": "Add page",
  "scan.editPage": (page: number) => `Adjust page ${page}`,
  "scan.ocrFailed": (error: string) => `Could not recognize the text: ${error}`,
};
