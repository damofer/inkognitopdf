// Screenshots of the app for the signing guide (spec 036), in Spanish and
// English, into public/guia/firmar/img/<lang>/. Signs a sample lease for real:
// one signer with PAdES, then two signers in order. Serves the production
// build (run `npm run build` first) and drives the Chrome that Playwright
// already uses for the e2e tests (or the one in CHROME_PATH).
// Run: node scripts/guide-screenshots.mjs
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { createServer, preview } from "vite";

const root = join(import.meta.dirname, "..");
const out = (lang) => join(root, "public", "guia", "firmar", "img", lang);

// The interface texts, so the steps press the same buttons as a person.
const loader = await createServer({
  root,
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true },
  appType: "custom",
});
const messages = {
  es: (await loader.ssrLoadModule("/src/i18n/es/index.ts")).es,
  en: (await loader.ssrLoadModule("/src/i18n/en/index.ts")).en,
};
await loader.close();

const server = await preview({
  root,
  logLevel: "silent",
  preview: { host: "127.0.0.1", port: 4191, strictPort: true },
});
const base = "http://127.0.0.1:4191";

const browser = await chromium.launch(
  process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: "chrome" },
);
const desktop = {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1.5,
};

/** The sample document and its people, in each language. */
const SAMPLE = {
  es: {
    file: "Contrato de arrendamiento.pdf",
    title: "CONTRATO DE ARRENDAMIENTO DE VIVIENDA",
    place: "En Bogotá, a 18 de octubre de 2026",
    first: {
      name: "Ana Martínez",
      email: "ana@example.com",
      role: "La arrendadora",
    },
    second: {
      name: "Beto Rojas",
      email: "beto@example.com",
      role: "El arrendatario",
    },
    body: [
      "REUNIDOS: de una parte, Ana Martínez, propietaria de la vivienda, en adelante la ARRENDADORA; y de otra, Beto Rojas, en adelante el ARRENDATARIO. Ambas partes se reconocen capacidad para firmar este contrato y acuerdan las siguientes cláusulas.",
      "PRIMERA. Objeto. La ARRENDADORA cede en arriendo al ARRENDATARIO la vivienda situada en la calle 45 n.º 12-30, apartamento 501, para uso exclusivo como vivienda familiar.",
      "SEGUNDA. Duración. El contrato dura doce meses desde el 1 de noviembre de 2026 y se prorroga por periodos iguales si ninguna de las partes avisa lo contrario con un mes de antelación.",
      "TERCERA. Renta. El ARRENDATARIO pagará una renta mensual de 1.800.000 pesos dentro de los cinco primeros días de cada mes, por transferencia a la cuenta que indique la ARRENDADORA.",
      "CUARTA. Depósito. Al firmar, el ARRENDATARIO entrega un mes de renta como depósito, que se devolverá al terminar el contrato si la vivienda se entrega en buen estado.",
      "QUINTA. Conservación. El ARRENDATARIO cuidará la vivienda y no hará obras sin permiso escrito de la ARRENDADORA. Las reparaciones por el uso ordinario corren por su cuenta.",
      "Y en prueba de conformidad, las partes firman este documento en el lugar y la fecha indicados.",
    ],
  },
  en: {
    file: "Lease agreement.pdf",
    title: "RESIDENTIAL LEASE AGREEMENT",
    place: "Bogotá, October 18, 2026",
    first: { name: "Ann Miller", email: "ann@example.com", role: "Landlord" },
    second: { name: "Bob Smith", email: "bob@example.com", role: "Tenant" },
    body: [
      "PARTIES: on the one hand, Ann Miller, owner of the home, hereinafter the LANDLORD; and on the other, Bob Smith, hereinafter the TENANT. Both parties declare they are able to sign this agreement and agree on the following clauses.",
      "FIRST. Purpose. The LANDLORD leases to the TENANT the home at 45th Street no. 12-30, apartment 501, to be used only as a family home.",
      "SECOND. Term. The agreement lasts twelve months from November 1, 2026 and renews for equal periods unless either party gives one month's notice.",
      "THIRD. Rent. The TENANT will pay a monthly rent of 1,800,000 pesos within the first five days of each month, by transfer to the account the LANDLORD indicates.",
      "FOURTH. Deposit. On signing, the TENANT pays one month's rent as a deposit, returned at the end of the agreement if the home is handed back in good condition.",
      "FIFTH. Care. The TENANT will look after the home and make no alterations without the LANDLORD's written consent. Repairs due to ordinary use are the TENANT's.",
      "In witness whereof, the parties sign this document at the place and on the date above.",
    ],
  },
};

/** Where the two signature lines are, as fractions of the page. */
const LINE = { left: 0.27, right: 0.73, signature: 0.56, date: 0.64 };

