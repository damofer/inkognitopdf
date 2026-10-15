// Spec 003, O012: OCR in Chrome on a synthetic scanned PDF, with the network
// limited to the app's own origin (CA9).
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { TEST_LINES } from "../tests/scan/synthPhoto";
import { writeScannedPdf } from "./scannedPdf";
import { firstPage, fixture, openPdf, saveAndRead, textRuns } from "./helpers";
import { writePhotos } from "./scanPhotos";

let scannedPdf: string;

test.beforeAll(async () => {
  scannedPdf = await writeScannedPdf();
});

/** Fails the test on any request that leaves the app's origin. */
async function offline(page: Page) {
  const outside: string[] = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:4173/")) return route.continue();
    outside.push(url);
    return route.abort();
  });
  return outside;
}

async function openScanned(page: Page) {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(scannedPdf);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
}

const panel = (page: Page) =>
  page.getByRole("dialog", { name: "Reconocer texto" });

async function recognize(page: Page) {
  const started = Date.now();
  await panel(page).getByRole("button", { name: "Reconocer" }).click();
  await expect(panel(page).getByTestId("ocr-status")).toContainText(
    /Reconocidas? \d+ páginas?\./,
    { timeout: 120_000 },
  );
  return Date.now() - started;
}

const count = (text: string, part: string) => text.split(part).length - 1;

test("CA1, CA3, CA4, CA6, CA8, CA9: scanned PDF → OCR → searchable PDF and .txt", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const outside = await offline(page);
  await openScanned(page);

  // CA1: the document is recognized as scanned and OCR is offered.
  const notice = page.getByTestId("scanned-notice");
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Reconocer texto" }).click();
  await panel(page).getByLabel("Idioma").selectOption("spa");
  const elapsed = await recognize(page);
  await expect(panel(page).getByTestId("ocr-status")).toContainText(
    "Reconocidas 2 páginas",
  );
  console.log(`OCR de 2 páginas (incluye la carga del motor): ${elapsed} ms`);
  // CA3: under 10 s a page on the reference machine; generous here, since
  // the first page also loads the engine and other tests share the CPU.
  expect(elapsed).toBeLessThan(60_000);
  await expect(notice).toHaveCount(0);

  // CA6: doubtful words are marked on screen (page 2 has a smudged line).
  const page2 = page.locator('.page[data-page-number="2"]');
  await page2.scrollIntoViewIfNeeded();
  const low = await page2.getByTestId("ocr-low").count();
  console.log(`Palabras con poca confianza en la página 2: ${low}`);
  expect(low).toBeGreaterThan(0);

  // CA8: plain text in reading order, pages split by form feeds.
  const pending = page.waitForEvent("download");
  await panel(page).getByRole("button", { name: "Exportar .txt" }).click();
  const txt = await readFile((await (await pending).path())!, "utf8");
  expect((await pending).suggestedFilename()).toBe("escaneado.txt");
  const pages = txt.split("\f");
  expect(pages).toHaveLength(2);
  for (const text of pages) {
    expect(text).toContain(TEST_LINES[0]);
    expect(text.indexOf(TEST_LINES[0]!)).toBeLessThan(
      text.indexOf("Celda 1.1"),
    );
  }

  // CA4: the saved PDF is searchable and copyable; the image is unchanged.
  await page.getByRole("button", { name: "Cerrar OCR" }).click();
  // Spec 009: doubtful words are marked only while the OCR panel is open.
  await expect(page2.getByTestId("ocr-low")).toHaveCount(0);
  const saved = await saveAndRead(page);
  for (const n of [1, 2]) {
    const text = (await textRuns(saved.bytes, n)).map((r) => r.str).join(" ");
    expect(text).toContain("Informe de prueba");
    expect(text).toContain("Factura");
  }
  const doc = await openPdf(saved.bytes);
  const ops = await (await doc.getPage(1)).getOperatorList();
  expect(ops.fnArray.length).toBeGreaterThan(0);
  await doc.loadingTask.destroy();

  // CA9: nothing left the app's origin.
  expect(outside).toEqual([]);
});

