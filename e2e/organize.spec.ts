// Spec 013: merging, inserting, reordering by dragging and splitting, on
// desktop and on a phone. Screenshots go to docs/screenshots/merge-split/.
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { firstPage, fixture, openPdf, saveAndRead, textRuns } from "./helpers";

const DIR = "docs/screenshots/merge-split";

const thumbnails = (page: Page) => page.locator(".thumbnails .thumbnail");

/** First text run of every page. */
async function pageTitles(bytes: Uint8Array) {
  const doc = await openPdf(bytes);
  const titles: string[] = [];
  for (let i = 1; i <= doc.numPages; i++)
    titles.push((await textRuns(bytes, i))[0]?.str ?? "");
  await doc.loadingTask.destroy();
  return titles;
}

/** The files of a stored ZIP, read from its central directory. */
function unzip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  const files: { name: string; bytes: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    const size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const local = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(pos + 46, pos + 46 + nameLength),
    );
    const start = local + 30 + view.getUint16(local + 26, true);
    files.push({ name, bytes: bytes.slice(start, start + size) });
    pos += 46 + nameLength;
  }
  return files;
}

async function download(page: Page, click: () => Promise<void>) {
  const event = page.waitForEvent("download");
  await click();
  const file = await event;
  return {
    name: file.suggestedFilename(),
    bytes: new Uint8Array(await readFile((await file.path())!)),
  };
}

async function openTwoPages(page: Page) {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(fixture("two-pages.pdf"));
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
}

test("opening several PDFs at once merges them in order", async ({ page }) => {
  await page.goto("/app/");
  await page
    .getByTestId("open-pdf")
    .setInputFiles([fixture("two-pages.pdf"), fixture("simple-text.pdf")]);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await expect(thumbnails(page)).toHaveCount(3);
  const { bytes } = await saveAndRead(page);
  expect(await pageTitles(bytes)).toEqual([
    "Pagina 1 de 2",
    "Pagina 2 de 2",
    "Documento de prueba pdfcraft",
  ]);
});

test("insert a PDF at the end, undo it, drag a page down", async ({ page }) => {
  await openTwoPages(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Insertar PDF" }).click();
  await (await chooser).setFiles(fixture("simple-text.pdf"));
  await expect(page.getByText("Se añadió 1 página al final.")).toBeVisible();
  await expect(thumbnails(page)).toHaveCount(3);
  await expect(thumbnails(page).nth(2)).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.screenshot({ path: `${DIR}/insertar-escritorio.png` });

  // One undoable step.
  await page.keyboard.press("Control+z");
  await expect(thumbnails(page)).toHaveCount(2);
  await page.keyboard.press("Control+y");
  await expect(thumbnails(page)).toHaveCount(3);

  // Drag the first thumbnail below the middle of the second one.
  const from = (await thumbnails(page).nth(0).locator("canvas").boundingBox())!;
  const to = (await thumbnails(page).nth(1).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    from.x + from.width / 2,
    from.y + from.height / 2 + 20,
    {
      steps: 4,
    },
  );
  await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.8, {
    steps: 8,
  });
  await expect(thumbnails(page).nth(0)).toHaveClass(/dragged/);
  await expect(thumbnails(page).nth(2)).toHaveClass(/drop-before/);
  await page.screenshot({ path: `${DIR}/arrastrar-escritorio.png` });
  await page.mouse.up();
  await expect(thumbnails(page).locator(".dragged")).toHaveCount(0);
  // The drag did not also go to the page.
  await expect(page.locator(".page-indicator")).toHaveText(/^Página 1 /);

  const { bytes } = await saveAndRead(page);
  expect(await pageTitles(bytes)).toEqual([
    "Pagina 2 de 2",
    "Pagina 1 de 2",
    "Documento de prueba pdfcraft",
  ]);
  // Undo puts the page back where it was.
  await page.keyboard.press("Control+z");
  const again = await saveAndRead(page);
  expect((await pageTitles(again.bytes))[0]).toBe("Pagina 1 de 2");
});

