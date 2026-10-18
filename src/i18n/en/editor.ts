// English messages: editor.
import type { editor as es } from "../es/editor";

export const editor: typeof es = {
  // Form field types (spec 005).
  "editor.fieldText": "Text",
  "editor.fieldMultiline": "Multiline text",
  "editor.fieldCheckbox": "Check box",
  "editor.fieldRadio": "Radio button",
  "editor.fieldDropdown": "Dropdown list",
  "editor.fieldList": "List",

  // Field properties panel.
  "editor.fieldProperties": "Field properties",
  "editor.fieldName": "Name",
  "editor.fieldValue": "Value",
  "editor.fieldOptions": "Options (one per line)",
  "editor.fieldMultiSelect": "Multiple selection",
  "editor.fieldAlign": "Alignment",
  "editor.alignLeft": "Left",
  "editor.alignCenter": "Center",
  "editor.alignRight": "Right",
  "editor.fieldMaxLength": "Maximum length",
  "editor.fieldComb": "Split into boxes",
  "editor.fieldRequired": "Required",

  // Saving and signing.
  "editor.imageUnreadable":
    "The image could not be read. Use PNG, JPEG, WebP or GIF.",
  "editor.imageConvertFailed": "The image could not be converted.",
  "editor.fontLoadFailed": (family: string, variant: string) =>
    `The font ${family} ${variant} could not be loaded.`,
  "editor.saved": "Saved.",
  "editor.looksScannedShort": "Scanned document.",
  "editor.needOcr":
    "To change the text of a scanned page, its text must be recognized first.",
  "editor.needOcrShort": "Recognize the text first.",
  "editor.saveFailed": (reason: string) => `Could not save: ${reason}`,
  "editor.defaultSigner": "Signer",
  "editor.savedVisual": "Saved with the visual signature.",
  "editor.savedDigital": "Saved and digitally signed.",
  "editor.savedDigitalInvisible":
    "Saved and digitally signed (invisible signature: you did not place any signature).",
  "editor.signFailed": (reason: string) => `Could not sign: ${reason}`,
  // Joins the names of the next signers: "Ann and Luis".
  "editor.namesAnd": " and ",
  "editor.preparedSendTo": (names: string) =>
    `Ready for signing. Send the file to ${names}.`,
  "editor.prepareFailed": (reason: string) => `Could not prepare: ${reason}`,
  "editor.signedSendTo": (names: string) =>
    `Signed and saved. Send the file to ${names}.`,
  "editor.signedAllDone": "Signed and saved. Everyone has signed.",

  // File names of saved documents. The suffixes of both languages are
  // recognized when a prepared or signed file is signed again.
  "editor.defaultFileName": "document.pdf",
  "editor.defaultBaseName": "document",
  "editor.editedSuffix": "edited",
  "editor.signedSuffix": "signed",
  "editor.toSignSuffix": "to sign",

  // Page actions.
  "editor.rotateLeftPage": (page: number) => `Rotate page ${page} left`,
  "editor.rotateLeft": "Rotate left",
  "editor.rotateRightPage": (page: number) => `Rotate page ${page} right`,
  "editor.rotateRight": "Rotate right",
  "editor.moveUpPage": (page: number) => `Move page ${page} up`,
  "editor.moveUp": "Move up",
  "editor.moveDownPage": (page: number) => `Move page ${page} down`,
  "editor.moveDown": "Move down",
  "editor.insertBlankAfterPage": (page: number) =>
    `Insert a blank page after page ${page}`,
  "editor.insertBlankAfter": "Insert blank page after",
  "editor.deletePageN": (page: number) => `Delete page ${page}`,
  "editor.deletePage": "Delete page",

  // Toolbar.
  "editor.undo": "Undo",
  "editor.undoHint": "Undo (Ctrl+Z)",
  "editor.redo": "Redo",
  "editor.redoHint": "Redo (Ctrl+Y)",
  "editor.saving": "Saving…",
  "editor.savePdf": "Save PDF",
  "editor.signHint": "Create your signature and place it on the document",
  "editor.sign": "Sign",
  "editor.ocrHint": "Recognize the text of scanned pages",
  "editor.ocr": "OCR",
  "editor.tools": "Editing tools",
  "editor.textStyle": "Text style",
  "editor.font": "Font",
  "editor.size": "Size",
  "editor.textColor": "Text color",
  "editor.bold": "Bold",
  "editor.boldIcon": "B",
  "editor.italic": "Italic",
  "editor.italicIcon": "I",
  "editor.highlightColor": "Highlight color",
  "editor.noteColor": "Note color",
  "editor.annotation": "Annotation",
  "editor.annotationColor": "Annotation color",
  "editor.stroke": "Stroke",
  "editor.strokeColor": "Stroke color",
  "editor.strokeWidth": "Thickness",
  "editor.points": (size: number) => `${size} pt`,
  "editor.fill": "Fill",
  "editor.fillColor": "Fill color",
  "editor.field": "Field",
  "editor.fieldType": "Field type",
  "editor.fieldFont": "Field font",
  "editor.fieldSize": "Field size",
  "editor.fieldSizeAuto": "Auto",
  "editor.fieldColor": "Field color",
  "editor.flattenForm": "Flatten form",

  // Notices.
  "editor.closeNotice": "Close notice",
  "editor.signatures": "Signatures",
  "editor.overwriteSigned":
    "This PDF has digital signatures. Saving from the editor rewrites the file and those signatures will no longer be valid.",
  "editor.saveAnyway": "Save anyway",
  "editor.cancel": "Cancel",
  "editor.oneSignature": "This document has a digital signature.",
  "editor.manySignatures": (count: number) =>
    `This document has ${count} digital signatures.`,
  "editor.someInvalid":
    "Some are not valid or the document changed afterwards.",
  "editor.allIntact": "All are intact.",
  "editor.viewSignatures": "View signatures",
  "editor.planDone": (count: number) =>
    `Document signed by everyone (${count}).`,
  "editor.planPending": (names: string) =>
    `Document for signing. Next to sign: ${names}.`,
  "editor.signOnly":
    "For signing only: it cannot be edited until everyone has signed.",
  "editor.signOnlyLocked": "It cannot be edited until everyone has signed.",
  "editor.signAs": "Sign as…",
  "editor.looksScanned":
    "This document looks scanned: its text is an image. Recognize it with OCR so you can search and copy it.",
  "editor.recognizeText": "Recognize text",
  "editor.closeScannedNotice": "Close scan notice",
};
