/**
 * Signatures and initials adopted by the user (spec 004, HU1): drawn strokes,
 * typed text in a handwriting font, or an image with a transparent background.
 */
import { t, type MessageKey } from "../i18n";

export type HandwritingFont = "DancingScript" | "GreatVibes" | "Caveat";

export const HANDWRITING_FONTS: { font: HandwritingFont; label: string }[] = [
  { font: "DancingScript", label: "Dancing Script" },
  { font: "GreatVibes", label: "Great Vibes" },
  { font: "Caveat", label: "Caveat" },
];

/** A point of a drawn stroke and the pen width there. */
export interface InkPoint {
  x: number;
  y: number;
  w: number;
}

export type SignatureAsset =
  | {
      kind: "drawn";
      /** Drawing box; y grows downwards, like the canvas it was drawn on. */
      width: number;
      height: number;
      strokes: InkPoint[][];
      color: string;
    }
  | { kind: "typed"; text: string; font: HandwritingFont; color: string }
  | {
      kind: "image";
      /** PNG with an alpha channel. */
      png: Uint8Array;
      width: number;
      height: number;
    };

export type SignatureRole = "signature" | "initials";

/** Fields a signer fills in a signing plan (spec 004, HU6). */
export type SignFieldType = "signature" | "initials" | "date" | "name" | "text";

const SIGN_FIELD_KEYS = {
  signature: "signField.signature",
  initials: "signField.initials",
  date: "signField.date",
  name: "signField.name",
  text: "signField.text",
} as const satisfies Record<SignFieldType, MessageKey>;

/** Name of a field type, in the interface language. */
export const signFieldLabel = (type: SignFieldType) => t(SIGN_FIELD_KEYS[type]);

/** Bounds of a drawing: the strokes' extent, padded by the pen width. */
export function inkBounds(strokes: InkPoint[][]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const stroke of strokes)
    for (const p of stroke) {
      x0 = Math.min(x0, p.x - p.w / 2);
      y0 = Math.min(y0, p.y - p.w / 2);
      x1 = Math.max(x1, p.x + p.w / 2);
      y1 = Math.max(y1, p.y + p.w / 2);
    }
  return x0 > x1 ? null : { x0, y0, x1, y1 };
}

/** The drawing moved to the origin and cropped to its strokes. */
export function cropDrawing(
  strokes: InkPoint[][],
  color: string,
): SignatureAsset | null {
  const b = inkBounds(strokes);
  if (!b) return null;
  return {
    kind: "drawn",
    width: b.x1 - b.x0,
    height: b.y1 - b.y0,
    color,
    strokes: strokes.map((s) =>
      s.map((p) => ({ x: p.x - b.x0, y: p.y - b.y0, w: p.w })),
    ),
  };
}

/**
 * Catmull-Rom interpolation between captured points, so fast strokes (few
 * samples) still look smooth. Width is interpolated linearly.
 */
export function smoothStroke(points: InkPoint[], steps = 4): InkPoint[] {
  if (points.length < 3) return points.slice();
  const out: InkPoint[] = [points[0]!];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const c = (a: number, b: number, d: number, e: number) =>
        0.5 *
        (2 * b +
          (-a + d) * t +
          (2 * a - 5 * b + 4 * d - e) * t2 +
          (-a + 3 * b - 3 * d + e) * t3);
      out.push({
        x: c(p0.x, p1.x, p2.x, p3.x),
        y: c(p0.y, p1.y, p2.y, p3.y),
        w: p1.w + (p2.w - p1.w) * t,
      });
    }
  }
  return out;
}

/** Pen width from the speed (px/ms) or, when the device reports it, the pressure. */
export function penWidth(base: number, speed: number, pressure?: number) {
  if (pressure !== undefined && pressure > 0 && pressure !== 0.5)
    return base * (0.5 + pressure);
  return base * Math.max(0.45, Math.min(1.3, 1.3 - speed * 0.35));
}
