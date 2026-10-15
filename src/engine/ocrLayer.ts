import {
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSqueeze,
  setFontAndSize,
  setTextMatrix,
  setTextRenderingMode,
  showText,
  TextRenderingMode,
  type PDFOperator,
  type PDFPage,
} from "pdf-lib";
import type { OcrBox, OcrItem } from "../model/document";
import type { Rect } from "../model/geometry";
import { coveredWord } from "../ocr/ocrText";
import type { FontCache } from "./fonts";
import type { SubstituteFont } from "./substituteFont";

/** Font size and baseline that make `font` fill `box` from descender to ascender. */
export function fitBox(font: SubstituteFont, box: OcrBox) {
  const size = box.height / (font.ascent - font.descent);
  return { size, rise: -font.descent * size };
}

/**
 * Writes the recognized text of a page (spec 003). Words are invisible
 * (3 Tr), each stretched with Tz to the width of its box, so viewers select
 * and find them where they are in the image. Words under an edit of the
 * scanned text (spec 010) are left out: the edit draws the new text visibly.
 */
export async function drawOcr(
  page: PDFPage,
  item: OcrItem,
  fonts: FontCache,
  /** Areas of edited scanned text (spec 010): their old words are left out. */
  covered: Rect[] = [],
): Promise<void> {
  const font = await fonts.substitute("Arimo", "Regular");
  const name = page.node.newFontDictionary(font.name, font.ref);
  const rad = (item.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  /** Text-direction frame at the bottom-left of `box`, shifted up by `rise`. */
  const frame = (box: OcrBox, rise = 0) =>
    [
      cos,
      sin,
      -sin,
      cos,
      box.at.x - sin * rise,
      box.at.y + cos * rise,
    ] as const;

  const invisible: PDFOperator[] = [];
  for (const line of item.lines)
    for (const word of line.words) {
      const text = word.text.trim();
      if (!text || !font.covers(text)) continue;
      if (coveredWord(item.rotate, word, covered)) continue;
      const { size, rise } = fitBox(font, word);
      const natural = font.widthOf(text) * size;
      if (natural <= 0) continue;
      invisible.push(
        setFontAndSize(name, size),
        setCharacterSqueeze((word.width / natural) * 100),
        setTextMatrix(...frame(word, rise)),
        showText(font.encode(text)),
      );
    }
  if (invisible.length === 0) return;
  page.pushOperators(
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
    ...invisible,
    endText(),
    popGraphicsState(),
  );
}
