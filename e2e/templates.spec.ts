// Spec 021, phase 1: the template gallery, filling in, preview, download and
// opening in the editor, in Chrome.
import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { PDFDocument, PDFDict, PDFName } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { firstPage, openPdf } from "./helpers";

const view = (page: Page) => page.getByRole("dialog", { name: "Plantillas" });

async function openTemplate(page: Page, id: string) {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Plantillas", exact: true }).click();
  await view(page).locator(`[data-template="${id}"]`).click();
  await expect(view(page).locator(".tpl-page").first()).toBeVisible();
}

async function download(page: Page) {
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar PDF" }).click();
  const file = await event;
  return {
    name: file.suggestedFilename(),
    bytes: new Uint8Array(await readFile((await file.path())!)),
  };
}

async function pdfText(bytes: Uint8Array) {
  const doc = await openPdf(bytes);
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
  }
  await doc.loadingTask.destroy();
  return pages.join("\n");
}

test("gallery: categories, search and thumbnails", async ({ page }) => {
  await page.goto("/app/");
  await page.getByRole("button", { name: /Empezar con una plantilla/ }).click();
  const cards = view(page).locator(".tpl-card");
  await expect(cards).toHaveCount(12);
  await expect(cards.first().locator("img")).toBeVisible();

  await view(page)
    .getByRole("button", { name: "Cartas y constancias" })
    .click();
  await expect(cards).toHaveCount(4);
  await view(page).getByRole("button", { name: "Todas" }).click();

  // Accents and case do not matter.
  await view(page).getByPlaceholder("Buscar plantillas").fill("cobro");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Cuenta de cobro");
  await view(page).getByPlaceholder("Buscar plantillas").fill("CONSTANCIA");
  await expect(cards.first()).toBeVisible();
  await view(page).getByPlaceholder("Buscar plantillas").fill("zzz");
  await expect(view(page)).toContainText("Ninguna plantilla coincide");

  await view(page).getByRole("button", { name: "Cerrar plantillas" }).click();
  await expect(view(page)).toHaveCount(0);
});

test("payment request: two items, total in figures and words", async ({
  page,
}) => {
  await openTemplate(page, "payment-request");
  await expect(view(page)).toContainText("no es una factura electrónica");

  const form = view(page).locator(".tpl-form");
  await form.getByLabel("Tu nombre").fill("Ana María Ruiz");
  await form.getByLabel("Moneda").selectOption("COP");
  const row = (n: number) =>
    form.getByRole("group", { name: `Conceptos ${n}` });
  await row(1).getByLabel("Descripción").fill("Diseño de logo");
  await row(1).getByLabel("Cantidad").fill("2");
  await row(1).getByLabel("Valor unitario").fill("300.000");
  await row(2).getByLabel("Descripción").fill("Fotografía de producto");
  await row(2).getByLabel("Cantidad").fill("1");
  await row(2).getByLabel("Valor unitario").fill("150000");
  // A row added and removed again leaves no trace.
  await form.getByRole("button", { name: "+ Añadir concepto" }).click();
  await expect(row(3)).toBeVisible();
  await row(3)
    .getByRole("button", { name: /^Quitar/ })
    .click();
  await expect(row(3)).toHaveCount(0);

  await expect(view(page).getByRole("status")).toHaveText("1 página");
  const { name, bytes } = await download(page);
  expect(name).toBe("Cuenta de cobro - 001 - Ana María Ruiz.pdf");
  const text = await pdfText(bytes);
  expect(text).toContain("Diseño de logo");
  expect(text).toContain("Fotografía de producto");
  expect(text).toMatch(/Total\s+\$\s?750\.000/);
  expect(text).toMatch(/Setecientos cincuenta mil pesos/i);

  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  expect(doc.getProducer()).toBe("InkognitoPDF");
  expect(doc.getAuthor()).toBeUndefined();
});

test("leaving with changes asks first; the sample comes back", async ({
  page,
}) => {
  await openTemplate(page, "resignation");
  const form = view(page).locator(".tpl-form");
  await form.getByLabel("Tu nombre").fill("Pedro Pérez");

  await view(page)
    .getByRole("button", { name: /Plantillas/ })
    .first()
    .click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toContainText("Se perderá lo que escribiste");
  await ask.getByRole("button", { name: "Seguir editando" }).click();
  await expect(form.getByLabel("Tu nombre")).toHaveValue("Pedro Pérez");

  await form.getByRole("button", { name: "Volver al ejemplo" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Volver al ejemplo" })
    .click();
  await expect(form.getByLabel("Tu nombre")).not.toHaveValue("Pedro Pérez");

  // Without changes, going back needs no confirmation.
  await view(page)
    .getByRole("button", { name: /Plantillas/ })
    .first()
    .click();
  await expect(view(page).locator(".tpl-card")).toHaveCount(12);
});

test("opens the document in the editor with real text", async ({ page }) => {
  await openTemplate(page, "employment-certificate");
  await page.getByRole("button", { name: "Abrir en el editor" }).click();
  await expect(view(page)).toHaveCount(0);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await expect(page.locator(".file-name")).toHaveText(
    "Certificado laboral - Carlos Andrés Gómez.pdf",
  );
  await expect(
    firstPage(page).locator(".textLayer span", {
      hasText: "CERTIFICADO LABORAL",
    }),
  ).toHaveCount(1);
});

test("a CV with a photo, in another color and paper", async ({
  page,
}, info) => {
  const canvas = createCanvas(800, 1000);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#7a9cc6";
  ctx.fillRect(0, 0, 800, 1000);
  ctx.fillStyle = "#f2d0b0";
  ctx.beginPath();
  ctx.arc(400, 420, 220, 0, Math.PI * 2);
  ctx.fill();
  const photo = info.outputPath("foto.png");
  await writeFile(photo, canvas.toBuffer("image/png"));

  await openTemplate(page, "cv-modern");
  await view(page).getByTestId("template-photo").setInputFiles(photo);
  await expect(
    view(page).getByRole("button", { name: "Quitar foto" }),
  ).toBeVisible();
  await view(page).getByRole("radio", { name: "Vino" }).click();
  await view(page).getByLabel("Papel").selectOption("letter");
  await expect(view(page).getByRole("status")).toHaveText(/página/);

  const { bytes } = await download(page);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const [first] = doc.getPages();
  expect(first!.getSize()).toEqual({ width: 612, height: 792 });
  const xobjects = first!.node
    .Resources()!
    .lookup(PDFName.of("XObject"), PDFDict);
  expect(xobjects.keys().length).toBe(1);
});

test.describe("on a phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("tabs for the form and the preview, actions at the bottom", async ({
    page,
  }) => {
    await page.goto("/app/");
    await page.getByRole("button", { name: "Plantillas", exact: true }).click();
    await view(page).locator('[data-template="receipt"]').click();
    await expect(view(page).locator(".tpl-form")).toBeVisible();
    await expect(view(page).locator(".tpl-preview")).toHaveCount(0);
    await view(page).getByRole("tab", { name: "Vista previa" }).click();
    await expect(view(page).locator(".tpl-page").first()).toBeVisible();
    const bottom = view(page).locator(".tpl-bottom");
    await expect(
      bottom.getByRole("button", { name: "Descargar PDF" }),
    ).toBeVisible();
    const box = await bottom
      .getByRole("button", { name: "Descargar PDF" })
      .boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(width).toBeLessThanOrEqual(390);
  });
});
