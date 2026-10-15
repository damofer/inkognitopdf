// Synthetic photos of a test page (spec 002, S001). A page with known content
// is projected by a pinhole camera (principal point at the image centre) onto
// a background, with shadow, grey paper, vignetting and noise. The true
// corners and the ideal page are returned, so detection, rectification and
// the photocopy filter can be measured without third-party photos.
import { GlobalFonts, createCanvas } from "@napi-rs/canvas";
import type { Gray, Rgba } from "../../src/scan/image";
import { homography, project, type Quad } from "../../src/scan/homography";
import { bundledFontPath } from "../helpers";

let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  GlobalFonts.registerFromPath(bundledFontPath("Arimo", "Regular"), "Arimo");
  GlobalFonts.registerFromPath(bundledFontPath("Arimo", "Bold"), "ArimoBold");
  fontReady = true;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(next: () => number): number {
  const u = Math.max(next(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}

export const TEST_LINES = [
  "Informe de prueba para el escaner",
  "La rapida zorra marron salta sobre el perro perezoso.",
  "Factura 2026-0142   Importe 1.234,56 EUR",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789",
  "abcdefghijklmnopqrstuvwxyz",
];

export interface TestPage {
  /** Ideal page, grey levels 0–255 (white paper, black ink). */
  page: Gray;
  /** Page size in points. */
  widthPt: number;
  heightPt: number;
  /** Pixels per inch of `page`. */
  ppi: number;
  /** Horizontal and vertical straight lines drawn on the page, in page pixels. */
  rules: { y: number; x0: number; x1: number }[];
  columns: { x: number; y0: number; y1: number }[];
}

/** A4 (or another size) test page with text, rules, a box and a table. */
export function testPage(
  ppi = 100,
  widthPt = 595.28,
  heightPt = 841.89,
): TestPage {
  ensureFont();
  const width = Math.round((widthPt / 72) * ppi);
  const height = Math.round((heightPt / 72) * ppi);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const pt = ppi / 72;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  const margin = 56 * pt;
  let y = margin + 18 * pt;
  ctx.font = `${18 * pt}px ArimoBold`;
  ctx.fillText(TEST_LINES[0]!, margin, y);
  const rules: TestPage["rules"] = [];
  const columns: TestPage["columns"] = [];
  y += 14 * pt;
  ctx.lineWidth = Math.max(1, 1.5 * pt);
  const rule = (yy: number) => {
    ctx.beginPath();
    ctx.moveTo(margin, yy);
    ctx.lineTo(width - margin, yy);
    ctx.stroke();
    rules.push({ y: yy, x0: margin, x1: width - margin });
  };
  rule(y);
  for (const size of [14, 12, 10])
    for (const line of TEST_LINES.slice(1)) {
      y += size * 1.6 * pt;
      ctx.font = `${size * pt}px Arimo`;
      ctx.fillText(line, margin, y);
    }
  // A table.
  y += 24 * pt;
  const top = y;
  const rows = 5;
  const rowH = 20 * pt;
  for (let r = 0; r <= rows; r++) rule(top + r * rowH);
  const cols = [margin, margin + 160 * pt, margin + 320 * pt, width - margin];
  for (const x of cols) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + rows * rowH);
    ctx.stroke();
    columns.push({ x, y0: top, y1: top + rows * rowH });
  }
  ctx.font = `${11 * pt}px Arimo`;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < 3; c++)
      ctx.fillText(
        `Celda ${r + 1}.${c + 1}`,
        cols[c]! + 6 * pt,
        top + r * rowH + 14 * pt,
      );
  // A solid box near the bottom.
  ctx.fillRect(margin, height - margin - 40 * pt, 120 * pt, 24 * pt);
  ctx.font = `${10 * pt}px Arimo`;
  ctx.fillText(TEST_LINES[1]!, margin + 140 * pt, height - margin - 22 * pt);

  const rgba = ctx.getImageData(0, 0, width, height).data;
  const page: Gray = { width, height, data: new Float32Array(width * height) };
  for (let i = 0; i < width * height; i++)
    page.data[i] =
      0.299 * rgba[i * 4]! +
      0.587 * rgba[i * 4 + 1]! +
      0.114 * rgba[i * 4 + 2]!;
  return { page, widthPt, heightPt, ppi, rules, columns };
}

export interface PhotoOptions {
  seed: number;
  width?: number;
  height?: number;
  /** Max tilt of the page plane, degrees. */
  tilt?: number;
  /** In-plane rotation range, degrees. */
  spin?: number;
  /** Share of the photo height the page covers (roughly). */
  fill?: number;
  background?: "plain" | "texture";
  /** Darkening of the shadow, 0–1. */
  shadow?: number;
  /** Paper grey level (255 = white). */
  paper?: number;
  noise?: number;
  /** No page at all (only background). */
  empty?: boolean;
  page?: TestPage;
}

export interface Photo {
  photo: Rgba;
  /** True page corners in the photo: TL, TR, BR, BL of the page. */
  corners: Quad;
  page: TestPage;
}

