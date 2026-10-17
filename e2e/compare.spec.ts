// Spec 018: comparing the open document with an earlier version: text
// changes, pages that moved, visual differences, swapping and the report.
// The two versions are made here. Screenshots go to docs/screenshots/compare/.
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { firstPage, textRuns } from "./helpers";

const DIR = "docs/screenshots/compare";
let v1: string;
let v2: string;

async function version(pages: string[][], box = false) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((lines, n) => {
    const page = doc.addPage([595, 842]);
    lines.forEach((line, i) =>
      page.drawText(line, { x: 72, y: 760 - i * 36, size: 16, font }),
    );
    if (box && n === pages.length - 1)
      page.drawRectangle({
        x: 72,
        y: 300,
        width: 200,
        height: 120,
        color: rgb(0.2, 0.4, 0.8),
      });
  });
  return doc.save();
}

test.beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "compare-e2e-"));
  v1 = join(dir, "contrato-v1.pdf");
  v2 = join(dir, "contrato-v2.pdf");
  await writeFile(
    v1,
    await version([
      [
        "Contrato de alquiler",
        "El precio es 800 euros al mes",
        "Duracion: 12 meses",
      ],
      ["Clausula final"],
    ]),
  );
  await writeFile(
    v2,
    await version(
      [
        ["Portada"],
        [
          "Contrato de alquiler",
          "El precio es 950 euros al mes",
          "Fianza: dos meses",
          "Duracion: 12 meses",
        ],
        ["Clausula final"],
      ],
      true,
    ),
  );
});

const view = (page: Page) =>
  page.getByRole("dialog", { name: "Comparar versiones" });

async function openV2(page: Page) {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(v2);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
}

test("text changes, moved pages, visual differences and the report", async ({
  page,
}) => {
  await openV2(page);
  await page.getByTestId("compare-pdf").setInputFiles(v1);
  const dialog = view(page);
  await expect(dialog.getByRole("status")).toHaveText(
    "3 cambios de texto en 2 páginas.",
  );
  const changes = dialog.locator(".compare-changes li");
  await expect(changes).toHaveText([
    "Pág. 1 Añadido: «Portada»",
    "Pág. 2 «800» → «950»",
    "Pág. 2 Añadido: «Fianza: dos meses»",
  ]);
  // The cover is new: nothing to put next to it.
  await expect(dialog).toContainText(
    "Página nueva: no está en la versión anterior.",
  );

  await changes.nth(1).getByRole("button").click();
  await expect(dialog.getByText("Página 2 de 3")).toBeVisible();
  await expect(
    dialog.locator('[data-side="before"] .compare-mark.removed'),
  ).toHaveCount(1);
  await expect(
    dialog.locator('[data-side="after"] .compare-mark.added'),
  ).toHaveCount(4);
  await expect(dialog.locator('[data-side="before"] canvas')).toHaveCount(1);
  await expect(dialog.locator("figcaption").first()).toHaveText(
    "Antes · pág. 1",
  );
  await page.screenshot({ path: `${DIR}/cambios-escritorio.png` });

  // The last page only changes in what is drawn.
  await dialog.getByRole("button", { name: "Página siguiente" }).click();
  await expect(dialog.getByText("Página 3 de 3")).toBeVisible();
  await expect(dialog.locator("figcaption").nth(1)).toContainText(
    /Cambia el [\d,.]+ % de la página/,
  );
  await expect(dialog.locator(".compare-mask canvas")).toHaveCount(1);
  await page.screenshot({ path: `${DIR}/visual-escritorio.png` });

  // The report has every change.
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Descargar informe" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("contrato-v2 (comparación).pdf");
  const bytes = new Uint8Array(await readFile((await file.path())!));
  const text = (await textRuns(bytes)).map((r) => r.str).join("\n");
  expect(text).toContain("Informe de comparación");
  expect(text).toContain("Antes: contrato-v1.pdf");
  expect(text).toContain("«800» -> «950»");
  expect(text).toMatch(/Pág\. 3: cambia el [\d,.]+ %/);

  // Swapped, the cover was removed.
  await dialog.getByRole("button", { name: "Intercambiar" }).click();
  await expect(changes.first()).toHaveText("Pág. 1 Quitado: «Portada»");
  await expect(dialog.getByRole("status")).toContainText(
    "1 página de antes ya no está.",
  );

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the same document has no text changes", async ({ page }) => {
  await openV2(page);
  await page.getByTestId("compare-pdf").setInputFiles(v2);
  await expect(view(page).getByRole("status")).toHaveText(
    "El texto es igual en las dos versiones.",
  );
  await expect(view(page).locator("figcaption").nth(1)).toContainText(
    "Sin diferencias visuales.",
  );
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("compare is in the Edit sheet and the versions stack", async ({
    page,
  }) => {
    await openV2(page);
    await page
      .getByRole("navigation", { name: "Categorías de herramientas" })
      .getByRole("button", { name: "Editar" })
      .click();
    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("dialog", { name: "Editar" })
      .getByRole("button", { name: "Comparar" })
      .click();
    await (await chooser).setFiles(v1);
    const dialog = view(page);
    await expect(dialog.getByRole("status")).toHaveText(
      "3 cambios de texto en 2 páginas.",
    );
    await dialog
      .locator(".compare-changes li")
      .nth(1)
      .getByRole("button")
      .click();
    await expect(dialog.locator('[data-side="before"] canvas')).toHaveCount(1);
    const [before, after] = await dialog.locator(".compare-page").all();
    const a = (await before!.boundingBox())!;
    const b = (await after!.boundingBox())!;
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    expect(a.x + a.width).toBeLessThanOrEqual(390);
    for (const control of await dialog
      .locator("header button, .compare-nav button")
      .all())
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
        43.5,
      );
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `${DIR}/comparar-movil.png` });
  });
});
