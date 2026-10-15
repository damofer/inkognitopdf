// Images for README.md (docs/images/en) and README.es.md (docs/images/es),
// taken from the production build. The English pictures use English sample
// documents made here; the Spanish ones use the synthetic test fixtures.
// Run: npm run build && node scripts/readme-images.mjs
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { chromium } from "@playwright/test";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createServer, preview } from "vite";

const root = join(import.meta.dirname, "..");
const fixture = (name) => join(root, "tests", "fixtures", name);

// --- English sample documents -------------------------------------------

const samples = await mkdtemp(join(tmpdir(), "readme-samples-"));

async function write(name, build) {
  const doc = await PDFDocument.create();
  doc.setTitle(name);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  await build(doc, font, bold);
  const path = join(samples, name);
  await writeFile(path, await doc.save());
  return path;
}

const paragraph = (page, lines, font, x, y, size = 11) =>
  lines.forEach((line, i) =>
    page.drawText(line, { x, y: y - i * size * 1.5, size, font }),
  );

const form = await write("membership-form.pdf", (doc, font, bold) => {
  const page = doc.addPage([595, 842]);
  page.drawText("Library membership application", {
    x: 56,
    y: 770,
    size: 20,
    font: bold,
  });
  paragraph(
    page,
    [
      "Fill in this form to get a library card. Your card lets you borrow up to",
      "ten books at a time and reserve the study rooms on the second floor.",
    ],
    font,
    56,
    738,
  );
  const f = doc.getForm();
  const label = (text, y) =>
    page.drawText(text, { x: 56, y, size: 11, font: bold });
  label("Full name", 680);
  const name = f.createTextField("name");
  name.setText("Alex Morgan");
  name.addToPage(page, { x: 180, y: 672, width: 300, height: 22 });
  label("Email", 640);
  f.createTextField("email").addToPage(page, {
    x: 180,
    y: 632,
    width: 300,
    height: 22,
  });
  label("Branch", 600);
  const branch = f.createDropdown("branch");
  branch.addOptions(["Central library", "North branch", "Riverside"]);
  branch.select("Central library");
  branch.addToPage(page, { x: 180, y: 592, width: 200, height: 22 });
  label("Card type", 560);
  const type = f.createRadioGroup("card");
  type.addOptionToPage("adult", page, {
    x: 180,
    y: 556,
    width: 14,
    height: 14,
  });
  page.drawText("Adult", { x: 200, y: 559, size: 11, font });
  type.addOptionToPage("student", page, {
    x: 260,
    y: 556,
    width: 14,
    height: 14,
  });
  page.drawText("Student", { x: 280, y: 559, size: 11, font });
  type.select("adult");
  const news = f.createCheckBox("newsletter");
  news.addToPage(page, { x: 56, y: 516, width: 14, height: 14 });
  news.check();
  page.drawText("Send me the monthly newsletter", {
    x: 78,
    y: 519,
    size: 11,
    font,
  });
  label("Signature", 470);
  page.drawLine({
    start: { x: 180, y: 466 },
    end: { x: 480, y: 466 },
    thickness: 1,
    color: rgb(0.4, 0.4, 0.4),
  });
  paragraph(
    page,
    [
      "Opening hours: Monday to Friday 9:00-20:00, Saturday 10:00-14:00.",
      "Bring a photo ID when you pick up your card.",
    ],
    font,
    56,
    410,
    10,
  );
});

const report = await write("field-notes.pdf", (doc, font, bold) => {
  const page = doc.addPage([595, 842]);
  page.drawText("Field notes: the quick brown fox", {
    x: 56,
    y: 770,
    size: 20,
    font: bold,
  });
  paragraph(
    page,
    [
      "Observer: Jordan Lee. Location: north meadow, plot 7.",
      "",
      "08:10  The quick brown fox jumps over the lazy dog near the fence.",
      "08:25  The fox returns to the den with food for the cubs.",
      "09:40  Second sighting: a red fox crosses the stream heading east.",
      "11:05  No activity. Weather clear, light wind from the west.",
      "",
      "Contact for the survey: +1 555 0142, survey@example.org",
    ],
    font,
    56,
    730,
  );
});

const chapters = await write("handbook.pdf", (doc, font, bold) => {
  const titles = ["Welcome", "Getting started", "Policies", "Contacts"];
  titles.forEach((title, i) => {
    const page = doc.addPage([595, 842]);
    page.drawText(`Chapter ${i + 1}: ${title}`, {
      x: 56,
      y: 770,
      size: 20,
      font: bold,
    });
    paragraph(
      page,
      [
        "This handbook is a sample document made for the screenshots.",
        `Page ${i + 1} of ${titles.length}.`,
      ],
      font,
      56,
      730,
    );
  });
});

// A photo of an English page for the scanner, made with the synthetic camera.
const vite = await createServer({
  root,
  logLevel: "silent",
  server: { middlewareMode: true },
  appType: "custom",
});
const { synthPhoto, testPage } = await vite.ssrLoadModule(
  "/tests/scan/synthPhoto.ts",
);

