// Spec 010: editing text of a scanned image. The new text is visible on the
// page (in the editor and in the saved PDF), the paper color covers the old
// line, and nothing else of the page changes. Before/after crops are written
// to docs/screenshots/scan-edit/.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName, type PDFDict, type PDFRawStream } from "pdf-lib";
import { firstPage, saveAndRead, textRuns } from "./helpers";
import { writeScannedPdf } from "./scannedPdf";
import { writePhotos, type PhotoFiles } from "./scanPhotos";

let scannedPdf: string;
let photos: PhotoFiles;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  scannedPdf = await writeScannedPdf();
  photos = await writePhotos({
    "hoja.jpg": { seed: 1001, width: 1800, height: 2400 },
  });
});

const OUT = "docs/screenshots/scan-edit";
const NEW_TITLE = "Informe corregido en InkognitoPDF";

const panel = (page: Page) =>
  page.getByRole("dialog", { name: "Reconocer texto" });
const textbox = (page: Page) =>
  page.getByRole("textbox", { name: "Texto", exact: true });

async function recognizeFirstPage(page: Page) {
  await page.getByRole("button", { name: "OCR", exact: true }).click();
  await panel(page).getByLabel("Rango de páginas").fill("1");
  await panel(page).getByLabel("Idioma").selectOption("spa");
  await panel(page).getByRole("button", { name: "Reconocer" }).click();
  await expect(panel(page).getByTestId("ocr-status")).toContainText(
    "Reconocida 1 página.",
    { timeout: 120_000 },
  );
  await page.getByRole("button", { name: "Cerrar OCR" }).click();
}

async function editTextTool(page: Page) {
  await page
    .getByRole("group", { name: "Herramientas de edición" })
    .getByRole("button", { name: "Editar texto", exact: true })
    .click();
}

/** Every pixel of the page canvas, for comparing two renders. */
async function canvasPixels(page: Page) {
  return firstPage(page)
    .locator("canvas")
    .first()
    .evaluate((c: HTMLCanvasElement) => ({
      width: c.width,
      height: c.height,
      data: Array.from(
        c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data,
      ),
    }));
}

/** The page's title line, in page pixels (title baseline 74 pt from the top). */
async function titleCrop(page: Page, locator: Locator, name: string) {
  const box = (await firstPage(page).boundingBox())!;
  const scale = box.width / 595.28;
  await locator.page().screenshot({
    path: `${OUT}/${name}.png`,
    clip: {
      x: box.x + 30 * scale,
      y: box.y + 40 * scale,
      width: 520 * scale,
      height: 110 * scale,
    },
  });
}