test("CA5, CA7: recognized text is selectable and opens as scanned text; OCR again replaces the layer", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const outside = await offline(page);
  await openScanned(page);
  await page.getByRole("button", { name: "OCR", exact: true }).click();
  await panel(page).getByLabel("Rango de páginas").fill("1");
  await recognize(page);
  await expect(panel(page).getByTestId("ocr-status")).toContainText(
    "Reconocida 1 página.",
  );
  await page.getByRole("button", { name: "Cerrar OCR" }).click();

  // The title baseline is 74 pt from the top, at x = 56 pt, 18 pt Arimo Bold.
  const box = (await firstPage(page).boundingBox())!;
  const scale = box.width / 595.28;

  // Before saving, the recognized text can be selected and copied.
  await page.mouse.move(box.x + 60 * scale, box.y + 68 * scale);
  await page.mouse.down();
  await page.mouse.move(box.x + 450 * scale, box.y + 68 * scale, {
    steps: 10,
  });
  await page.mouse.up();
  const selected = await page.evaluate(() =>
    window.getSelection()!.toString().trim(),
  );
  // From inside the first word: the rest of the title, words spaced.
  expect(selected).toContain(TEST_LINES[0]!.split(" ").slice(1, 4).join(" "));
  await page.evaluate(() => window.getSelection()!.removeAllRanges());

  // Spec 010 (replaces CA7): "Editar texto" opens a recognized line as text
  // of the image; Esc leaves it as it was.
  await page
    .getByRole("group", { name: "Herramientas de edición" })
    .getByRole("button", { name: "Editar texto", exact: true })
    .click();
  await page.mouse.click(box.x + 120 * scale, box.y + 68 * scale);
  const textbox = page.getByRole("textbox", { name: "Texto", exact: true });
  await expect(textbox).toHaveValue(/Informe de prueba/);
  await textbox.press("Escape");
  await expect(textbox).toHaveCount(0);
  await expect(page.getByTestId("image-edit")).toHaveCount(0);

  let saved = await saveAndRead(page);
  let text = (await textRuns(saved.bytes, 1)).map((r) => r.str).join(" ");
  expect(text).toContain("Informe de prueba");
  const facturas = count(text, "Factura");
  expect(facturas).toBeGreaterThan(0);
  // Page 2 was not in the range.
  expect(await textRuns(saved.bytes, 2)).toEqual([]);

  // CA5: a second run replaces the layer instead of adding another.
  await page.getByRole("button", { name: "OCR", exact: true }).click();
  await panel(page).getByLabel("Rango de páginas").fill("1");
  await recognize(page);
  await page.getByRole("button", { name: "Cerrar OCR" }).click();
  saved = await saveAndRead(page);
  text = (await textRuns(saved.bytes, 1)).map((r) => r.str).join(" ");
  expect(count(text, "Factura")).toBe(facturas);

  // Reopened, the saved layer is invisible page text: it opens as text of
  // the image too (spec 010).
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles({
    name: "escaneado-ocr.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(saved.bytes),
  });
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await page
    .getByRole("group", { name: "Herramientas de edición" })
    .getByRole("button", { name: "Editar texto", exact: true })
    .click();
  const reopened = (await firstPage(page).boundingBox())!;
  await page.mouse.click(reopened.x + 120 * scale, reopened.y + 68 * scale);
  await expect(page.getByTestId("image-edit-cover")).toBeVisible();
  await expect(textbox).toHaveValue(/Informe de prueba/);
  await textbox.press("Escape");
  await expect(textbox).toHaveCount(0);

  expect(outside).toEqual([]);
});

test("CA1: a PDF with real text is not flagged as scanned", async ({
  page,
}) => {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(fixture("simple-text.pdf"));
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  // Give the check time to finish before asserting absence.
  await page.waitForTimeout(500);
  await expect(page.getByTestId("scanned-notice")).toHaveCount(0);
});

test("HU7: the scanner saves a searchable PDF", async ({ page }) => {
  test.setTimeout(240_000);
  const photos = await writePhotos({
    "hoja.jpg": { seed: 611, width: 2400, height: 1800 },
  });
  const outside = await offline(page);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Escanear" }).click();
  const scanner = page.getByRole("dialog", { name: "Escanear documento" });
  await page.getByTestId("scan-images").setInputFiles(photos.path("hoja.jpg"));
  await expect(scanner.locator(".crop-hit")).toHaveCount(4);
  await scanner.getByLabel("Reconocer texto (OCR)").check();
  const pending = page.waitForEvent("download", { timeout: 120_000 });
  await scanner.getByRole("button", { name: "Guardar PDF" }).click();
  const bytes = new Uint8Array(await readFile((await (await pending).path())!));
  const text = (await textRuns(bytes, 1)).map((r) => r.str).join(" ");
  expect(text).toContain("Informe de prueba");
  expect(text).toContain("Factura");
  expect(outside).toEqual([]);
});
