/**
 * Selectable text of an OCR item on screen (spec 003, CA4 in the editor):
 * transparent words over the image, like pdf.js's text layer, so recognized
 * text can be selected, copied and highlighted before saving.
 */
import { Fragment, type CSSProperties } from "react";
import type { OcrBox, OcrItem } from "../model/document";
import type { PageGeometry, Rect } from "../model/geometry";
import { coveredWord, OCR_FONT } from "./ocrText";

let measure: CanvasRenderingContext2D | null = null;

/** Width of `text` at 100 px in the OCR font (0 when it cannot be measured). */
function naturalWidth(text: string): number {
  measure ??= document.createElement("canvas").getContext("2d");
  if (!measure) return 0;
  measure.font = `100px ${OCR_FONT}`;
  return measure.measureText(text).width;
}

function boxStyle(
  box: OcrBox,
  text: string,
  rotate: number,
  rotation: number,
  geometry: PageGeometry,
): CSSProperties {
  const a = (rotate * Math.PI) / 180;
  // Top-left corner of the box in its text direction.
  const top = geometry.toView({
    x: box.at.x - Math.sin(a) * box.height,
    y: box.at.y + Math.cos(a) * box.height,
  });
  const height = box.height * geometry.scale;
  const width = box.width * geometry.scale;
  const natural = (naturalWidth(text) * height) / 100;
  const stretch = natural > 0 ? width / natural : 1;
  return {
    left: top.x,
    top: top.y,
    fontSize: `${height}px`,
    lineHeight: `${height}px`,
    transform: `rotate(${rotation}deg) scaleX(${stretch})`,
  };
}

export function OcrTextLayer({
  item,
  geometry,
  rotation,
  covered = [],
}: {
  item: OcrItem;
  geometry: PageGeometry;
  /** On-screen rotation of the text, in degrees clockwise. */
  rotation: number;
  /** Areas of edited scanned text (spec 010): their old words are left out. */
  covered?: Rect[];
}) {
  return (
    <div className="ocr-text" data-testid="ocr-text">
      {item.lines.map((line, i) => {
        const words = line.words.filter(
          (w) => !coveredWord(item.rotate, w, covered),
        );
        if (words.length === 0) return null;
        return (
          <Fragment key={i}>
            {words.map((word, j) => (
              // The space goes inside the word: loose spaces between
              // positioned spans collapse and would not be copied.
              <span
                key={j}
                style={boxStyle(
                  word,
                  word.text,
                  item.rotate,
                  rotation,
                  geometry,
                )}
              >
                {j < words.length - 1 ? `${word.text} ` : word.text}
              </span>
            ))}
            <br />
          </Fragment>
        );
      })}
    </div>
  );
}
