// Spec 016: personal data found in the text, chosen and marked for secure
// redaction, on desktop and on a phone. The file is made here. Screenshots go
// to docs/screenshots/pii/.
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstPage, saveAndRead, textRuns } from "./helpers";

const DIR = "docs/screenshots/pii";

let file: string;

test.beforeAll(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  [
    "CONTRATO DE ARRENDAMIENTO",
    "Inquilino: Juan Perez, DNI 12345678Z",
    "Cuenta IBAN ES91 2100 0418 4502 0005 1332",
    "Correo juan.perez@correo.es",
    "Telefono +34 612 345 678",
    "Referencia interna 12345678A",
  ].forEach((line, i) =>
    page.drawText(line, { x: 60, y: 760 - i * 40, size: 14, font }),
  );
  file = join(await mkdtemp(join(tmpdir(), "pii-e2e-")), "contrato.pdf");
  await writeFile(file, await doc.save());
});

const dialogOf = (page: Page) =>
  page.getByRole("dialog", { name: "Datos personales en el documento" });

async function open(page: Page) {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(file);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
}

test("find, choose, mark and the data is gone from the file", async ({
  page,
}) => {
  await open(page);
  await page
    .getByRole("group", { name: "Herramientas de edición" })
    .getByRole("button", { name: "Borrado seguro", exact: true })
    .click();
  const options = page.getByRole("group", { name: "Borrado seguro" });
  await options.getByRole("button", { name: "Datos personales" }).click();

  const dialog = dialogOf(page);
  await expect(dialog.getByRole("status")).toHaveText(
    "Encontramos 4 datos personales. Elige cuáles marcar para borrar.",
  );
  for (const [kind, value] of [
    ["idEs", "12345678Z"],
    ["iban", "ES91 2100 0418 4502 0005 1332"],
    ["email", "juan.perez@correo.es"],
    ["phone", "+34 612 345 678"],
  ])
    await expect(dialog.locator(`fieldset[data-kind="${kind}"]`)).toContainText(
      value!,
    );
  // A number whose letter is wrong is not proposed.
  await expect(dialog).not.toContainText("12345678A");
  await page.screenshot({ path: `${DIR}/revisar-escritorio.png` });

  // The email stays.
  await dialog
    .locator('fieldset[data-kind="email"]')
    .getByRole("checkbox")
    .uncheck();
  await dialog.getByRole("button", { name: "Marcar 3 para borrar" }).click();
  await expect(dialog).toBeHidden();
  await expect(options.getByRole("status")).toHaveText(
    "3 datos marcados. Revisa las marcas y pulsa «Aplicar borrado».",
  );
  const marks = firstPage(page).locator('[data-kind="redaction"]');
  await expect(marks).toHaveCount(3);
  await page.screenshot({ path: `${DIR}/marcado-escritorio.png` });

  // Opening it again shows them as already marked.
  await options.getByRole("button", { name: "Datos personales" }).click();
  await expect(
    dialog.locator('fieldset[data-kind="idEs"]').getByRole("checkbox"),
  ).toBeDisabled();
  await expect(dialog.locator('fieldset[data-kind="idEs"]')).toContainText(
    "ya marcado",
  );
  await expect(
    dialog.getByRole("button", { name: "Marcar 1 para borrar" }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();

  await options.getByRole("button", { name: /Aplicar borrado/ }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByRole("button", { name: "Aplicar borrado" }).click();
  await expect(confirm).toBeHidden();
  await expect(firstPage(page).locator(".item-redaction.applied")).toHaveCount(
    3,
  );

  const { bytes } = await saveAndRead(page);
  const text = (await textRuns(bytes)).map((r) => r.str).join(" ");
  for (const gone of ["12345678Z", "0418", "612"])
    expect(text).not.toContain(gone);
  expect(text).toContain("juan.perez@correo.es");
  expect(text).toContain("12345678A");
  expect(text).toContain("CONTRATO DE ARRENDAMIENTO");
});

test("a document without personal data says so", async ({ page }) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc
    .addPage([595, 842])
    .drawText("Acta de la reunion del 3 de mayo, 12 asistentes.", {
      x: 60,
      y: 760,
      size: 14,
      font,
    });
  const plain = join(await mkdtemp(join(tmpdir(), "pii-e2e-")), "acta.pdf");
  await writeFile(plain, await doc.save());
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(plain);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await page
    .getByRole("group", { name: "Herramientas de edición" })
    .getByRole("button", { name: "Borrado seguro", exact: true })
    .click();
  await page
    .getByRole("group", { name: "Borrado seguro" })
    .getByRole("button", { name: "Datos personales" })
    .click();
  await expect(dialogOf(page).getByRole("status")).toHaveText(
    "No encontramos datos personales en el texto del documento.",
  );
  await expect(
    dialogOf(page).getByRole("button", { name: /para borrar/ }),
  ).toBeDisabled();
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the review fits and its controls are big enough", async ({ page }) => {
    await open(page);
    await page
      .getByRole("navigation", { name: "Categorías de herramientas" })
      .getByRole("button", { name: "Editar" })
      .click();
    await page
      .getByRole("dialog", { name: "Editar" })
      .getByRole("button", { name: "Borrado seguro" })
      .click();
    await page
      .locator(".mobile-options")
      .getByRole("button", { name: "Datos personales" })
      .click();
    const dialog = dialogOf(page);
    await expect(dialog.getByRole("status")).toContainText("Encontramos 4");
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
    for (const control of await dialog.locator("button, label").all())
      if (await control.isVisible())
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
          43.5,
        );
    await page.screenshot({ path: `${DIR}/revisar-movil.png` });
    await dialog.getByRole("button", { name: "Marcar 4 para borrar" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      firstPage(page).locator('[data-kind="redaction"]'),
    ).toHaveCount(4);
  });
});