test("split by ranges into a ZIP, or extract the chosen pages", async ({
  page,
}) => {
  await openTwoPages(page);
  await page.getByRole("button", { name: "Dividir", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Dividir o extraer páginas" });
  const go = panel.getByRole("button", { name: /^Descargar/ });
  await expect(go).toBeDisabled();

  const ranges = panel.getByRole("textbox", { name: "Rangos de páginas" });
  await ranges.fill("3");
  await expect(panel.getByRole("status")).toHaveText(/no está entre 1 y 2/);
  await expect(go).toBeDisabled();
  await ranges.fill("2, 1-2");
  await expect(panel.getByRole("status")).toContainText(
    "two-pages (páginas 1-2).pdf",
  );
  await expect(go).toHaveText("Descargar ZIP (2 archivos)");
  await page.screenshot({ path: `${DIR}/dividir-escritorio.png` });
  const zipped = await download(page, () => go.click());
  expect(zipped.name).toBe("two-pages (partes).zip");
  const files = unzip(zipped.bytes);
  expect(files.map((f) => f.name)).toEqual([
    "two-pages (páginas 2).pdf",
    "two-pages (páginas 1-2).pdf",
  ]);
  expect(await pageTitles(files[0]!.bytes)).toEqual(["Pagina 2 de 2"]);
  expect(await pageTitles(files[1]!.bytes)).toEqual([
    "Pagina 1 de 2",
    "Pagina 2 de 2",
  ]);

  // Extract the chosen page: one PDF.
  await panel.getByRole("radio", { name: "Páginas elegidas" }).check();
  await expect(panel.getByRole("status")).toHaveText(
    "Elige al menos una página.",
  );
  await panel.getByRole("button", { name: "Página 2" }).click();
  await expect(go).toHaveText("Descargar PDF");
  const single = await download(page, () => go.click());
  expect(single.name).toBe("two-pages (páginas 2).pdf");
  expect(await pageTitles(single.bytes)).toEqual(["Pagina 2 de 2"]);

  // Every N pages.
  await panel.getByRole("radio", { name: "Cada N páginas" }).check();
  await expect(go).toHaveText("Descargar ZIP (2 archivos)");
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("insert and split are in the Edit sheet and fit", async ({ page }) => {
    await openTwoPages(page);
    const bar = page.getByRole("navigation", {
      name: "Categorías de herramientas",
    });
    await bar.getByRole("button", { name: "Editar" }).click();
    const sheet = page.getByRole("dialog", { name: "Editar" });
    await expect(
      sheet.getByRole("button", { name: "Insertar PDF" }),
    ).toBeVisible();
    await page.screenshot({ path: `${DIR}/hoja-editar-movil.png` });

    const chooser = page.waitForEvent("filechooser");
    await sheet.getByRole("button", { name: "Insertar PDF" }).click();
    await (await chooser).setFiles(fixture("simple-text.pdf"));
    await expect(page.getByText("Se añadió 1 página al final.")).toBeVisible();

    await bar.getByRole("button", { name: "Editar" }).click();
    await sheet.getByRole("button", { name: "Dividir" }).click();
    const panel = page.getByRole("dialog", {
      name: "Dividir o extraer páginas",
    });
    await panel.getByRole("radio", { name: "Páginas elegidas" }).check();
    await panel.getByRole("button", { name: "Página 3" }).click();
    const [scrollWidth, width] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    for (const button of await panel.getByRole("button").all())
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await page.screenshot({ path: `${DIR}/dividir-movil.png` });
    const single = await download(page, () =>
      panel.getByRole("button", { name: "Descargar PDF" }).click(),
    );
    expect(await pageTitles(single.bytes)).toEqual([
      "Documento de prueba pdfcraft",
    ]);
  });
});
