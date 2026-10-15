// Renders the PNG and ICO app icons from the SVG sources in public/brand/
// with the Chrome that Playwright already drives for the e2e tests.
// Run after changing a logo SVG: node scripts/render-icons.mjs
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const brand = join(import.meta.dirname, "..", "public", "brand");

const pngs = [
  ...[16, 32, 48, 64, 192, 512].map((n) => ["icon.svg", `icon-${n}.png`, n]),
  ["icon-maskable.svg", "icon-maskable-192.png", 192],
  ["icon-maskable.svg", "icon-maskable-512.png", 512],
  ["icon-full.svg", "apple-touch-icon.png", 180],
];
const icoSizes = [16, 32, 48];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();

async function render(svgName, size) {
  const svg = await readFile(join(brand, svgName), "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style>` +
      `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}">`,
  );
  await page.locator("img").evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: true, type: "png" });
}

for (const [svg, out, size] of pngs) {
  await writeFile(join(brand, out), await render(svg, size));
  console.log(`${out} (${size}×${size})`);
}

// favicon.ico holding PNG images, which every current browser reads.
const images = [];
for (const size of icoSizes) images.push(await render("icon.svg", size));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((png, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(icoSizes[i] % 256, entry);
  header.writeUInt8(icoSizes[i] % 256, entry + 1);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
await writeFile(join(brand, "favicon.ico"), Buffer.concat([header, ...images]));
console.log(`favicon.ico (${icoSizes.join("/")})`);

await browser.close();