function imageStream(doc: PDFDocument): PDFRawStream {
  const xobjects = doc
    .getPage(0)
    .node.Resources()!
    .lookup(PDFName.of("XObject")) as PDFDict;
  for (const key of xobjects.keys()) {
    const stream = doc.context.lookup(xobjects.get(key)!) as PDFRawStream;
    if (stream.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"))
      return stream;
  }
  throw new Error("no image");
}

test("CA1, CA3–CA6: a recognized line is replaced in the image", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(scannedPdf);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");

  // CA2: without recognized text, editing offers OCR.
  await editTextTool(page);
  const box = (await firstPage(page).boundingBox())!;
  const scale = box.width / 595.28;
  const title = { x: box.x + 120 * scale, y: box.y + 68 * scale };
  await page.mouse.click(title.x, title.y);
  await expect(page.getByTestId("need-ocr")).toBeVisible();
  await page
    .getByTestId("need-ocr")
    .getByRole("button", { name: "Reconocer texto" })
    .click();
  await expect(panel(page)).toBeVisible();
  await page.getByRole("button", { name: "Cerrar OCR" }).click();

  await recognizeFirstPage(page);
  // The notices are gone: the page may have moved.
  await expect(page.getByTestId("need-ocr")).toHaveCount(0);
  await expect(page.getByTestId("scanned-notice")).toHaveCount(0);
  const placed = (await firstPage(page).boundingBox())!;
  title.x = placed.x + 120 * scale;
  title.y = placed.y + 68 * scale;
  const before = await canvasPixels(page);
  await titleCrop(page, firstPage(page), "1-antes");

  // CA1: the line opens with its recognized text; CA3: on the paper color,
  // measured in the pixels (grey, not white).
  await editTextTool(page);
  await page.mouse.click(title.x, title.y);
  await expect(textbox(page)).toHaveValue(/Informe de prueba/);
  const cover = page.getByTestId("image-edit-cover");
  await expect(cover).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await titleCrop(page, firstPage(page), "2-editando");
  await textbox(page).fill(NEW_TITLE);
  await textbox(page).press("Control+Enter");
  const edit = page.getByTestId("image-edit");
  await expect(edit).toHaveCount(1);
  await expect(firstPage(page).getByText(NEW_TITLE)).toBeVisible();
  const paper = await edit.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  console.log(`color del papel medido: ${paper}`);
  await page.getByRole("button", { name: "Seleccionar", exact: true }).click();
  await page.mouse.click(box.x + 5, box.y + box.height - 5);
  await titleCrop(page, firstPage(page), "3-despues");

  // CA6: undo brings back the original image; redo the edit.
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(edit).toHaveCount(0);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(edit).toHaveCount(1);

  // CA5: the saved text has the new line and not the old one.
  const saved = await saveAndRead(page);
  const text = (await textRuns(saved.bytes, 1)).map((r) => r.str).join(" ");
  expect(text).toContain(NEW_TITLE);
  expect(text).not.toContain("Informe de prueba");
  expect(text).toContain("Factura");

  // CA4: the image of the page is the same bytes (not re-encoded).
  const original = await PDFDocument.load(await readFile(scannedPdf));
  const edited = await PDFDocument.load(saved.bytes);
  expect(Buffer.from(imageStream(edited).contents)).toEqual(
    Buffer.from(imageStream(original).contents),
  );

  // CA3, CA4: reopened, the page looks like the editor showed it, and
  // outside the edited line the pixels are those of the original.
  const area = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>(
      '[data-testid="image-edit"]',
    )!;
    const page = el.closest(".page")!.getBoundingClientRect();
    // The patch, and the new text where it is longer than the old line.
    const text = document.createRange();
    text.selectNodeContents(el.nextElementSibling!);
    const rects = [el.getBoundingClientRect(), text.getBoundingClientRect()];
    const x0 = Math.min(...rects.map((r) => r.left));
    const y0 = Math.min(...rects.map((r) => r.top));
    const x1 = Math.max(...rects.map((r) => r.right));
    const y1 = Math.max(...rects.map((r) => r.bottom));
    return { x: x0 - page.x, y: y0 - page.y, width: x1 - x0, height: y1 - y0 };
  });
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles({
    name: "editado.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(saved.bytes),
  });
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  const after = await canvasPixels(page);
  expect([after.width, after.height]).toEqual([before.width, before.height]);
  const k = after.width / box.width;
  const margin = 4;
  let outside = 0;
  let changed = 0;
  let inside = 0;
  let changedInside = 0;
  for (let y = 0; y < after.height; y++)
    for (let x = 0; x < after.width; x++) {
      const i = (y * after.width + x) * 4;
      const diff = Math.max(
        Math.abs(after.data[i]! - before.data[i]!),
        Math.abs(after.data[i + 1]! - before.data[i + 1]!),
        Math.abs(after.data[i + 2]! - before.data[i + 2]!),
      );
      const inArea =
        x >= area.x * k - margin &&
        x <= (area.x + area.width) * k + margin &&
        y >= area.y * k - margin &&
        y <= (area.y + area.height) * k + margin;
      if (inArea) {
        inside++;
        if (diff > 40) changedInside++;
      } else {
        outside++;
        if (diff > 2) changed++;
      }
    }
  console.log(
    `píxeles distintos fuera de la línea: ${changed} de ${outside}; dentro: ${changedInside} de ${inside}`,
  );
  await titleCrop(page, firstPage(page), "4-pdf-guardado");
  expect(changed).toBe(0);
  expect(changedInside / inside).toBeGreaterThan(0.02);
});

