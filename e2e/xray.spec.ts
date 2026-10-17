// Spec 015: the privacy x-ray, its report, the earlier version and the clean
// copy, on desktop and on a phone. Screenshots go to docs/screenshots/xray/.
import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { scanPrivacy } from "../src/engine/privacy";
import { leaky } from "../tests/privacyFixture";
import { firstPage, fixture, openTask, saveAndRead } from "./helpers";

const DIR = "docs/screenshots/xray";

let file: string;

test.beforeAll(async () => {
  file = join(await mkdtemp(join(tmpdir(), "xray-e2e-")), "contrato.pdf");
  await writeFile(file, await leaky());
});

const panel = (page: Page) =>
  page.getByRole("dialog", { name: "¿Qué esconde este PDF?" });
const findingOf = (page: Page, kind: string) =>
  panel(page).locator(`.xray-finding[data-kind="${kind}"]`);

async function open(page: Page, path: string) {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(path);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
}

async function download(page: Page, click: () => Promise<void>) {
  const event = page.waitForEvent("download");
  await click();
  const d = await event;
  return {
    name: d.suggestedFilename(),
    bytes: new Uint8Array(await readFile((await d.path())!)),
  };
}

test("the report, the earlier version, cleaning and then saving", async ({
  page,
}) => {
  await open(page, file);
  await openTask(page, "Revisar");
  await page.getByRole("button", { name: "Radiografía" }).click();
  await expect(panel(page).getByRole("status")).toHaveText(
    "Este PDF esconde 10 cosas que no se ven.",
  );
  await expect(findingOf(page, "versions")).toContainText("Riesgo alto");
  await expect(findingOf(page, "metadata")).toContainText("Autor: Ana Secreta");
  await expect(findingOf(page, "hiddenText")).toContainText(
    "Página 1: invisible «INVISIBLE SECRETO»",
  );
  await expect(findingOf(page, "attachments")).toContainText("nomina.csv");
  await expect(findingOf(page, "javascript")).toContainText(
    "En el documento: app.alert('hola');",
  );
  await expect(findingOf(page, "authors")).toContainText(
    "Pedro Revisor (1 comentario)",
  );
  // Links and the OCR text are left unchecked.
  await expect(
    findingOf(page, "links").getByRole("checkbox", { name: "Quitar" }),
  ).not.toBeChecked();
  await expect(
    findingOf(page, "metadata").getByRole("checkbox", { name: "Quitar" }),
  ).toBeChecked();
  await page.screenshot({ path: `${DIR}/radiografia-escritorio.png` });

  const old = await download(page, () =>
    findingOf(page, "versions")
      .getByRole("button", { name: "Descargar" })
      .click(),
  );
  expect(old.name).toBe("contrato (versión anterior 1).pdf");
  const before = await PDFDocument.load(old.bytes, { updateMetadata: false });
  expect(before.getTitle()).toBe("Contrato de alquiler");

  // Unchecking metadata keeps it in the clean copy.
  await findingOf(page, "metadata")
    .getByRole("checkbox", { name: "Quitar" })
    .uncheck();
  // Cleaning changes the open document and downloads nothing.
  let downloads = 0;
  page.on("download", () => downloads++);
  await panel(page)
    .getByRole("button", { name: "Limpiar", exact: true })
    .click();
  await expect(panel(page).getByRole("status")).toContainText(
    "Limpio. Así queda el documento; guárdalo con «Guardar PDF» cuando termines:",
  );
  await expect(panel(page).locator(".xray-finding")).toHaveCount(3);
  expect(downloads).toBe(0);
  await page.screenshot({ path: `${DIR}/copia-limpia-escritorio.png` });

  // Saving afterwards keeps it clean.
  await panel(page).getByRole("button", { name: "Cerrar radiografía" }).click();
  const saved = await saveAndRead(page);
  expect(saved.name).toBe("contrato (editado).pdf");
  const report = await scanPrivacy(saved.bytes);
  expect(report.findings.map((f) => f.kind)).toEqual([
    "metadata",
    "links",
    "ocrText",
  ]);
  const doc = await PDFDocument.load(saved.bytes, { updateMetadata: false });
  expect(doc.getAuthor()).toBe("Ana Secreta");
});

test("a plain document has nothing hidden", async ({ page }) => {
  await open(page, fixture("two-pages.pdf"));
  await openTask(page, "Revisar");
  await page.getByRole("button", { name: "Radiografía" }).click();
  await expect(panel(page).getByRole("status")).toHaveText(
    /No encontramos nada|Este PDF esconde/,
  );
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the x-ray is in the More sheet and fits", async ({ page }) => {
    await open(page, file);
    await page
      .getByRole("navigation", { name: "Categorías de herramientas" })
      .getByRole("button", { name: "Más" })
      .click();
    await page
      .getByRole("dialog", { name: "Más" })
      .getByRole("button", { name: "Radiografía" })
      .click();
    await expect(panel(page).getByRole("status")).toContainText(
      "Este PDF esconde",
    );
    const box = (await panel(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    for (const control of await panel(page).locator("button, label").all())
      if (await control.isVisible())
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
          43.5,
        );
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `${DIR}/radiografia-movil.png` });
  });
});
