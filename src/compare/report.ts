// Spec 018: the comparison report as a PDF, made on the device.
import { PDFDocument, rgb, StandardFonts, type PDFFont } from "pdf-lib";
import { t } from "../i18n";
import type { Change } from "../model/compare";

export interface ReportInput {
  before: string;
  after: string;
  date: Date;
  changes: Change[];
  /** Page of the later version (from 0) of each change. */
  changePages: number[];
  tooMany: boolean;
  /** Pages of the later version with visual differences, and how much. */
  visual: { page: number; share: number }[];
}

/** Helvetica only has the Latin-1 letters: the rest is shown as "?". */
const printable = (text: string) =>
  text
    .replace(/→/g, "->")
    .replace(
      /[^\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u20ac]/gu,
      "?",
    );

const percent = (share: number) =>
  (share * 100).toLocaleString(undefined, { maximumFractionDigits: 1 });

export async function comparisonReport(
  input: ReportInput,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(t("compare.reportTitle"));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [width, height] = [595.28, 841.89];
  const margin = 56;
  let page = doc.addPage([width, height]);
  let y = height - margin;

  /** Writes `text` wrapped to the width, on new pages when needed. */
  const write = (
    text: string,
    { font = regular, size = 10, color = rgb(0.1, 0.1, 0.1), gap = 4 } = {},
  ) => {
    const lines = wrap(printable(text), font, size, width - 2 * margin);
    for (const line of lines) {
      if (y - size < margin) {
        page = doc.addPage([width, height]);
        y = height - margin;
      }
      page.drawText(line, { x: margin, y: y - size, size, font, color });
      y -= size * 1.35;
    }
    y -= gap;
  };

  write(t("compare.reportTitle"), { font: bold, size: 18, gap: 10 });
  write(t("compare.reportBefore", input.before));
  write(t("compare.reportAfter", input.after));
  write(t("compare.reportDate", input.date.toLocaleString()), { gap: 12 });

  const pages = new Set(input.changePages);
  write(
    input.tooMany
      ? t("compare.tooMany")
      : input.changes.length === 0
        ? t("compare.same")
        : t("compare.summary", input.changes.length, pages.size),
    { font: bold, size: 11, gap: 10 },
  );

  let shown = -1;
  input.changes.forEach((change, i) => {
    const at = input.changePages[i]!;
    if (at !== shown) {
      write(t("compare.reportPage", at + 1), { font: bold, size: 11, gap: 2 });
      shown = at;
    }
    const removed = change.removed.map((w) => w.text).join(" ");
    const added = change.added.map((w) => w.text).join(" ");
    write(
      removed && added
        ? t("compare.replaced", removed, added)
        : added
          ? t("compare.addedText", added)
          : t("compare.removedText", removed),
      {
        color:
          added && !removed
            ? rgb(0, 0.45, 0.2)
            : removed && !added
              ? rgb(0.7, 0.1, 0.1)
              : rgb(0.1, 0.1, 0.1),
      },
    );
  });

  y -= 8;
  write(t("compare.reportVisual"), { font: bold, size: 11, gap: 2 });
  if (input.visual.length === 0) write(t("compare.reportNoVisual"));
  for (const { page: p, share } of input.visual)
    write(t("compare.reportVisualPage", p + 1, percent(share)));
  write(t("compare.local"), { size: 8, color: rgb(0.4, 0.4, 0.4) });

  return doc.save();
}

function wrap(text: string, font: PDFFont, size: number, max: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= max || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