test("CA1: the invisible text layer of a saved scan opens as text of the image", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(scannedPdf);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await recognizeFirstPage(page);
  const withOcr = await saveAndRead(page);

  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles({
    name: "con-ocr.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(withOcr.bytes),
  });
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await editTextTool(page);
  const box = (await firstPage(page).boundingBox())!;
  const scale = box.width / 595.28;
  await page.mouse.click(box.x + 120 * scale, box.y + 68 * scale);
  await expect(page.getByTestId("image-edit-cover")).toBeVisible();
  // The whole line, not only the word clicked.
  await expect(textbox(page)).toHaveValue(/Informe de prueba para el/);
  await textbox(page).fill(NEW_TITLE);
  await textbox(page).press("Control+Enter");
  await expect(page.getByTestId("image-edit")).toHaveCount(1);

  const saved = await saveAndRead(page);
  const text = (await textRuns(saved.bytes, 1)).map((r) => r.str).join(" ");
  expect(text).toContain(NEW_TITLE);
  expect(text).not.toContain("Informe de prueba");
  expect(text).toContain("Factura");
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test("CA8: a scanned page with OCR is edited with Cancel and Accept in view", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await page.goto("/app/");
    await page.getByRole("button", { name: "Escanear" }).click();
    const scanner = page.getByRole("dialog", { name: "Escanear documento" });
    await scanner.getByRole("button", { name: "Ajustes del escáner" }).click();
    await scanner.getByLabel("Reconocer texto (OCR)").check();
    await scanner.getByRole("button", { name: "Cerrar los ajustes" }).click();
    await scanner
      .getByTestId("scan-images")
      .setInputFiles(photos.path("hoja.jpg"));
    await expect(scanner.locator(".crop-hit")).toHaveCount(4);
    await scanner.getByRole("button", { name: "Continuar" }).click();
    await expect(scanner.locator("img.scan-result")).toHaveAttribute(
      "data-mode",
      "bw",
    );
    await scanner.getByRole("button", { name: "Continuar" }).click();
    await scanner.getByRole("button", { name: "Abrir en el editor" }).click();
    await expect(scanner).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByTestId("ocr-text")).toHaveCount(1);

    // The first recognized word (the title), seen with the select tool.
    const line = page.getByTestId("ocr-text").locator("span").first();
    const at = (await line.boundingBox())!;
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await page
      .getByRole("button", { name: "Editar texto", exact: true })
      .click();
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await expect(textbox(page)).toBeVisible();
    const bar = page.getByRole("group", { name: "Texto en edición" });
    const accept = bar.getByRole("button", { name: "Aceptar" });
    await expect(accept).toBeVisible();
    const button = (await accept.boundingBox())!;
    expect(button.y + button.height).toBeLessThanOrEqual(844);
    expect(button.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${OUT}/5-movil-editando.png` });

    // Cancel leaves the page as it was.
    await bar.getByRole("button", { name: "Cancelar" }).click();
    await expect(textbox(page)).toHaveCount(0);
    await expect(page.getByTestId("image-edit")).toHaveCount(0);

    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await textbox(page).fill(NEW_TITLE);
    await page
      .getByRole("group", { name: "Texto en edición" })
      .getByRole("button", { name: "Aceptar" })
      .click();
    await expect(page.getByTestId("image-edit")).toHaveCount(1);
    await expect(firstPage(page).getByText(NEW_TITLE)).toBeVisible();
    await page.screenshot({ path: `${OUT}/6-movil-editado.png` });
  });
});
