// Images for README.md and README.es.md, in English and Spanish, taken from
// the production build with the synthetic test documents only.
// Run: npm run build && node scripts/readme-images.mjs
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const root = join(import.meta.dirname, "..");
const out = join(root, "docs", "images");
const fixture = (name) => join(root, "tests", "fixtures", name);
await mkdir(out, { recursive: true });

const server = await preview({
  root,
  logLevel: "silent",
  preview: { host: "127.0.0.1", port: 4191, strictPort: true },
});
const base = "http://127.0.0.1:4191";

const desktop = { viewport: { width: 1280, height: 800 } };
const phone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};
const LOCALES = { en: "en-US", es: "es-ES" };
const T = {
  en: {
    sign: "Sign",
    split: "Split",
    ranges: "Page ranges",
    annotate: "Annotate",
    redact: "Secure redaction",
    search: "Search to redact",
    mark: "Mark matches",
    tools: "Editing tools",
  },
  es: {
    sign: "Firmar",
    split: "Dividir",
    ranges: "Rangos de páginas",
    annotate: "Anotar",
    redact: "Borrado seguro",
    search: "Buscar para borrar",
    mark: "Marcar coincidencias",
    tools: "Herramientas de edición",
  },
};

const browser = await chromium.launch({ channel: "chrome" });

async function shoot(name, device, steps) {
  for (const lang of ["en", "es"]) {
    const context = await browser.newContext({
      ...device,
      locale: LOCALES[lang],
    });
    // No consent notice in the pictures: measuring stays off.
    await context.addInitScript(() =>
      localStorage.setItem("inkognito.analytics", "denied"),
    );
    const page = await context.newPage();
    await steps(page, T[lang]);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(out, `${name}-${lang}.png`) });
    await context.close();
    console.log(`${name}-${lang}.png`);
  }
}

const openDoc = async (page, ...names) => {
  await page.goto(`${base}/app/`);
  await page
    .getByTestId("open-pdf")
    .setInputFiles(names.map((n) => fixture(n)));
  await page
    .locator('.page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
};

await shoot("landing", desktop, (page) => page.goto(`${base}/`));
await shoot("editor", desktop, (page) =>
  openDoc(page, "forms-annotations.pdf"),
);
await shoot("sign", desktop, async (page, t) => {
  await openDoc(page, "forms-annotations.pdf");
  await page.getByRole("button", { name: t.sign, exact: true }).click();
});
await shoot("redact", desktop, async (page, t) => {
  await openDoc(page, "simple-text.pdf");
  await page
    .getByRole("group", { name: t.tools })
    .getByRole("button", { name: t.redact, exact: true })
    .click();
  await page.getByRole("searchbox", { name: t.search }).fill("zorro");
  await page.getByRole("button", { name: t.mark }).click();
});
await shoot("split", desktop, async (page, t) => {
  await openDoc(page, "two-pages.pdf", "table.pdf", "simple-text.pdf");
  await page.getByRole("button", { name: t.split, exact: true }).click();
  await page.getByRole("textbox", { name: t.ranges }).fill("1-2, 3-4");
});
await shoot("mobile", phone, (page) => openDoc(page, "forms-annotations.pdf"));
await shoot("mobile-annotate", phone, async (page, t) => {
  await openDoc(page, "forms-annotations.pdf");
  await page.getByRole("button", { name: t.annotate }).click();
});

await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));
