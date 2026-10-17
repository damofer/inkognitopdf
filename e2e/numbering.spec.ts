// Spec 022: page numbers, headers and footers, with their preview, on desktop
// and on a phone. Screenshots go to docs/screenshots/page-numbers/.
import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { firstPage, fixture, saveAndRead, textRuns } from "./helpers";

const DIR = "docs/screenshots/page-numbers";

let report: string;

test.beforeAll(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 5; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(i === 1 ? "Portada del expediente" : `Folio ${i}`, {
      x: 72,
      y: 760,
      size: 22,
      font,
    });
    for (let line = 0; line < 20; line++)
      page.drawText("Texto del informe pericial, línea de relleno.", {
        x: 72,
        y: 700 - line * 24,
        size: 12,
        font,
      });
  }
  report = join(await mkdtemp(join(tmpdir(), "numbering-e2e-")), "informe.pdf");
  await writeFile(report, await doc.save());
});

const panel = (page: Page) =>
  page.getByRole("dialog", { name: "Numerar páginas" });
const pageAt = (page: Page, n: number) =>
  page.locator(`.page[data-page-number="${n}"]`);

async function open(page: Page, file: string) {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(file);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
}

test("«Página 1 de N» at the bottom: preview, apply and real text", async ({
  page,
}) => {
  await open(page, report);
  await page.getByRole("button", { name: "Numerar", exact: true }).click();
  // The default is the number alone, at the bottom center.
  await expect(firstPage(page).locator(".numbering-stamp")).toHaveText("1");
  await panel(page).getByRole("button", { name: "Página 1 de N" }).click();
  await expect(firstPage(page).locator(".numbering-stamp")).toHaveText(
    "Página 1 de 5",
  );
  await expect(panel(page).getByRole("status")).toHaveText(
    "Páginas 1 a 5: números 1 a 5.",
  );
  // Below the text of the page, centered.
  const stamp = (await firstPage(page)
    .locator(".numbering-stamp")
    .boundingBox())!;
  const box = (await firstPage(page).boundingBox())!;
  expect(stamp.y).toBeGreaterThan(box.y + box.height * 0.9);
  expect(
    Math.abs(stamp.x + stamp.width / 2 - (box.x + box.width / 2)),
  ).toBeLessThan(3);
  await firstPage(page).locator(".numbering-stamp").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DIR}/numerar-escritorio.png` });

  await panel(page).getByRole("button", { name: "Aplicar" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByText("Numeración aplicada")).toBeVisible();
  await expect(firstPage(page).locator(".numbering-stamp")).toHaveText(
    "Página 1 de 5",
  );

  const { bytes } = await saveAndRead(page);
  for (const n of [1, 3, 5]) {
    const runs = await textRuns(bytes, n);
    const run = runs.find((r) => r.str.startsWith("Página"))!;
    expect(run.str).toBe(`Página ${n} de 5`);
    expect(run.y).toBeLessThan(40);
  }
});

test("Bates with the cover left out, header and footer, undo", async ({
  page,
}) => {
  await open(page, report);
  await page.getByRole("button", { name: "Numerar", exact: true }).click();
  const p = panel(page);
  await p.getByRole("button", { name: "Vaciar" }).click();
  await p.getByRole("button", { name: "Abajo a la derecha" }).click();
  await p.getByRole("button", { name: "Bates" }).click();
  await p.getByLabel("Prefijo Bates").fill("EXP-");
  await p.getByLabel("Desde").fill("2");
  await p.getByLabel("Primer número").fill("120");
  await p.getByRole("button", { name: "Arriba al centro" }).click();
  await p.getByLabel(/^Texto:/).fill("Confidencial · {archivo}");
  await expect(p.getByRole("status")).toHaveText(
    "Páginas 2 a 5: números 120 a 123.",
  );
  await expect(p.getByRole("button", { name: "Arriba al centro" })).toHaveClass(
    "used",
  );
  await expect(firstPage(page).locator(".numbering-stamp")).toHaveCount(0);
  await expect(pageAt(page, 2).locator(".numbering-stamp")).toHaveText([
    "Confidencial · informe",
    "EXP-000120",
  ]);
  await p.getByRole("button", { name: "Aplicar" }).click();
  const bates = pageAt(page, 2).getByText("EXP-000120");
  await bates.scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, 120);
  await expect(pageAt(page, 3)).toHaveAttribute("data-rendered", "true");
  await page.screenshot({ path: `${DIR}/bates-escritorio.png` });

  const { bytes } = await saveAndRead(page);
  expect((await textRuns(bytes, 1)).map((r) => r.str)).not.toContain(
    "EXP-000120",
  );
  const runs = (await textRuns(bytes, 5)).map((r) => r.str);
  expect(runs).toContain("EXP-000123");
  expect(runs).toContain("Confidencial · informe");

  // One undo removes all of it.
  await page.keyboard.press("Control+z");
  await expect(page.locator(".numbering-stamp")).toHaveCount(0);
});

test("a rotated page gets its number at the bottom as shown", async ({
  page,
}) => {
  await open(page, fixture("rotated-page.pdf"));
  await page.getByRole("button", { name: "Numerar", exact: true }).click();
  await panel(page).getByRole("button", { name: "Aplicar" }).click();
  const stamp = (await firstPage(page)
    .locator(".numbering-stamp")
    .boundingBox())!;
  const box = (await firstPage(page).boundingBox())!;
  expect(box.width).toBeGreaterThan(box.height);
  expect(stamp.y).toBeGreaterThan(box.y + box.height * 0.85);
  const { bytes } = await saveAndRead(page);
  const run = (await textRuns(bytes, 1)).find((r) => r.str === "1")!;
  // /Rotate 90: the bottom edge as shown is the high-x side of the page.
  expect(run.x).toBeGreaterThan(540);
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("«Numerar» is in the Edit sheet and fits", async ({ page }) => {
    await open(page, report);
    await page
      .getByRole("navigation", { name: "Categorías de herramientas" })
      .getByRole("button", { name: "Editar" })
      .click();
    await page
      .getByRole("dialog", { name: "Editar" })
      .getByRole("button", { name: "Numerar" })
      .click();
    const p = panel(page);
    await expect(p).toBeVisible();
    const box = (await p.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    for (const control of await p.locator("button, input, select").all())
      if (await control.isVisible())
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
          43.5,
        );
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `${DIR}/numerar-movil.png` });
  });
});