/** Projects the page with a pinhole camera. */
export function synthPhoto(options: PhotoOptions): Photo {
  const next = rng(options.seed);
  const W = options.width ?? 1600;
  const H = options.height ?? 1200;
  const page = options.page ?? testPage();
  const tiltMax = ((options.tilt ?? 25) * Math.PI) / 180;
  const spinMax = ((options.spin ?? 10) * Math.PI) / 180;
  const rx = (next() * 2 - 1) * tiltMax;
  const ry = (next() * 2 - 1) * tiltMax * 0.7;
  const rz = (next() * 2 - 1) * spinMax;
  const f = W * (0.8 + next() * 0.5);
  // Page in 3D, centred at the origin, in page pixels.
  const pw = page.page.width;
  const ph = page.page.height;
  const cosx = Math.cos(rx);
  const sinx = Math.sin(rx);
  const cosy = Math.cos(ry);
  const siny = Math.sin(ry);
  const cosz = Math.cos(rz);
  const sinz = Math.sin(rz);
  const fill = options.fill ?? 0.8;
  const distance = (f * ph) / (H * fill);
  const offX = (next() * 2 - 1) * 0.06 * W;
  const offY = (next() * 2 - 1) * 0.05 * H;
  const camera = (px: number, py: number) => {
    let x = px - pw / 2;
    let y = py - ph / 2;
    let z = 0;
    // Spin, then tilt about x, then about y.
    [x, y] = [x * cosz - y * sinz, x * sinz + y * cosz];
    [y, z] = [y * cosx - z * sinx, y * sinx + z * cosx];
    [x, z] = [x * cosy + z * siny, -x * siny + z * cosy];
    z += distance;
    // Move the page in 3D (not the image): the principal point stays at the
    // centre of the photo, as in a real camera.
    x += (offX * distance) / f;
    y += (offY * distance) / f;
    return { x: (f * x) / z + W / 2, y: (f * y) / z + H / 2 };
  };
  const corners: Quad = [
    camera(0, 0),
    camera(pw, 0),
    camera(pw, ph),
    camera(0, ph),
  ];
  const toPage = homography(corners, [
    { x: 0, y: 0 },
    { x: pw, y: 0 },
    { x: pw, y: ph },
    { x: 0, y: ph },
  ])!;

  const background = options.background ?? "plain";
  const bgBase = [70 + next() * 60, 60 + next() * 50, 50 + next() * 40];
  const freq = [0.01 + next() * 0.02, 0.05 + next() * 0.05];
  const shadow = options.shadow ?? 0.3;
  const shadowAngle = next() * Math.PI * 2;
  const sdx = Math.cos(shadowAngle);
  const sdy = Math.sin(shadowAngle);
  const paper = options.paper ?? 235;
  const tint = [paper, paper * 0.98, paper * 0.93];
  const noise = options.noise ?? 4;
  const data = new Uint8ClampedArray(W * H * 4);
  const pd = page.page.data;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      // Shadow: a soft ramp across the photo, darkest on one side.
      const t =
        ((x - W / 2) * sdx + (y - H / 2) * sdy) / (0.5 * Math.hypot(W, H));
      const s = 1 - shadow * Math.min(1, Math.max(0, (t + 0.2) / 1.2));
      const vignette =
        1 - 0.12 * (((x - W / 2) / W) ** 2 + ((y - H / 2) / H) ** 2) * 4;
      let rgb: number[];
      const p = options.empty
        ? null
        : project(toPage, { x: x + 0.5, y: y + 0.5 });
      if (p && p.x >= 0 && p.y >= 0 && p.x < pw && p.y < ph) {
        const fx = Math.min(p.x - 0.5, pw - 1);
        const fy = Math.min(p.y - 0.5, ph - 1);
        const x0 = Math.max(0, Math.floor(fx));
        const y0 = Math.max(0, Math.floor(fy));
        const x1 = Math.min(x0 + 1, pw - 1);
        const y1 = Math.min(y0 + 1, ph - 1);
        const ax = Math.max(0, fx - x0);
        const ay = Math.max(0, fy - y0);
        const g =
          (pd[y0 * pw + x0]! * (1 - ax) + pd[y0 * pw + x1]! * ax) * (1 - ay) +
          (pd[y1 * pw + x0]! * (1 - ax) + pd[y1 * pw + x1]! * ax) * ay;
        // Ink is not perfectly black in a photo.
        const ink = g / 255;
        rgb = tint.map((c) => 30 + (c - 30) * ink);
      } else if (background === "texture") {
        const grain =
          Math.sin(x * freq[0]! + Math.sin(y * freq[1]!) * 3) * 18 +
          Math.sin((x + y) * freq[1]!) * 8;
        rgb = bgBase.map((c) => c + grain);
      } else rgb = bgBase;
      for (let c = 0; c < 3; c++)
        data[o + c] = rgb[c]! * s * vignette + gaussian(next) * noise;
      data[o + 3] = 255;
    }
  return { photo: { width: W, height: H, data }, corners, page };
}
