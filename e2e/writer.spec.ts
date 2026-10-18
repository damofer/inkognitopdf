// Spec 032: writing documents from scratch, in Chrome, on a desktop and on a
// phone.
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { createCanvas } from "@napi-rs/canvas";
import { firstPage, openFixture, openPdf } from "./helpers";

const writer = (page: Page) =>
  page.getByRole("dialog", { name: "Escribir documento" });
const editor = (page: Page) => page.getByTestId("writer-editor");

async function openWriter(page: Page) {
  await page.goto("/app/");
  await page
    .locator(".start-actions")
    .getByRole("button", { name: "Escribir documento" })
    .click();
  await expect(editor(page)).toBeVisible();
  await editor(page).click();
}

async function pdfText(bytes: Uint8Array) {
  const doc = await openPdf(bytes);
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((i) => ("str" in i ? i.str : "")).join(""));
  }
  await doc.loadingTask.destroy();
  return pages;
}

async function download(page: Page) {
  const event = page.waitForEvent("download");
  await writer(page).getByRole("button", { name: "Descargar PDF" }).click();
  const file = await event;
  return {
    name: file.suggestedFilename(),
    bytes: new Uint8Array(await readFile((await file.path())!)),
  };
}

const tool = (page: Page, name: string) =>
  writer(page).getByRole("button", { name, exact: true });

test("CA-1: a title and paragraphs with bold and highlight become real text", async ({
  page,
}) => {
  await openWriter(page);
  await writer(page)
    .getByRole("combobox", { name: "Estilo de párrafo" })
    .selectOption("1");
  await page.keyboard.type("Acta de reunión");
  await page.keyboard.press("Enter");
  // A heading is followed by normal text.
  await expect(
    writer(page).getByRole("combobox", { name: "Estilo de párrafo" }),
  ).toHaveValue("0");
  await page.keyboard.type("Asistieron ");
  await tool(page, "Negrita").click();
  await page.keyboard.type("todos");
  await tool(page, "Negrita").click();
  await page.keyboard.type(" los socios.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Se aprobó el ");
  await tool(page, "Color de resaltado").click();
  await page.getByRole("button", { name: "#fff176" }).click();
  await page.keyboard.type("presupuesto");
  await expect(editor(page).locator("strong")).toHaveText("todos");
  await expect(editor(page).locator(".writer-highlight")).toHaveText(
    "presupuesto",
  );
  await expect(writer(page).locator("h2")).toHaveText("Acta de reunión");

  const { name, bytes } = await download(page);
  const [text] = await pdfText(bytes);
  expect(text).toContain("Acta de reunión");
  expect(text).toContain("Asistieron todos los socios.");
  expect(text).toContain("Se aprobó el presupuesto");
  const pdf = await PDFDocument.load(bytes);
  const fonts = pdf
    .getPage(0)
    .node.Resources()!
    .lookup(PDFName.of("Font"), PDFDict)
    .values()
    .map((ref) =>
      String(pdf.context.lookup(ref, PDFDict).get(PDFName.of("BaseFont"))),
    );
  expect(fonts.some((f) => f.includes("Arimo-Bold"))).toBe(true);
  expect(fonts.some((f) => f.includes("Arimo-Regular"))).toBe(true);
  expect(name).toBe("Acta de reunión.pdf");
});

test("CA-2: a long text shows where page 2 starts, as the PDF breaks it", async ({
  page,
}) => {
  await openWriter(page);
  for (let i = 1; i <= 45; i++) {
    await page.keyboard.type(`Línea número ${i} del documento.`);
    await page.keyboard.press("Enter");
  }
  const marker = writer(page).locator(".writer-marker");
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveText("Página 2");
  await expect(writer(page).locator(".writer-page-count")).toHaveText(
    "2 páginas",
  );
  // The marker sits just above the first line of page 2 in the PDF.
  const { bytes } = await download(page);
  const pages = await pdfText(bytes);
  expect(pages).toHaveLength(2);
  const first = /Línea número (\d+)/.exec(pages[1]!)![1];
  const line = editor(page).getByText(`Línea número ${first} del documento.`, {
    exact: true,
  });
  const markerBox = (await marker.boundingBox())!;
  const lineBox = (await line.boundingBox())!;
  expect(Math.abs(markerBox.y - lineBox.y)).toBeLessThan(8);
});

test("CA-5: lists, alignment, page break and preview", async ({ page }) => {
  await openWriter(page);
  await page.keyboard.type("- uno");
  await page.keyboard.press("Enter");
  await page.keyboard.type("dos");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("1. primero");
  await page.keyboard.press("Enter");
  await page.keyboard.type("segundo");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await tool(page, "Centrar").click();
  await page.keyboard.type("Centrado");
  await tool(page, "Salto de página").click();
  await page.keyboard.type("Segunda hoja");
  await expect(editor(page).locator("ul li")).toHaveCount(2);
  await expect(editor(page).locator("ol li")).toHaveCount(2);
  await expect(editor(page).locator(".writer-page-break")).toHaveCount(1);

  await writer(page).getByRole("button", { name: "Vista previa" }).click();
  const preview = page.getByRole("dialog", { name: "Vista previa" });
  await expect(preview.locator("img")).toHaveCount(2);
  await preview.getByRole("button", { name: "Volver a escribir" }).click();

  const pages = await pdfText((await download(page)).bytes);
  expect(pages).toHaveLength(2);
  expect(pages[0]).toMatch(/•\s?uno/);
  expect(pages[0]).toMatch(/1\.\s?primero/);
  expect(pages[0]).toMatch(/2\.\s?segundo/);
  expect(pages[1]).toContain("Segunda hoja");
});

