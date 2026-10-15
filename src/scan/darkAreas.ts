/**
 * Light text on dark backgrounds (spec 003, O017): book covers, banners,
 * dark table headers. The photocopy assumes dark ink on light paper; on a
 * dark background it estimates the "paper" from the light letters and turns
 * them into white letters in black blotches that no OCR can read. Those
 * areas are found and inverted first, and the specks they leave (a starry
 * sky, dust) are removed.
 */
import { grayscale, photocopyGray, rowBytes, type Bitmap } from "./enhance";
import { toGray, type Gray, type Rgba } from "./image";

const isInk = (b: Bitmap, x: number, y: number) =>
  !(b.data[y * rowBytes(b.width) + (x >> 3)]! & (0x80 >> (x & 7)));

/** Below this median brightness, a stretch of the page is a dark background. */
const DARK_BACKGROUND = 96;

/**
 * Where the page is a dark background (light text on it, as on a book
 * cover or a dark banner): 1 per pixel, or null when there is none. The
 * background of each cell of a grid is its median brightness; the cells'
 * verdicts are interpolated between their centres, so the edge of a dark
 * area follows it rather than the grid.
 */
export function darkBackground(v: Gray): Uint8Array | null {
  const { width: w, height: h } = v;
  const cell = Math.max(16, Math.round(Math.min(w, h) / 20));
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const cells = new Float32Array(cols * rows);
  const hist = new Uint32Array(256);
  let any = false;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      hist.fill(0);
      const x1 = Math.min(w, (c + 1) * cell);
      const y1 = Math.min(h, (r + 1) * cell);
      let n = 0;
      for (let y = r * cell; y < y1; y += 2)
        for (let x = c * cell; x < x1; x += 2) {
          hist[Math.min(255, Math.max(0, Math.round(v.data[y * w + x]!)))]!++;
          n++;
        }
      let seen = 0;
      let median = 0;
      while (median < 255 && (seen += hist[median]!) < n / 2) median++;
      if (median < DARK_BACKGROUND) {
        cells[r * cols + c] = 1;
        any = true;
      }
    }
  if (!any) return null;
  // Only areas at least 3 × 3 cells: a large black letter or a dark photo
  // detail is not a background (opening of the cell map; outside the page
  // counts as dark, so areas reaching the edge are kept).
  const at = (map: Float32Array, r: number, c: number) =>
    r < 0 || c < 0 || r >= rows || c >= cols ? 1 : map[r * cols + c]!;
  const eroded = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let all = 1;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++)
          all = Math.min(all, at(cells, r + dr, c + dc));
      eroded[r * cols + c] = all;
    }
  const dark = new Float32Array(cols * rows);
  any = false;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!cells[r * cols + c]) continue;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (
            rr >= 0 &&
            cc >= 0 &&
            rr < rows &&
            cc < cols &&
            eroded[rr * cols + cc]
          ) {
            dark[r * cols + c] = 1;
            any = true;
          }
        }
    }
  if (!any) return null;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(rows - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const r0 = Math.floor(fy);
    const r1 = Math.min(rows - 1, r0 + 1);
    const ty = fy - r0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(cols - 1, Math.max(0, (x + 0.5) / cell - 0.5));
      const c0 = Math.floor(fx);
      const c1 = Math.min(cols - 1, c0 + 1);
      const tx = fx - c0;
      const top = dark[r0 * cols + c0]! * (1 - tx) + dark[r0 * cols + c1]! * tx;
      const bottom =
        dark[r1 * cols + c0]! * (1 - tx) + dark[r1 * cols + c1]! * tx;
      if (top * (1 - ty) + bottom * ty >= 0.5) mask[y * w + x] = 1;
    }
  }
  return mask;
}

/**
 * Removes specks inside the dark areas (stars, dust, JPEG noise): ink
 * components under `maxSide` px across with no larger component (a letter)
 * within `gap` px. Accents and full stops stay, next to their letters.
 */
export function removeSpecks(
  bitmap: Bitmap,
  inside: Uint8Array,
  maxSide: number,
  gap: number,
): Bitmap {
  const { width: w, height: h } = bitmap;
  const stride = rowBytes(w);
  const data = bitmap.data.slice();
  const label = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  const boxes: number[] = []; // x0, y0, x1, y1 per component
  for (let start = 0; start < w * h; start++) {
    if (label[start]) continue;
    const sx = start % w;
    const sy = (start - sx) / w;
    if (!isInk(bitmap, sx, sy)) continue;
    const id = boxes.length / 4 + 1;
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    let x0 = sx;
    let x1 = sx;
    let y0 = sy;
    let y1 = sy;
    while (top > 0) {
      const i = stack[--top]!;
      const x = i % w;
      const y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (label[j] || !isInk(bitmap, nx, ny)) continue;
          label[j] = id;
          stack[top++] = j;
        }
    }
    boxes.push(x0, y0, x1, y1);
  }
  const small = (k: number) =>
    boxes[k + 2]! - boxes[k]! < maxSide &&
    boxes[k + 3]! - boxes[k + 1]! < maxSide;
  const big = new Uint8Array(boxes.length / 4 + 1);
  for (let k = 0; k < boxes.length; k += 4) big[k / 4 + 1] = small(k) ? 0 : 1;
  for (let k = 0; k < boxes.length; k += 4) {
    const [x0, y0, x1, y1] = [
      boxes[k]!,
      boxes[k + 1]!,
      boxes[k + 2]!,
      boxes[k + 3]!,
    ];
    if (big[k / 4 + 1]) continue;
    const cx = (x0 + x1) >> 1;
    const cy = (y0 + y1) >> 1;
    if (!inside[cy * w + cx]) continue;
    const id = k / 4 + 1;
    let alone = true;
    const ex1 = Math.min(w - 1, x1 + gap);
    const ey1 = Math.min(h - 1, y1 + gap);
    for (let y = Math.max(0, y0 - gap); alone && y <= ey1; y++)
      for (let x = Math.max(0, x0 - gap); x <= ex1; x++) {
        const l = label[y * w + x]!;
        if (l && l !== id && big[l]) {
          alone = false;
          break;
        }
      }
    if (!alone) continue;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if (label[y * w + x] === id)
          data[y * stride + (x >> 3)]! |= 0x80 >> (x & 7);
  }
  return { width: w, height: h, data };
}

/** Black-and-white copy with dark text on white everywhere. */
export function readableCopy(image: Rgba): Bitmap {
  const v = toGray(image);
  const dark = darkBackground(v);
  if (dark)
    for (let i = 0; i < v.data.length; i++)
      if (dark[i]) v.data[i] = 255 - v.data[i]!;
  const bitmap = photocopyGray(v);
  if (!dark) return bitmap;
  // Dark backgrounds are often speckled (a starry sky, paper fibres).
  const speck = Math.max(3, Math.round(Math.min(v.width, v.height) / 150));
  return removeSpecks(bitmap, dark, speck, Math.round(speck / 2));
}

/**
 * Greyscale copy that leaves dark backgrounds as they are: normalising the
 * paper would turn them into light blotches with dark halos around the text.
 */
export function readableGray(image: Rgba): Gray {
  const out = grayscale(image);
  const raw = toGray(image);
  const dark = darkBackground(raw);
  if (dark)
    for (let i = 0; i < out.data.length; i++)
      if (dark[i]) out.data[i] = raw.data[i]!;
  return out;
}
