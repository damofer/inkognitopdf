// English messages: merging and splitting (spec 013).
import type { organize as es } from "../es/organize";

export const organize: typeof es = {
  "organize.encrypted": (file: string) =>
    `"${file}" is password protected; it cannot be merged yet.`,
  "organize.unreadable": (file: string) =>
    `"${file}" could not be read as a PDF.`,
  "organize.badRange": (part: string) =>
    `"${part}" is not a page range (examples: 3, 1-4, 8-).`,
  "organize.outOfRange": (part: string, count: number) =>
    `The range "${part}" is not between 1 and ${count}.`,
  "organize.noRanges": "Type at least one page range.",
  "organize.badEvery": "The number of pages per file must be 1 or more.",
  "organize.insert": "Insert PDF",
  "organize.insertHint": "Adds the pages of other PDFs at the end",
  "organize.inserting": "Inserting…",
  "organize.inserted": (pages: number) =>
    pages === 1
      ? "1 page was added at the end."
      : `${pages} pages were added at the end.`,
  "organize.insertFailed": (reason: string) =>
    `The PDF could not be inserted: ${reason}`,
  "organize.dragHint": "Drag the thumbnails to change the order.",
  "organize.split": "Split",
  "organize.splitHint": "Split the document or extract pages",
  "organize.splitTitle": "Split or extract pages",
  "organize.mode": "How to split",
  "organize.byRanges": "By ranges",
  "organize.byEvery": "Every N pages",
  "organize.bySelection": "Chosen pages",
  "organize.ranges": "Page ranges",
  "organize.rangesHelp": "One file per range, separated by commas.",
  "organize.every": "Pages per file",
  "organize.pick": "Pages to extract",
  "organize.page": (n: number) => `Page ${n}`,
  "organize.all": "All",
  "organize.none": "None",
  "organize.pickNone": "Choose at least one page.",
  "organize.preview": (files: number) =>
    files === 1
      ? "1 file will be downloaded:"
      : `${files} files will be downloaded in a ZIP:`,
  "organize.more": (files: number) => `and ${files} more…`,
  "organize.download": (files: number) =>
    files === 1 ? "Download PDF" : `Download ZIP (${files} files)`,
  "organize.working": "Preparing…",
  "organize.pagesSuffix": (pages: string) => `pages ${pages}`,
  "organize.partsSuffix": "parts",
  "organize.splitDone": (files: number) =>
    files === 1 ? "PDF downloaded." : `ZIP downloaded with ${files} files.`,
  "organize.splitFailed": (reason: string) =>
    `The document could not be split: ${reason}`,
  "organize.close": "Close",
};
