// Spec 012: secure redaction from the editor, on desktop and on a phone.
// Screenshots go to docs/screenshots/redaction/.
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { readFile } from "node:fs/promises";
import {
  firstPage,
  fixture,
  openFixture,
  saveAndRead,
  textRuns,
} from "./helpers";

const DIR = "docs/screenshots/redaction";

/** The words anywhere in the file: raw bytes and every decoded stream. */
async function inFile(bytes: Uint8Array, word: string) {
  const texts = [Buffer.from(bytes).toString("latin1")];
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    texts.push(obj.toString());
    if (obj instanceof PDFRawStream)
      try {
        texts.push(
          Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1"),
        );
      } catch {
        // Not decodable here (e.g. an image): its raw bytes were searched.
      }
  }
  const hex = Buffer.from(word, "latin1").toString("hex");
  return texts.some((t) => t.includes(word) || t.toLowerCase().includes(hex));
}

async function chooseRedact(page: Page) {
  await page
    .getByRole("group", { name: "Herramientas de edición" })
    .getByRole("button", { name: "Borrado seguro", exact: true })
    .click();
}

/** Drags over the text run that contains `text`. */
async function markRun(page: Page, text: string) {
  const span = firstPage(page).locator(".textLayer span", { hasText: text });
  const box = (await span.first().boundingBox())!;
  await page.mouse.move(box.x - 3, box.y - 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 4,
  });
  await page.mouse.move(box.x + box.width + 3, box.y + box.height + 2, {
    steps: 4,
  });
  await page.mouse.up();
}

test("mark, search, apply with a warning, and the text is gone from the file", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  const before = (
    await textRuns(new Uint8Array(await readFile(fixture("simple-text.pdf"))))
  ).map((r) => r.str);
  expect(before.join(" ")).toContain("rapido");
  await chooseRedact(page);
  const options = page.getByRole("group", { name: "Borrado seguro" });
  const apply = options.getByRole("button", { name: /Aplicar borrado/ });
  await expect(apply).toBeDisabled();

  // Search and mark.
  await options
    .getByRole("searchbox", { name: "Buscar para borrar" })
    .fill("RÁPIDO");
  await options.getByRole("button", { name: "Marcar coincidencias" }).click();
  await expect(options.getByRole("status")).toHaveText(/coincidencia/);
  const marks = firstPage(page).locator('[data-kind="redaction"]');
  await expect(marks).not.toHaveCount(0);
  const found = await marks.count();

  // And a drawn area over the title.
  await markRun(page, "Documento de prueba");
  await expect(marks).toHaveCount(found + 1);
  await expect(apply).toHaveText(`Aplicar borrado (${found + 1})`);
  await page.screenshot({ path: `${DIR}/marcar-escritorio.png` });

  // One step, with a clear warning.
  await apply.click();
  const dialog = page.getByRole("alertdialog", {
    name: "¿Aplicar el borrado seguro?",
  });
  await expect(dialog).toContainText("No se podrá deshacer");
  await page.screenshot({ path: `${DIR}/aviso-escritorio.png` });
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  await expect(marks.locator(".applied")).toHaveCount(0);

  await apply.click();
  await dialog.getByRole("checkbox", { name: /metadatos/ }).check();
  await dialog.getByRole("button", { name: "Aplicar borrado" }).click();
  await expect(dialog).toBeHidden();
  await expect(firstPage(page).locator(".item-redaction.applied")).toHaveCount(
    found + 1,
  );
  await expect(apply).toBeDisabled();

  // Undo brings the marks back; redo applies them again.
  await page.keyboard.press("Control+z");
  await expect(firstPage(page).locator(".item-redaction.applied")).toHaveCount(
    0,
  );
  await page.keyboard.press("Control+y");
  await expect(firstPage(page).locator(".item-redaction.applied")).toHaveCount(
    found + 1,
  );
  await page.screenshot({ path: `${DIR}/aplicado-escritorio.png` });

  const { bytes } = await saveAndRead(page);
  const after = (await textRuns(bytes)).map((r) => r.str).join(" ");
  expect(after).not.toMatch(/rapido|Documento de prueba/i);
  // The rest of the text is still there.
  expect(after).toContain("zorro");
  for (const word of ["rapido", "Documento de prueba"])
    expect(await inFile(bytes, word)).toBe(false);
});

test("marks that are not applied remove nothing and saving says so", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await chooseRedact(page);
  await markRun(page, "Documento de prueba");
  const { bytes } = await saveAndRead(page);
  expect((await textRuns(bytes)).map((r) => r.str).join(" ")).toContain(
    "Documento de prueba",
  );
  await expect(page.getByText(/sin aplicar/)).toBeVisible();
});

test("an invalid regular expression is reported", async ({ page }) => {
  await openFixture(page, "simple-text.pdf");
  await chooseRedact(page);
  const options = page.getByRole("group", { name: "Borrado seguro" });
  await options.getByRole("checkbox", { name: "Expresión regular" }).check();
  await options.getByRole("searchbox").fill("(abc");
  await options.getByRole("button", { name: "Marcar coincidencias" }).click();
  await expect(options.getByRole("status")).toHaveText(
    "La expresión regular no es válida.",
  );
  // A valid one marks every number.
  await options.getByRole("searchbox").fill("\\p{L}+o\\b");
  await options.getByRole("button", { name: "Marcar coincidencias" }).click();
  await expect(options.getByRole("status")).toHaveText(
    /coincidencias? marcadas?/,
  );
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the tool is in Edit, the options and the warning fit", async ({
    page,
  }) => {
    await openFixture(page, "simple-text.pdf");
    const bar = page.getByRole("navigation", {
      name: "Categorías de herramientas",
    });
    await bar.getByRole("button", { name: "Editar" }).click();
    await page
      .getByRole("dialog", { name: "Editar" })
      .getByRole("button", { name: "Borrado seguro" })
      .click();
    const options = page.locator(".mobile-options");
    const search = options.getByRole("searchbox", {
      name: "Buscar para borrar",
    });
    await expect(search).toBeVisible();
    await search.fill("zorro");
    await options.getByRole("button", { name: "Marcar coincidencias" }).click();
    await expect(options.getByRole("status")).toHaveText(/coincidencia/);
    const [scrollWidth, width] = await page.evaluate(() => [
      document.documentElement.scrollWidth,
      window.innerWidth,
    ]);
    expect(scrollWidth).toBeLessThanOrEqual(width);
    for (const control of [
      search,
      options.getByRole("button", { name: "Marcar coincidencias" }),
      options.getByRole("button", { name: /Aplicar borrado/ }),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.5);
    }
    await page.screenshot({ path: `${DIR}/marcar-movil.png` });
    await options.getByRole("button", { name: /Aplicar borrado/ }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    for (const button of await dialog.getByRole("button").all())
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await page.screenshot({ path: `${DIR}/aviso-movil.png` });
    await dialog.getByRole("button", { name: "Aplicar borrado" }).click();
    await expect(
      firstPage(page).locator(".item-redaction.applied"),
    ).not.toHaveCount(0);
    await page.screenshot({ path: `${DIR}/aplicado-movil.png` });
  });
});
