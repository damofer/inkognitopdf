// Spec 022, CA7: the numbering over a page, as the saved file will show it.
import { locale } from "../i18n";
import { CSS_FONT } from "../editor/itemOps";
import type { PageGeometry } from "../model/geometry";
import {
  numberingDate,
  resolveText,
  slotOrigin,
  usedSlots,
  type Numbering,
} from "../model/numbering";

interface NumberingPreviewProps {
  numbering: Numbering;
  geometry: PageGeometry;
  n: number;
  total: number;
}

/** Distance from the top of a line box of height 1em to its baseline. */
const BASELINE = 0.83;

export function NumberingPreview({
  numbering,
  geometry,
  n,
  total,
}: NumberingPreviewProps) {
  const scale = geometry.scale;
  const page = {
    width: geometry.viewWidth / scale,
    height: geometry.viewHeight / scale,
  };
  const date = numberingDate(new Date(), locale());
  const size = numbering.size * scale;
  return usedSlots(numbering).map((slot) => {
    const text = resolveText(numbering.texts[slot]!, numbering, {
      n,
      total,
      date,
    }).trim();
    const { y } = slotOrigin(slot, page, numbering, 0);
    const margin = numbering.margin * scale;
    const align = slot[1];
    return (
      <div
        key={slot}
        className="numbering-stamp"
        data-slot={slot}
        style={{
          top: y * scale - BASELINE * size,
          left: align === "l" ? margin : align === "c" ? "50%" : undefined,
          right: align === "r" ? margin : undefined,
          transform: align === "c" ? "translateX(-50%)" : undefined,
          fontFamily: CSS_FONT[numbering.font],
          fontSize: size,
          color: numbering.color,
        }}
      >
        {text}
      </div>
    );
  });
}
