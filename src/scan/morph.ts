/**
 * The straightening animation (spec 030): the sheet goes from where it is in
 * the photo to the rectangle of the finished page, its corners moving in
 * straight lines and the photo following them in perspective. Geometry only;
 * the browser draws each frame with a CSS transform.
 */
import { aspectRatio, homography, type Mat3, type Quad } from "./homography";
import { pageSize, type PaperSize } from "./pipeline";

export interface Size {
  width: number;
  height: number;
}

export interface Placed extends Size {
  x: number;
  y: number;
}

/** Duration of the animation, ms (CA3: under 1 s). */
export const MORPH_MS = 750;

/** The largest `aspect` (width / height) rectangle centred in `box`. */
export function fitIn(box: Size, aspect: number): Placed {
  const width = Math.min(box.width, box.height * aspect);
  const height = width / aspect;
  return {
    x: (box.width - width) / 2,
    y: (box.height - height) / 2,
    width,
    height,
  };
}

/** Width / height of the finished page, as shown after `quarters` turns. */
export function pageAspect(
  quad: Quad,
  photo: Size,
  paper: PaperSize,
  quarters: number,
): number {
  const { widthPt, heightPt } = pageSize(
    aspectRatio(quad, photo.width, photo.height),
    paper,
  );
  return quarters % 2 ? heightPt / widthPt : widthPt / heightPt;
}

/**
 * Where the sheet's corners start (as on the crop screen: the photo fitted in
 * `box`) and end (the page's rectangle), in `box` pixels. After `quarters`
 * clockwise turns, the page's top-left corner ends `quarters` corners further
 * round the rectangle.
 */
export function morphEnds(
  quad: Quad,
  photo: Size,
  box: Size,
  aspect: number,
  quarters: number,
): { photo: Placed; start: Quad; end: Quad } {
  const shown = fitIn(box, photo.width / photo.height);
  const k = shown.width / photo.width;
  const start = quad.map((p) => ({
    x: shown.x + p.x * k,
    y: shown.y + p.y * k,
  })) as Quad;
  const page = fitIn(box, aspect);
  const rect: Quad = [
    { x: page.x, y: page.y },
    { x: page.x + page.width, y: page.y },
    { x: page.x + page.width, y: page.y + page.height },
    { x: page.x, y: page.y + page.height },
  ];
  const q = ((quarters % 4) + 4) % 4;
  const end = quad.map((_, i) => rect[(i + q) % 4]!) as Quad;
  return { photo: shown, start, end };
}

/** Slow out, slow in. */
export function ease(t: number): number {
  const s = Math.min(1, Math.max(0, t));
  return s < 0.5 ? 4 * s * s * s : 1 - (-2 * s + 2) ** 3 / 2;
}

/** The corners `t` (0…1, eased) of the way from `start` to `end`. */
export function cornersAt(start: Quad, end: Quad, t: number): Quad {
  const e = ease(t);
  return start.map((p, i) => ({
    x: p.x + (end[i]!.x - p.x) * e,
    y: p.y + (end[i]!.y - p.y) * e,
  })) as Quad;
}

/**
 * CSS `matrix3d` (with `transform-origin: 0 0`) that takes an element's
 * points `from` to `to`, or null when the corners are degenerate.
 */
export function cssMatrix(from: Quad, to: Quad): string | null {
  const h = homography(from, to);
  if (!h) return null;
  // Points inside the sheet must stay in front (w > 0).
  const cx = (from[0].x + from[1].x + from[2].x + from[3].x) / 4;
  const cy = (from[0].y + from[1].y + from[2].y + from[3].y) / 4;
  const sign = h[6] * cx + h[7] * cy + h[8] < 0 ? -1 : 1;
  const [a, b, c, d, e, f, g, k, i] = h.map((x) => x * sign) as Mat3;
  return `matrix3d(${[a, d, 0, g, b, e, 0, k, 0, 0, 1, 0, c, f, 0, i].join(",")})`;
}