test("CA-7: undo and redo with buttons and keys", async ({ page }) => {
  await openWriter(page);
  await page.keyboard.type("hola");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor(page)).toHaveText("");
  await tool(page, "Rehacer").click();
  await expect(editor(page)).toHaveText("hola");
  await tool(page, "Deshacer").click();
  await expect(editor(page)).toHaveText("");
});

test("CA-3: written pages go at the end of the open PDF in one undoable step", async ({
  page,
}) => {
  await openFixture(page, "two-pages.pdf");
  const thumbs = page.locator(".page");
  const before = await thumbs.count();
  await page.getByRole("button", { name: "Páginas", exact: true }).click();
  await page.getByRole("button", { name: "Escribir páginas" }).click();
  await editor(page).click();
  await page.keyboard.type("Anexo escrito aquí");
  await writer(page)
    .getByRole("button", { name: "Insertar en el documento" })
    .click();
  await expect(writer(page)).toHaveCount(0);
  await expect(thumbs).toHaveCount(before + 1);
  await page.getByRole("button", { name: "Deshacer" }).first().click();
  await expect(thumbs).toHaveCount(before);
});

test("CA-4: in an empty blank document the written pages replace the blank page", async ({
  page,
}) => {
  await page.goto("/app/");
  await page
    .locator(".start-actions")
    .getByRole("button", { name: "Documento en blanco" })
    .click();
  await firstPage(page)
    .getByRole("button", { name: "Escribir con formato" })
    .click();
  await editor(page).click();
  await page.keyboard.type("Carta de presentación");
  await writer(page)
    .getByRole("button", { name: "Insertar en el documento" })
    .click();
  await expect(page.locator(".page")).toHaveCount(1);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await expect(firstPage(page).locator(".textLayer")).toContainText(
    "Carta de presentación",
  );
});

test("CA-6: an unfinished document is offered after closing the app", async ({
  page,
}) => {
  await openWriter(page);
  await page.keyboard.type("Borrador importante");
  // Saved a moment after typing.
  await page.waitForTimeout(1200);
  await page.reload();
  await page
    .locator(".start-actions")
    .getByRole("button", { name: "Escribir documento" })
    .click();
  const offer = page.getByRole("alertdialog", {
    name: "Tienes un documento sin terminar",
  });
  await expect(offer).toContainText("Borrador importante");
  await offer.getByRole("button", { name: "Seguir escribiendo" }).click();
  await expect(editor(page)).toHaveText("Borrador importante");
});

test("from the start screen, «Abrir en el editor» opens the PDF", async ({
  page,
}) => {
  await openWriter(page);
  await page.keyboard.type("Para firmar");
  await writer(page)
    .getByRole("button", { name: "Abrir en el editor" })
    .click();
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await expect(page.locator(".file-name")).toHaveText("Para firmar.pdf");
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("HU4: readable text and the formatting bar under the text", async ({
    page,
  }) => {
    await openWriter(page);
    const bar = writer(page).getByRole("toolbar", { name: "Formato" });
    await expect(bar).toBeVisible();
    await page.keyboard.type("Texto ");
    await bar.getByRole("button", { name: "Negrita" }).click();
    await page.keyboard.type("fuerte");
    await expect(editor(page).locator("strong")).toHaveText("fuerte");
    // Text at a readable size, as Google Docs on a phone.
    const size = await editor(page).evaluate((el) =>
      parseFloat(getComputedStyle(el).fontSize),
    );
    expect(size).toBeGreaterThanOrEqual(14);
    await bar.getByRole("button", { name: "Más formato" }).click();
    await page
      .getByRole("group", { name: "Más formato" })
      .getByRole("combobox", { name: "Tamaño de letra" })
      .selectOption("18");
    await page.keyboard.press("Escape");
    await writer(page).getByRole("button", { name: "Listo" }).click();
    const event = page.waitForEvent("download");
    await page
      .getByRole("group", { name: "¿Qué quieres hacer con el documento?" })
      .getByRole("button", { name: "Descargar PDF" })
      .click();
    const file = await event;
    const bytes = new Uint8Array(await readFile((await file.path())!));
    expect((await pdfText(bytes))[0]).toContain("Texto fuerte");
  });
});

test("an image is inserted and goes into the PDF", async ({ page }) => {
  await openWriter(page);
  await page.keyboard.type("Con logo");
  await page.keyboard.press("Enter");
  const canvas = createCanvas(300, 150);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1f7a5c";
  ctx.fillRect(0, 0, 300, 150);
  await writer(page)
    .getByTestId("writer-image-input")
    .setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: canvas.toBuffer("image/png"),
    });
  await expect(editor(page).locator("figure img")).toHaveCount(1);
  const pdf = await PDFDocument.load((await download(page)).bytes);
  const xobjects = pdf
    .getPage(0)
    .node.Resources()!
    .lookup(PDFName.of("XObject"), PDFDict);
  expect(xobjects.keys()).toHaveLength(1);
});
