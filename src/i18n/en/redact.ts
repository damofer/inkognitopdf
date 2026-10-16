// English messages: secure redaction (spec 012).
import type { redact as es } from "../es/redact";

export const redact: typeof es = {
  "redact.label": "Secure redaction",
  "redact.pendingMark": "Area marked for redaction (not applied)",
  "redact.appliedMark": "Redacted area",
  "redact.search": "Search to redact",
  "redact.searchPlaceholder": "Word, number or pattern",
  "redact.regex": "Regular expression",
  "redact.markMatches": "Mark matches",
  "redact.found": (n: number) =>
    n === 1 ? "1 match marked." : `${n} matches marked.`,
  "redact.notFound": "Not found in the document text.",
  "redact.badRegex": "The regular expression is not valid.",
  "redact.searching": "Searching…",
  "redact.apply": (n: number) => `Apply redaction (${n})`,
  "redact.confirmTitle": "Apply secure redaction?",
  "redact.confirmBody": (n: number) =>
    `${n === 1 ? "The marked area is" : `The ${n} marked areas are`} redacted when saving: the text, images, drawings, annotations and fields under ${n === 1 ? "it" : "them"} are removed from the file and covered in black.`,
  "redact.confirmWarning":
    "It cannot be undone in the saved file. In the editor you can undo until you save.",
  "redact.clearMetadata":
    "Also remove the document metadata (title, author, subject, keywords, program)",
  "redact.elsewhereSearching":
    "Looking for the same text elsewhere in the file…",
  "redact.elsewhereTitle": "That text also appears outside the areas, in:",
  "redact.elsewhereAnnotations": (n: number) =>
    n === 1 ? "1 note or comment" : `${n} notes or comments`,
  "redact.elsewhereBookmarks": (n: number) =>
    n === 1 ? "1 bookmark" : `${n} bookmarks`,
  "redact.elsewhereAttachments": (n: number) =>
    n === 1 ? "1 attached file" : `${n} attached files`,
  "redact.elsewhereFields": (n: number) =>
    n === 1 ? "1 form field" : `${n} form fields`,
  "redact.elsewhereMetadata": (n: number) =>
    n === 1
      ? "1 metadata entry (title, author, subject or keywords)"
      : `${n} metadata entries (title, author, subject or keywords)`,
  "redact.elsewhereRemove": "Also remove these occurrences",
  "redact.elsewhereRemoveNote":
    "The notes and attachments that contain it are deleted, the bookmarks are removed (their sub-bookmarks are kept), the fields are emptied and those metadata entries are deleted.",
  "redact.elsewhereKept":
    "If you do not remove them, that text stays in the saved file even though the areas are redacted.",
  "redact.elsewhereNone":
    "It does not appear in notes, bookmarks, attachments, fields or metadata.",
  "redact.confirm": "Apply redaction",
  "redact.cancel": "Cancel",
  "redact.imageRemoved": (page: number) =>
    `An image on page ${page} under a redacted area could not be processed and was removed from the page entirely.`,
  "redact.pending": (n: number) =>
    n === 1
      ? "1 area is marked for redaction but not applied: its content was not removed."
      : `${n} areas are marked for redaction but not applied: their content was not removed.`,
};