async function samplePdf(s) {
  const doc = await PDFDocument.create();
  doc.setTitle(s.title);
  const page = doc.addPage([595.28, 841.89]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.13, 0.14, 0.17);
  const width = 595.28 - 140;
  let y = 770;
  const center = (text, font, size) =>
    page.drawText(text, {
      x: (595.28 - font.widthOfTextAtSize(text, size)) / 2,
      y,
      size,
      font,
      color: ink,
    });
  center(s.title, bold, 15);
  y -= 22;
  center(s.place, regular, 10.5);
  y -= 34;
  for (const paragraph of s.body) {
    let line = "";
    const lines = [];
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (regular.widthOfTextAtSize(next, 10.5) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
    for (const text of lines) {
      page.drawText(text, { x: 70, y, size: 10.5, font: regular, color: ink });
      y -= 15.5;
    }
    y -= 9;
  }
  const lineY = 841.89 * (1 - LINE.signature) - 22;
  for (const [fx, who] of [
    [LINE.left, s.first],
    [LINE.right, s.second],
  ]) {
    const cx = 595.28 * fx;
    page.drawLine({
      start: { x: cx - 95, y: lineY },
      end: { x: cx + 95, y: lineY },
      thickness: 0.8,
      color: ink,
    });
    for (const [text, font, dy] of [
      [who.name, bold, -14],
      [who.role, regular, -27],
    ])
      page.drawText(text, {
        x: cx - font.widthOfTextAtSize(text, 10) / 2,
        y: lineY + dy,
        size: 10,
        font,
        color: ink,
      });
  }
  return doc.save();
}

/** Helpers for one page of the app, like the e2e tests', in `lang`. */
function steps(page, lang) {
  const m = messages[lang];
  const tr = (key, ...args) => {
    const message = m[key];
    return typeof message === "function" ? message(...args) : message;
  };
  const firstPage = page.locator('.page[data-page-number="1"]');
  const dialog = (key) =>
    page.getByRole("dialog", { name: tr(key), exact: true });
  return {
    tr,
    firstPage,
    signPanel: () => dialog("sign.sign"),
    signAsPanel: () => dialog("sign.signAs"),
    async open(name, bytes) {
      await page.goto(`${base}/app/`);
      await page.getByTestId("open-pdf").setInputFiles({
        name,
        mimeType: "application/pdf",
        buffer: Buffer.from(bytes),
      });
      await page
        .locator('.page[data-page-number="1"][data-rendered="true"]')
        .waitFor();
    },
    /** Clicks the grey around the page: nothing stays selected. */
    async deselect() {
      await page.mouse.click(190, 500);
    },
    async scrollViewer(dy) {
      await page.mouse.move(700, 500);
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(400);
    },
    async clickPage(fx, fy) {
      const box = await firstPage.boundingBox();
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    },
    /** A typed signature in the pad that is open, with the name given. */
    async typedSignature(name) {
      await page.getByRole("tab", { name: tr("sign.type") }).click();
      const field = page.getByRole("textbox", { name: tr("sign.name") });
      await field.fill(name);
      await page.getByRole("button", { name: tr("sign.use") }).click();
    },
    async download(click) {
      const pending = page.waitForEvent("download");
      await click();
      const file = await pending;
      return new Uint8Array(await readFile(await file.path()));
    },
  };
}

async function shot(page, lang, name, clip) {
  // Out of the way: no hover outlines in the picture.
  await page.mouse.move(1, 799);
  await page.waitForTimeout(500);
  const png = await page.screenshot(clip ? { clip } : {});
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  const path = join(out(lang), `${name}.webp`);
  await writeFile(path, await canvas.encode("webp", 82));
  console.log(`${lang}/${name}.webp  ${image.width}×${image.height}`);
}

/** A fresh browser profile: nothing remembered from another signer. */
async function session(lang) {
  const context = await browser.newContext({
    ...desktop,
    locale: lang === "es" ? "es-ES" : "en-US",
    timezoneId: "America/Bogota",
    storageState: {
      cookies: [],
      origins: [
        {
          origin: base,
          localStorage: [
            { name: "inkognito.analytics", value: "denied" },
            { name: "inkognitopdf.lang", value: lang },
          ],
        },
      ],
    },
  });
  const page = await context.newPage();
  return { context, page, ...steps(page, lang) };
}

/** Creates a self-signed certificate in the open identity picker. */
async function ownCertificate(s, panel, who) {
  const select = panel.getByRole("combobox", {
    name: s.tr("sign.certificate"),
  });
  const nameField = panel.getByLabel(s.tr("sign.signerName"));
  await select.or(nameField).first().waitFor();
  if (await select.isVisible()) {
    await panel
      .locator("summary", { hasText: s.tr("sign.certificateOptions") })
      .click();
    await panel
      .getByRole("button", { name: s.tr("sign.createOwnCertificate") })
      .click();
  }
  await nameField.fill(who.name);
  await panel.getByLabel(s.tr("sign.emailOptional")).fill(who.email);
}

async function guide(lang) {
  await mkdir(out(lang), { recursive: true });
  const sample = SAMPLE[lang];
  const pdf = await samplePdf(sample);

  // 1. One signer, PAdES.
  {
    const s = await session(lang);
    const { page } = s;
    await s.open(sample.file, pdf);
    await page
      .getByRole("button", { name: s.tr("sign.sign"), exact: true })
      .click();
    const panel = s.signPanel();
    await panel
      .getByRole("button", { name: s.tr("sign.create") })
      .first()
      .click();
    await s.typedSignature(sample.first.name);
    await panel
      .getByRole("button", { name: s.tr("sign.placeSignature") })
      .click();
    await s.clickPage(LINE.left, LINE.signature);
    await s.deselect();
    await shot(page, lang, "pades-place");
    await panel.getByRole("button", { name: s.tr("sign.next") }).click();
    await ownCertificate(s, panel, sample.first);
    await panel
      .getByRole("group", { name: s.tr("sign.saveSigned") })
      .getByLabel(s.tr("sign.addAuditPage"))
      .check();
    await shot(page, lang, "pades-save");
    await s.context.close();
  }

  // 2. Two signers in order: the sender prepares the document.
  let prepared;
  {
    const s = await session(lang);
    const { page } = s;
    await s.open(sample.file, pdf);
    await page
      .getByRole("button", { name: s.tr("sign.sign"), exact: true })
      .click();
    const panel = s.signPanel();
    await panel.getByText(s.tr("sign.severalSigners")).click();
    for (const [i, who] of [sample.first, sample.second].entries()) {
      await panel.getByRole("button", { name: s.tr("sign.addSigner") }).click();
      await panel.getByLabel(s.tr("sign.signerNameN", i + 1)).fill(who.name);
      await panel.getByLabel(s.tr("sign.signerEmail", i + 1)).fill(who.email);
    }
    for (const [who, fx] of [
      [sample.first, LINE.left],
      [sample.second, LINE.right],
    ]) {
      const fields = panel.getByRole("group", {
        name: s.tr("sign.signerFields", who.name),
      });
      await fields
        .getByRole("button", { name: `+ ${s.tr("signField.signature")}` })
        .click();
      await s.clickPage(fx, LINE.signature);
      await fields
        .getByRole("button", { name: `+ ${s.tr("signField.date")}` })
        .click();
      await s.clickPage(fx, LINE.date);
    }
    await s.deselect();
    await panel
      .getByRole("button", { name: s.tr("sign.saveForSigning") })
      .scrollIntoViewIfNeeded();
    await shot(page, lang, "multi-prepare");
    prepared = await s.download(() =>
      panel.getByRole("button", { name: s.tr("sign.saveForSigning") }).click(),
    );
    await s.context.close();
  }

  // Each signer, on their own device.
  let signed = prepared;
  for (const [i, who] of [sample.first, sample.second].entries()) {
    const s = await session(lang);
    const { page } = s;
    await s.open(sample.file, signed);
    // Opened to sign (spec 004, CA15): no editing, the panel already open.
    const panel = s.signAsPanel();
    await panel.waitFor();
    if (i === 0) await shot(page, lang, "multi-notice");
    await panel
      .getByRole("button", { name: s.tr("sign.create"), exact: true })
      .click();
    await s.typedSignature(who.name);
    await ownCertificate(s, panel, who);
    if (i === 0) await shot(page, lang, "multi-sign-as");
    await panel
      .getByRole("button", {
        name: s.tr("sign.createCertificate"),
        exact: true,
      })
      .click();
    await panel
      .getByRole("combobox", { name: s.tr("sign.certificate") })
      .waitFor();
    signed = await s.download(() =>
      panel.getByRole("button", { name: s.tr("sign.saveSigned") }).click(),
    );
    await s.context.close();
  }

  // Everyone signed: the notices, the audit page and the signatures.
  {
    const s = await session(lang);
    const { page } = s;
    await s.open(sample.file, signed);
    await page.getByTestId("signed-notice").waitFor();
    await s.scrollViewer(260);
    await shot(page, lang, "multi-done");
    const audit = page.locator('.page[data-page-number="2"]');
    await audit.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page
      .locator('.page[data-page-number="2"][data-rendered="true"]')
      .waitFor();
    await page.waitForTimeout(400);
    const box = await audit.boundingBox();
    await shot(page, lang, "multi-audit", {
      x: box.x,
      y: box.y,
      width: box.width,
      height: Math.min(box.height * 0.42, 800 - box.y),
    });
    await page
      .locator('.page[data-page-number="1"]')
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await s.scrollViewer(260);
    await page
      .getByTestId("signed-notice")
      .getByRole("button", { name: s.tr("editor.viewSignatures") })
      .click();
    await page.getByTestId("sig-report").first().waitFor();
    await shot(page, lang, "verify");
    await s.context.close();
  }
}

try {
  for (const lang of ["es", "en"]) await guide(lang);
} finally {
  await browser.close();
  await server.close();
}
