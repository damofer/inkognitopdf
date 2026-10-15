/**
 * Coordinate conversion between PDF user space and the on-screen page.
 *
 * Every edit is stored in the PDF user space of its page as it exists in the
 * original file (origin bottom-left of the MediaBox, y up, unrotated), so the
 * engine can draw it without further transformation. The screen shows the page
 * with its effective rotation applied, scaled by the zoom, origin top-left.
 */
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };
export type Rotation = 0 | 90 | 180 | 270;
/** [x0, y0, x1, y1] */
export type Box = readonly [number, number, number, number];

export function normalizeRotation(degrees: number): Rotation {
  return ((((Math.round(degrees / 90) * 90) % 360) + 360) % 360) as Rotation;
}

export class PageGeometry {
  constructor(
    readonly box: Box,
    readonly rotation: Rotation,
    readonly scale: number,
  ) {}

  /** Unrotated page size in points. */
  get pdfWidth() {
    return this.box[2] - this.box[0];
  }
  get pdfHeight() {
    return this.box[3] - this.box[1];
  }

  /** On-screen size in CSS pixels, rotation applied. */
  get viewWidth() {
    const w = this.rotation % 180 === 0 ? this.pdfWidth : this.pdfHeight;
    return w * this.scale;
  }
  get viewHeight() {
    const h = this.rotation % 180 === 0 ? this.pdfHeight : this.pdfWidth;
    return h * this.scale;
  }

  toView({ x, y }: Point): Point {
    const [x0, y0, x1, y1] = this.box;
    const s = this.scale;
    switch (this.rotation) {
      case 0:
        return { x: (x - x0) * s, y: (y1 - y) * s };
      case 90:
        return { x: (y - y0) * s, y: (x - x0) * s };
      case 180:
        return { x: (x1 - x) * s, y: (y - y0) * s };
      case 270:
        return { x: (y1 - y) * s, y: (x1 - x) * s };
    }
  }

  toPdf({ x, y }: Point): Point {
    const [x0, y0, x1, y1] = this.box;
    const s = this.scale;
    switch (this.rotation) {
      case 0:
        return { x: x0 + x / s, y: y1 - y / s };
      case 90:
        return { x: x0 + y / s, y: y0 + x / s };
      case 180:
        return { x: x1 - x / s, y: y0 + y / s };
      case 270:
        return { x: x1 - y / s, y: y1 - x / s };
    }
  }

  /** Axis-aligned on-screen rectangle of a PDF-space rectangle. */
  rectToView(r: Rect): Rect {
    return boundingRect([
      this.toView({ x: r.x, y: r.y }),
      this.toView({ x: r.x + r.width, y: r.y + r.height }),
    ]);
  }

  rectToPdf(r: Rect): Rect {
    return boundingRect([
      this.toPdf({ x: r.x, y: r.y }),
      this.toPdf({ x: r.x + r.width, y: r.y + r.height }),
    ]);
  }
}

export function boundingRect(points: Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function rectFromCorners(a: Point, b: Point): Rect {
  return boundingRect([a, b]);
}
