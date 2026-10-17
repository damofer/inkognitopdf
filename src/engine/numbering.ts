// Page numbers, headers and footers drawn as real text (spec 022, CA9).
import type { PDFFont, PDFPage } from "pdf-lib";
import { effectiveRotation, type PageEntry } from "../model/document";
import { PageGeometry } from "../model/geometry";
import {
  resolveText,
  slotOrigin,
  usedSlots,
  type Numbering,
  type NumberingContext,
} from "../model/numbering";
import { drawTextWith, type FontCache } from "./fonts";
import { SubstituteFont } from "./substituteFont";

function metrics(font: PDFFont | SubstituteFont, text: string, size: number) {
  if (font instanceof SubstituteFont)
    return {
      width: font.widthOf(text) * size,
      ascent: font.ascent,
      descent: -font.descent,
    };
  return {
    width: font.widthOfTextAtSize(text, size),
    ascent: font.heightAtSize(size, { descender: false }) / size,
    descent:
      (font.heightAtSize(size) -
        font.heightAtSize(size, { descender: false })) /
      size,
  };
}

/**
 * Draws every slot of `numbering` on the page, upright and at the edge of the
 * page as shown (CA8).
 */
export async function drawNumbering(
  page: PDFPage,
  entry: PageEntry,
  numbering: Numbering,
  ctx: NumberingContext,
  fonts: FontCache,
): Promise<void> {
  const rotation = effectiveRotation(entry);
  const geometry = new PageGeometry(entry.box, rotation, 1);
  const shown = { width: geometry.viewWidth, height: geometry.viewHeight };
  for (const slot of usedSlots(numbering)) {
    const text = resolveText(numbering.texts[slot]!, numbering, ctx).trim();
    if (!text) continue;
    const font = await fonts.forText(text, numbering.font, false, false);
    const m = metrics(font, text, numbering.size);
    const origin = slotOrigin(
      slot,
      shown,
      numbering,
      m.width,
      m.ascent,
      m.descent,
    );
    const at = geometry.toPdf(origin);
    drawTextWith(page, text, font, {
      x: at.x,
      y: at.y,
      size: numbering.size,
      color: numbering.color,
      lineHeight: numbering.size,
      rotate: rotation,
    });
  }
}
