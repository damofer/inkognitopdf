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
  "scan.straighten": "Straighten curve",
  "scan.straightenHint":
    "The sheet was curved and its lines have been straightened. Release the button to keep it as a flat sheet.",

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
  "scan.closeAdd": "Close",
  "scan.editPage": (page: number) => `Adjust page ${page}`,
  "scan.ocrFailed": (error: string) => `Could not recognize the text: ${error}`,

  // Live camera and ID card mode (spec 020).
  "scan.cameraOpen": "Scan with the camera",
  "scan.cameraTitle": "Camera scan",
  "scan.cameraAuto": "Auto capture",
  "scan.cameraTake": "Take the photo",
  "scan.cameraDone": (count: number) =>
    count === 0 ? "Done" : `Done (${count})`,
  "scan.cameraSearching": "Looking for the page: put it on a dark surface.",
  "scan.cameraHold": "Page found. Hold the phone still...",
  "scan.cameraReady": "Page found. Press the button to take the photo.",
  "scan.cameraNext": "Done. Put down the next page.",
  "scan.cameraFront": "Point at the front of the card.",
  "scan.cameraBack": "Now the back of the card.",
  "scan.cameraFlip": "Done. Turn the card over.",
  "scan.cameraName": (n: number) => `Photo ${n}`,
  "scan.cameraFailed":
    'The camera could not be opened. Allow access to it, or use "Take photo".',
  "scan.idCard": "ID card mode (both sides on one A4)",
  "scan.idHint":
    "ID card mode: every two photos (front and back) go together on one A4 page, at real size.",
  "scan.idSides": (sides: number) => {
    const pages = Math.ceil(sides / 2);
    return `${sides === 1 ? "1 side" : `${sides} sides`} on ${pages === 1 ? "1 page" : `${pages} pages`}`;
  },
};