function englishPage(ppi) {
  const width = Math.round((595.28 / 72) * ppi);
  const height = Math.round((841.89 / 72) * ppi);
  const pt = ppi / 72;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.font = `bold ${20 * pt}px sans-serif`;
  ctx.fillText("Invoice 2026-0142", 56 * pt, 90 * pt);
  ctx.font = `${12 * pt}px sans-serif`;
  [
    "Northwind Supplies, 12 Harbor Street",
    "Billed to: Example Company Ltd.",
    "Date: 3 March 2026      Due: 2 April 2026",
  ].forEach((line, i) => ctx.fillText(line, 56 * pt, (130 + i * 20) * pt));
  ctx.lineWidth = 1.5 * pt;
  const rows = ["Item", "Paper, A4, 5 boxes", "Toner cartridges", "Delivery"];
  const prices = ["Amount", "$ 120.00", "$ 310.50", "$ 15.00"];
  rows.forEach((row, i) => {
    const y = (230 + i * 26) * pt;
    ctx.strokeRect(56 * pt, y - 18 * pt, 483 * pt, 26 * pt);
    ctx.fillText(row, 66 * pt, y);
    ctx.fillText(prices[i], 420 * pt, y);
  });
  ctx.font = `bold ${14 * pt}px sans-serif`;
  ctx.fillText("Total  $ 445.50", 400 * pt, 360 * pt);
  ctx.font = `${11 * pt}px sans-serif`;
  ctx.fillText("Thank you for your business.", 56 * pt, 420 * pt);
  const data = ctx.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++)
    gray[i] =
      0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return { ...testPage(ppi), page: { width, height, data: gray } };
}

async function photoFile(name, page) {
  const { photo } = synthPhoto({ page, seed: 901, width: 1800, height: 2400 });
  const canvas = createCanvas(photo.width, photo.height);
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(photo.width, photo.height);
  image.data.set(photo.data);
  ctx.putImageData(image, 0, 0);
  const path = join(samples, name);
  await writeFile(path, canvas.toBuffer("image/jpeg", 90));
  return path;
}

const photos = {
  en: await photoFile("photo-en.jpg", englishPage(150)),
  es: await photoFile("foto-es.jpg", testPage(150)),
};
await vite.close();

// --- Pictures -----------------------------------------------------------

const DOCS = {
  en: {
    form: [form],
    text: [report],
    pages: [chapters],
    search: "fox",
  },
  es: {
    form: [fixture("forms-annotations.pdf")],
    text: [fixture("simple-text.pdf")],
    pages: [
      fixture("two-pages.pdf"),
      fixture("table.pdf"),
      fixture("simple-text.pdf"),
    ],
    search: "zorro",
  },
};

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
    scan: "Scan",
    scanner: "Scan document",
    next: "Continue",
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
    scan: "Escanear",
    scanner: "Escanear documento",
    next: "Continuar",
  },
};

const browser = await chromium.launch({ channel: "chrome" });

async function shoot(name, device, steps) {
  for (const lang of ["en", "es"]) {
    const out = join(root, "docs", "images", lang);
    await mkdir(out, { recursive: true });
    const context = await browser.newContext({
      ...device,
      locale: LOCALES[lang],
    });
    // No consent notice in the pictures: measuring stays off.
    await context.addInitScript(() =>
      localStorage.setItem("inkognito.analytics", "denied"),
    );
    const page = await context.newPage();
    await steps(page, T[lang], DOCS[lang], lang);
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(out, `${name}.png`) });
    await context.close();
    console.log(`${lang}/${name}.png`);
  }
}

const openDoc = async (page, files) => {
  await page.goto(`${base}/app/`);
  await page.getByTestId("open-pdf").setInputFiles(files);
  await page
    .locator('.page[data-page-number="1"][data-rendered="true"]')
    .waitFor();
};

await shoot("landing", desktop, (page) => page.goto(`${base}/`));
await shoot("editor", desktop, (page, t, d) => openDoc(page, d.form));
await shoot("sign", desktop, async (page, t, d) => {
  await openDoc(page, d.form);
  await page.getByRole("button", { name: t.sign, exact: true }).click();
});
await shoot("redact", desktop, async (page, t, d) => {
  await openDoc(page, d.text);
  await page
    .getByRole("group", { name: t.tools })
    .getByRole("button", { name: t.redact, exact: true })
    .click();
  await page.getByRole("searchbox", { name: t.search }).fill(d.search);
  await page.getByRole("button", { name: t.mark }).click();
});
await shoot("split", desktop, async (page, t, d) => {
  await openDoc(page, d.pages);
  await page.getByRole("button", { name: t.split, exact: true }).click();
  await page.getByRole("textbox", { name: t.ranges }).fill("1-2, 3-4");
});
await shoot("mobile", phone, (page, t, d) => openDoc(page, d.form));
await shoot("mobile-annotate", phone, async (page, t, d) => {
  await openDoc(page, d.form);
  await page.getByRole("button", { name: t.annotate }).click();
});
await shoot("scan", phone, async (page, t, d, lang) => {
  await page.goto(`${base}/app/`);
  await page.getByRole("button", { name: t.scan, exact: true }).click();
  const view = page.getByRole("dialog", { name: t.scanner });
  await view.getByTestId("scan-images").setInputFiles(photos[lang]);
  await view.locator(".crop-hit").first().waitFor();
  await view.getByRole("button", { name: t.next }).click();
  await view.locator('img.scan-result[data-mode="bw"]').waitFor();
  await view.locator(".scan-status").waitFor({ state: "detached" });
});

await browser.close();
await new Promise((resolve) => server.httpServer.close(resolve));
