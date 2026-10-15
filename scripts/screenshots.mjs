// Screenshots of the landing page and the app, desktop and phone, for
// docs/screenshots/. Serves the production build (run `npm run build` first)
// and drives the Chrome that Playwright already uses for the e2e tests.
// Run: node scripts/screenshots.mjs
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const root = join(import.meta.dirname, "..");
const out = join(root, "docs", "screenshots");
const fixture = (name) => join(root, "tests", "fixtures", name);
await mkdir(out, { recursive: true });

const server = await preview({
  root,
  logLevel: "silent",
  preview: { host: "127.0.0.1", port: 4190, strictPort: true },
});
const base = "http://127.0.0.1:4190";

const desktop = { viewport: { width: 1280, height: 800 } };
const phone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

const browser = await chromium.launch({ channel: "chrome" });

async function shoot(name, device, locale, steps, fullPage = false) {
  const context = await browser.newContext({ ...device, locale });
  const page = await context.newPage();
  await steps(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${name}.png`), fullPage });
  await context.close();
  console.log(`${name}.png`);
}

const openDoc = (name) => async (page) => {
  await page.goto(`${base}/app/`);
  await page.getByTestId("open-pdf").setInputFiles(fixture(name));
  await page
    .locator('.page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
};

const landing = (page) => page.goto(`${base}/`);

await shoot("landing-desktop-es", desktop, "es-ES", landing);
await shoot("landing-desktop-en", desktop, "en-US", landing);
await shoot("landing-full-desktop-es", desktop, "es-ES", landing, true);
await shoot("landing-mobile-es", phone, "es-ES", landing);
await shoot(
  "landing-full-mobile-en",
  { ...phone, deviceScaleFactor: 1 },
  "en-US",
  landing,
  true,
);

await shoot("app-desktop", desktop, "es-ES", openDoc("forms-annotations.pdf"));
await shoot("app-mobile-start", phone, "es-ES", (page) =>
  page.goto(`${base}/app/`),
);
await shoot(
  "app-mobile-document",
  phone,
  "es-ES",
  openDoc("forms-annotations.pdf"),
);
await shoot("app-mobile-menu", phone, "es-ES", async (page) => {
  await openDoc("forms-annotations.pdf")(page);
  await page.getByRole("button", { name: "Menú" }).click();
});
await shoot("app-mobile-annotate", phone, "es-ES", async (page) => {
  await openDoc("forms-annotations.pdf")(page);
  await page.getByRole("button", { name: "Anotar" }).click();
});
await shoot("app-mobile-sign", phone, "es-ES", async (page) => {
  await openDoc("forms-annotations.pdf")(page);
  await page.getByRole("button", { name: "Firmar" }).click();
});

await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));
