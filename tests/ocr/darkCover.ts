// A synthetic book cover (spec 003, O017): light serif titles on a dark blue
// background speckled with stars, a red band with white lettering on top and
// coloured drawings below. It mimics the kind of cover that defeated the OCR,
// without using anyone's photo.
import { GlobalFonts, createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { Rgba } from "../../src/scan/image";
import { bundledFontPath } from "../helpers";
import { rng } from "../scan/synthPhoto";

/** The titles the OCR must read. */
export const COVER_TITLES = [
  "ANTOINE DE SAINT-EXUPÉRY",
  "El Principito",
  "CON LAS ACUARELAS DEL AUTOR",
] as const;

export const COVER_WIDTH = 1220;
export const COVER_HEIGHT = 1570;

let fontReady = false;
function ensureFont() {
  if (fontReady) return;
  GlobalFonts.registerFromPath(bundledFontPath("Tinos", "Regular"), "Tinos");
  GlobalFonts.registerFromPath(bundledFontPath("Tinos", "Bold"), "TinosBold");
  fontReady = true;
}

/**
 * Small capitals with wide tracking, centred on `cx`: the first letter of
 * each word at `cap` px, the rest at `small` px, `track` px between letters.
 */
function smallCaps(
  ctx: SKRSContext2D,
  text: string,
  cx: number,
  baseline: number,
  cap: number,
  small: number,
  track: number,
) {
  const glyphs = [...text].map((ch, i) => {
    const first = i === 0 || text[i - 1] === " ";
    const size = first ? cap : small;
    ctx.font = `${size}px Tinos`;
    return { ch, size, width: ctx.measureText(ch).width };
  });
  const total = glyphs.reduce((s, g) => s + g.width + track, -track);
  let x = cx - total / 2;
  for (const g of glyphs) {
    ctx.font = `${g.size}px Tinos`;
    ctx.fillText(g.ch, x, baseline);
    x += g.width + track;
  }
}

/** Text along an arc (the series name in the band). */
function arcText(
  ctx: SKRSContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
) {
  ctx.font = "40px TinosBold";
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((s, w) => s + w, 0);
  let angle = -Math.PI / 2 - total / radius / 2;
  [...text].forEach((ch, i) => {
    const half = widths[i]! / 2 / radius;
    ctx.save();
    ctx.translate(
      cx + radius * Math.cos(angle + half),
      cy + radius * Math.sin(angle + half),
    );
    ctx.rotate(angle + half + Math.PI / 2);
    ctx.fillText(ch, -widths[i]! / 2, 0);
    ctx.restore();
    angle += 2 * half;
  });
}

/** The cover as JPEG bytes (what a phone photo or a download would be). */
export function darkCoverJpeg(seed = 7): Buffer {
  ensureFont();
  const w = COVER_WIDTH;
  const h = COVER_HEIGHT;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const next = rng(seed);

  // Night sky: dark blue, slightly uneven, with stars of every size.
  const sky = ctx.createLinearGradient(0, 0, w * 0.3, h);
  sky.addColorStop(0, "#2d3291");
  sky.addColorStop(1, "#262a7c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // None on the title lines themselves: a star touching a letter changes it
  // (a P with a dot under it is an R), for any reader.
  const titleLines = [
    [360, 408],
    [462, 590],
    [628, 668],
  ];
  for (let i = 0; i < 2600; i++) {
    const r = 0.6 + next() ** 3 * 2.6;
    const alpha = 0.35 + next() * 0.65;
    const x = next() * w;
    const y = next() * h;
    if (
      x > 200 &&
      x < w - 200 &&
      titleLines.some(([top, bottom]) => y > top! - 4 && y < bottom! + 4)
    )
      continue;
    ctx.fillStyle = `rgba(250, 246, 225, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
  }

  // The collection's red band, with white lettering.
  ctx.fillStyle = "#c4174f";
  ctx.fillRect(0, 0, w, 250);
  ctx.fillStyle = "#ffffff";
  smallCaps(ctx, "COLECCIÓN", w / 2, 70, 34, 27, 9);
  arcText(ctx, "Los siete mares", w / 2, 640, 470);
  ctx.font = "30px Tinos";
  ctx.textAlign = "center";
  ctx.fillText("serie roja", w / 2, 228);
  ctx.textAlign = "left";

  // The titles, cream white on the sky.
  ctx.fillStyle = "#f6efd8";
  smallCaps(ctx, COVER_TITLES[0], w / 2, 400, 46, 36, 10);
  ctx.font = "128px Tinos";
  ctx.textAlign = "center";
  ctx.fillText(COVER_TITLES[1], w / 2, 560);
  ctx.textAlign = "left";
  smallCaps(ctx, COVER_TITLES[2], w / 2, 660, 36, 28, 8);

  // Watercolour-like drawings: a planet, a figure, a rose, a scarf.
  const blob = (x: number, y: number, rx: number, ry: number, c: string) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, next() * Math.PI, 0, 2 * Math.PI);
    ctx.fill();
  };
  blob(w / 2, h - 120, 520, 260, "#d8b25a");
  blob(w / 2 + 40, h - 360, 70, 190, "#5e9c55");
  blob(w / 2 + 40, h - 560, 60, 60, "#f1d36b");
  blob(w / 2 + 140, h - 470, 150, 22, "#e8c445");
  blob(w / 2 - 260, h - 300, 40, 40, "#d6413f");
  blob(w / 2 - 260, h - 230, 8, 60, "#3f7a3a");
  for (let i = 0; i < 40; i++)
    blob(
      w / 2 + (next() - 0.5) * 900,
      h - 110 + (next() - 0.5) * 120,
      20 + next() * 40,
      10 + next() * 20,
      next() < 0.5 ? "#b88f3f" : "#e5c97a",
    );

  return canvas.toBuffer("image/jpeg", 88);
}

/** The cover decoded back to pixels, JPEG artefacts included. */
export async function darkCover(seed = 7): Promise<Rgba> {
  const { loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(darkCoverJpeg(seed));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height);
  return { width: data.width, height: data.height, data: data.data };
}

/** Where the photo sits on the page of `darkPhotoJpeg` (pixels). */
export const PHOTO_BOX = { x0: 120, y0: 330, x1: 1120, y1: 1030 };

/**
 * A document page (A4 at 150 ppi) with black paragraphs and a large night
 * photo: sky, moon, stars, a building with lit windows in a grid and
 * reflections on water. Its highlights must not pass for light text.
 */
export function darkPhotoJpeg(seed = 3): Buffer {
  ensureFont();
  GlobalFonts.registerFromPath(bundledFontPath("Arimo", "Regular"), "Arimo");
  const w = 1240;
  const h = 1754;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const next = rng(seed);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#111111";
  ctx.font = "22px Arimo";
  const paragraph = (top: number) => {
    for (let line = 0; line < 6; line++)
      ctx.fillText(
        "El informe anual recoge la actividad del observatorio y sus noches.",
        PHOTO_BOX.x0,
        top + line * 34,
      );
  };
  paragraph(90);
  paragraph(1110);

  const { x0, y0, x1, y1 } = PHOTO_BOX;
  const pw = x1 - x0;
  const ph = y1 - y0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, pw, ph);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, y0, 0, y1);
  sky.addColorStop(0, "#0b1026");
  sky.addColorStop(0.6, "#1c2240");
  sky.addColorStop(1, "#0a0d18");
  ctx.fillStyle = sky;
  ctx.fillRect(x0, y0, pw, ph);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(255, 255, 240, ${0.3 + next() * 0.7})`;
    ctx.beginPath();
    ctx.arc(
      x0 + next() * pw,
      y0 + next() * ph * 0.55,
      0.5 + next() ** 3 * 2,
      0,
      2 * Math.PI,
    );
    ctx.fill();
  }
  // The moon, with a glow.
  const glow = ctx.createRadialGradient(
    x0 + 780,
    y0 + 140,
    30,
    x0 + 780,
    y0 + 140,
    150,
  );
  glow.addColorStop(0, "rgba(255, 250, 220, 0.6)");
  glow.addColorStop(1, "rgba(255, 250, 220, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x0 + 600, y0, 360, 320);
  ctx.fillStyle = "#f4efd6";
  ctx.beginPath();
  ctx.arc(x0 + 780, y0 + 140, 55, 0, 2 * Math.PI);
  ctx.fill();
  // Buildings with lit windows in a grid.
  for (const [bx, bw, bh] of [
    [40, 180, 300],
    [260, 140, 380],
    [430, 220, 260],
  ] as const) {
    ctx.fillStyle = "#06070c";
    ctx.fillRect(x0 + bx, y0 + 470 - bh, bw, bh);
    for (let wy = y0 + 470 - bh + 20; wy < y0 + 450; wy += 34)
      for (let wx = x0 + bx + 14; wx < x0 + bx + bw - 20; wx += 30)
        if (next() < 0.55) {
          ctx.fillStyle = next() < 0.5 ? "#f6d77a" : "#fff1b8";
          ctx.fillRect(wx, wy, 14, 20);
        }
  }
  // Water with reflections.
  ctx.fillStyle = "#070a14";
  ctx.fillRect(x0, y0 + 470, pw, ph - 470);
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(246, 215, 122, ${0.2 + next() * 0.6})`;
    ctx.fillRect(
      x0 + next() * pw,
      y0 + 480 + next() * (ph - 490),
      10 + next() * 60,
      2 + next() * 3,
    );
  }
  ctx.restore();
  return canvas.toBuffer("image/jpeg", 88);
}

/** The photo document decoded back to pixels. */
export async function darkPhotoPage(seed = 3): Promise<Rgba> {
  const { loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(darkPhotoJpeg(seed));
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, image.width, image.height);
  return { width: data.width, height: data.height, data: data.data };
}
