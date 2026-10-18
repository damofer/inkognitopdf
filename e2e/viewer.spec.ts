// Spec 001, phase 1: viewer (HU1). Covers T006 (layers, zoom, thumbnails) and T007 (CA1).
import { expect, test, type Page } from "@playwright/test";
import { join } from "node:path";

const fixture = (name: string) =>
  join(import.meta.dirname, "..", "tests", "fixtures", name);

async function openFixture(page: Page, name: string) {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(fixture(name));
}

const firstPage = (page: Page) => page.locator('.page[data-page-number="1"]');

test("CA1: first page of a 200-page PDF renders in under 2 s, with selectable text", async ({
  page,
}) => {
  await openFixture(page, "many-pages.pdf");
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");

  const elapsed = await page.evaluate(
    () =>
      performance.measure(
        "open-to-first-page",
        "pdfcraft:open-start",
        "pdfcraft:first-page-rendered",
      ).duration,
  );
  console.log(`open → first page rendered: ${elapsed.toFixed(0)} ms`);
  expect(elapsed).toBeLessThan(2000);

  await expect(page.getByText("Página 1 de 200")).toBeVisible();

  // The text layer holds real, selectable text.
  const textLayer = firstPage(page).locator(".textLayer");
  await expect(textLayer).toContainText("Pagina 1 de 200");
  const selected = await textLayer.evaluate((layer) => {
    const range = document.createRange();
    range.selectNodeContents(layer);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  expect(selected).toContain("Linea 1: contenido de relleno para la pagina 1.");
});

test("pages render lazily: distant pages wait until scrolled into view", async ({
  page,
}) => {
  await openFixture(page, "many-pages.pdf");
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  const last = page.locator('.page[data-page-number="200"]');
  await expect(last).toHaveAttribute("data-rendered", "false");
  expect(
    await page.locator('.page[data-rendered="true"]').count(),
  ).toBeLessThan(20);

  await page.getByRole("button", { name: "Ir a la página 200" }).click();
  await expect(last).toHaveAttribute("data-rendered", "true");
  await expect(last.locator(".textLayer")).toContainText("Pagina 200 de 200");
});

test("spec 035: far pages free their canvas and render again on return", async ({
  page,
}) => {
  await openFixture(page, "many-pages.pdf");
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  const firstCanvas = firstPage(page).locator(".page-canvas");
  expect(
    await firstCanvas.evaluate((c) => (c as HTMLCanvasElement).width),
  ).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Ir a la página 200" }).click();
  const last = page.locator('.page[data-page-number="200"]');
  await expect(last).toHaveAttribute("data-rendered", "true");
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "false");
  expect(
    await firstCanvas.evaluate((c) => (c as HTMLCanvasElement).width),
  ).toBe(0);
  expect(
    await page.locator('.page[data-rendered="true"]').count(),
  ).toBeLessThan(10);

  await page
    .getByRole("button", { name: "Ir a la página 1", exact: true })
    .click();
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await expect(firstPage(page).locator(".textLayer")).toContainText(
    "Pagina 1 de 200",
  );
  await expect(last).toHaveAttribute("data-rendered", "false");
});

test("each page has canvas, text, annotation and edit layers", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  for (const layer of [
    ".page-canvas",
    ".textLayer",
    ".annotationLayer",
    ".editLayer",
  ])
    await expect(firstPage(page).locator(layer)).toHaveCount(1);
  await expect(firstPage(page).locator(".textLayer")).toContainText(
    "Documento de prueba pdfcraft",
  );
});

test("zoom changes the page size and re-renders", async ({ page }) => {
  await openFixture(page, "simple-text.pdf");
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  const before = (await firstPage(page).boundingBox())!.width;

  await page.getByRole("button", { name: "Acercar" }).click();
  await expect(page.getByLabel("Zoom")).toHaveText("125 %");
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  const after = (await firstPage(page).boundingBox())!.width;
  expect(after / before).toBeCloseTo(1.25, 1);

  await page.getByRole("button", { name: "Alejar" }).click();
  await page.getByRole("button", { name: "Alejar" }).click();
  await expect(page.getByLabel("Zoom")).toHaveText("75 %");
});

test("thumbnails: one per page, and clicking one navigates", async ({
  page,
}) => {
  await openFixture(page, "two-pages.pdf");
  const thumbs = page.locator(".thumbnail");
  await expect(thumbs).toHaveCount(2);
  await expect(thumbs.first()).toHaveAttribute("data-rendered", "true");
  await page.getByRole("button", { name: "Ir a la página 2" }).click();
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
});

test("a page with /Rotate 90 is shown in landscape", async ({ page }) => {
  await openFixture(page, "rotated-page.pdf");
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  const box = (await firstPage(page).boundingBox())!;
  expect(box.width).toBeGreaterThan(box.height);
});

test("a non-PDF file shows a readable error", async ({ page }) => {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles({
    name: "nota.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hola"),
  });
  await expect(page.getByRole("alert")).toContainText("no parece un PDF");
});
