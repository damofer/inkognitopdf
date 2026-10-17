// English messages: comparing two versions of a PDF (spec 018).
import type { compare as es } from "../es/compare";

export const compare: typeof es = {
  "compare.button": "Compare",
  "compare.hint":
    "Compare with another version of the PDF: text changes and visual differences",
  "compare.title": "Compare versions",
  "compare.loading": "Comparing…",
  "compare.failed": (reason) =>
    `The documents could not be compared: ${reason}`,
  "compare.before": "Before",
  "compare.after": "Now",
  "compare.swap": "Swap",
  "compare.swapHint": "Change which one is the earlier version",
  "compare.report": "Download report",
  "compare.close": "Close comparison",
  "compare.same": "The text is the same in both versions.",
  "compare.summary": (changes, pages) =>
    `${changes === 1 ? "1 text change" : `${changes} text changes`} on ${
      pages === 1 ? "1 page" : `${pages} pages`
    }.`,
  "compare.tooMany":
    "The documents are too different to list the text changes; look at the visual differences.",
  "compare.pagesGone": (n) =>
    n === 1 ? "1 earlier page is gone." : `${n} earlier pages are gone.`,
  "compare.page": (n, total) => `Page ${n} of ${total}`,
  "compare.prev": "Previous page",
  "compare.next": "Next page",
  "compare.visual": "Visual differences",
  "compare.side": (side, page) => `${side} · p. ${page}`,
  "compare.noPage": "New page: it is not in the earlier version.",
  "compare.visualShare": (percent) => `${percent} % of the page changes.`,
  "compare.visualSame": "No visual differences.",
  "compare.visualSize": "The pages have different sizes.",
  "compare.changes": "Text changes",
  "compare.changePage": (n) => `P. ${n}`,
  "compare.replaced": (before, after) => `"${before}" → "${after}"`,
  "compare.addedText": (text) => `Added: "${text}"`,
  "compare.removedText": (text) => `Removed: "${text}"`,
  "compare.more": (n) => `And ${n} more changes (in the report).`,
  "compare.removed": "Removed",
  "compare.added": "Added",
  "compare.local": "The comparison runs on your device; nothing is uploaded.",
  "compare.reportSuffix": "comparison",
  "compare.reportTitle": "Comparison report",
  "compare.reportBefore": (name) => `Before: ${name}`,
  "compare.reportAfter": (name) => `Now: ${name}`,
  "compare.reportDate": (date) => `Date: ${date}`,
  "compare.reportVisual": "Pages with visual differences",
  "compare.reportVisualPage": (page, percent) =>
    `P. ${page}: ${percent} % changes`,
  "compare.reportNoVisual": "None.",
  "compare.reportPage": (n) => `Page ${n}`,
};
