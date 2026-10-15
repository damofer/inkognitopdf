// Renders the link-preview images (Open Graph) from the logo SVGs in
// public/brand/: og-image.png (1200×630) and og-image-square.png (600×600),
// shown when a link is shared on WhatsApp, Telegram, X, Facebook or LinkedIn.
// Uses the Chrome that Playwright already drives for the e2e tests.
// Run after changing the logo: node scripts/render-og.mjs
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const brand = join(import.meta.dirname, "..", "public", "brand");
const dataUrl = async (name) =>
  `data:image/svg+xml;base64,${(await readFile(join(brand, name))).toString("base64")}`;
const mark = await dataUrl("mark-dark.svg");
const logo = await dataUrl("logo-dark.svg");

const style = `
  * { box-sizing: border-box; margin: 0; }
  body {
    width: var(--w); height: var(--h); overflow: hidden;
    background:
      radial-gradient(circle at 18% 50%, rgb(76 195 154 / 0.22), transparent 42%),
      radial-gradient(rgb(255 255 255 / 0.05) 1.5px, transparent 1.5px) 0 0 / 28px 28px,
      #23272f;
    color: #ecf1ef;
    font-family: "Segoe UI", system-ui, sans-serif;
  }
  .badge {
    display: grid; place-items: center; border-radius: 50%;
    background: linear-gradient(135deg, #5ed3a9, #2fa884);
    box-shadow: 0 24px 60px rgb(0 0 0 / 0.35), inset 0 2px 0 rgb(255 255 255 / 0.25);
  }
  .badge img { filter: brightness(0) saturate(100%) invert(6%) sepia(10%) saturate(1000%) hue-rotate(110deg); }
  .tagline { font-weight: 700; letter-spacing: -0.02em; line-height: 1.12; }
  .tagline em { font-style: normal; color: #4cc39a; }
  .chips { display: flex; gap: 12px; flex-wrap: wrap; }
  .chips span {
    padding: 8px 16px; border-radius: 999px; font-size: 22px; font-weight: 600;
    background: #2b303a; box-shadow: inset 0 0 0 1.5px #3b4250; color: #c9d1cd;
  }
`;

const wide = `
  <style>${style}
    body { --w: 1200px; --h: 630px; display: flex; align-items: center; gap: 64px; padding: 0 80px; }
    .badge { width: 340px; height: 340px; flex: none; }
    .badge img { width: 230px; height: 230px; }
    .copy { display: grid; gap: 30px; }
    .copy > img { height: 70px; width: auto; justify-self: start; }
    .tagline { font-size: 60px; }
  </style>
  <div class="badge"><img src="${mark}" alt=""></div>
  <div class="copy">
    <img src="${logo}" alt="">
    <p class="tagline">Edita, firma y escanea PDF <em>sin subirlos</em></p>
    <div class="chips"><span>Gratis</span><span>Open source</span><span>100&nbsp;% en tu dispositivo</span></div>
  </div>`;

const square = `
  <style>${style}
    body { --w: 600px; --h: 600px; display: grid; place-content: center; justify-items: center; gap: 30px; text-align: center;
      background:
        radial-gradient(circle at 50% 36%, rgb(76 195 154 / 0.25), transparent 45%),
        radial-gradient(rgb(255 255 255 / 0.05) 1.5px, transparent 1.5px) 0 0 / 24px 24px,
        #23272f; }
    .badge { width: 280px; height: 280px; }
    .badge img { width: 190px; height: 190px; }
    body > img { height: 60px; width: auto; }
    .tagline { font-size: 34px; color: #c9d1cd; font-weight: 600; }
  </style>
  <div class="badge"><img src="${mark}" alt=""></div>
  <img src="${logo}" alt="">
  <p class="tagline">Edita, firma y escanea PDF<br><em>sin subirlos</em></p>`;

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();

for (const [html, name, width, height] of [
  [wide, "og-image.png", 1200, 630],
  [square, "og-image-square.png", 600, 600],
]) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><meta charset="utf-8">${html}`);
  await page
    .locator("img")
    .evaluateAll((images) => Promise.all(images.map((img) => img.decode())));
  const file = join(brand, name);
  await writeFile(file, await page.screenshot({ type: "png" }));
  console.log(`${name} (${width}x${height}, ${(await stat(file)).size} bytes)`);
}

await browser.close();
