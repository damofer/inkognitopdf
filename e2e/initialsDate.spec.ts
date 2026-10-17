// Spec 019: the date under the signature in the same step, and the initials
// on every page at once. Screenshots go to docs/screenshots/initials-date/.
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { openFixture, saveAndRead, textRuns } from "./helpers";

const DIR = "docs/screenshots/initials-date";
const panel = (page: Page) => page.getByRole("dialog", { name: "Firmar" });
const pageN = (page: Page, n: number) =>
  page.locator(`.page[data-page-number="${n}"]`);

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/** Typed signature and initials. */
async function adopt(page: Page) {
  await panel(page).getByRole("button", { name: "Crear" }).first().click();
  await page.getByRole("tab", { name: "Escribir" }).click();
  await page.getByRole("dialog").getByRole("textbox").first().fill("Ana Pérez");
  await page.getByRole("button", { name: "Usar" }).click();
  await panel(page).getByRole("button", { name: "Crear", exact: true }).click();
  await page.getByRole("tab", { name: "Escribir" }).click();
  await page.getByRole("textbox", { name: "Iniciales" }).fill("AP");
  await page.getByRole("button", { name: "Usar" }).click();
}

test("the date goes under the signature, and initials on every page", async ({
  page,
}) => {
  await openFixture(page, "two-pages.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  await adopt(page);

  const autoDate = panel(page).getByRole("checkbox", {
    name: "Poner la fecha bajo la firma",
  });
  await expect(autoDate).not.toBeChecked();
  await autoDate.check();
  await panel(page).getByRole("button", { name: "Colocar firma" }).click();
  const box = (await pageN(page, 1).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await expect(pageN(page, 1).locator(".item-signature")).toHaveCount(1);
  const date = pageN(page, 1).locator(".item-text");
  await expect(date).toHaveText(today());
  // Under the signature, and both undone in one step.
  const sig = (await pageN(page, 1).locator(".item-signature").boundingBox())!;
  const at = (await date.boundingBox())!;
  expect(at.y).toBeGreaterThan(sig.y + sig.height - 2);
  expect(Math.abs(at.x - sig.x)).toBeLessThan(4);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(
    pageN(page, 1).locator(".item-signature, .item-text"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(pageN(page, 1).locator(".item-signature")).toHaveCount(1);

  // Initials on both pages, once.
  await panel(page)
    .getByRole("button", { name: "En todas las páginas" })
    .click();
  await expect(page.getByTestId("toast")).toHaveText(
    "Iniciales puestas en 2 páginas.",
  );
  await expect(pageN(page, 1).locator(".item-signature")).toHaveCount(2);
  await expect(pageN(page, 2).locator(".item-signature")).toHaveCount(1);
  await page.screenshot({ path: `${DIR}/iniciales-y-fecha-escritorio.png` });
  await panel(page)
    .getByRole("button", { name: "En todas las páginas" })
    .click();
  await expect(page.getByTestId("toast")).toHaveText(
    "Todas las páginas ya tenían iniciales.",
  );
  await expect(pageN(page, 2).locator(".item-signature")).toHaveCount(1);

  // The choice is remembered.
  await panel(page).getByRole("button", { name: "Cerrar firma" }).click();
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  await expect(autoDate).toBeChecked();

  const saved = await saveAndRead(page);
  expect(
    (await textRuns(saved.bytes, 1)).map((r) => r.str).join(" "),
  ).toContain(today());
  const doc = await PDFDocument.load(saved.bytes);
  const sigs = (n: number) =>
    doc.getPage(n).node.Resources()!.toString().match(/\/Sig/g)?.length ?? 0;
  expect(sigs(0)).toBe(2);
  expect(sigs(1)).toBe(1);
});

test("a one-page document has no «every page» button", async ({ page }) => {
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  await expect(
    panel(page).getByRole("button", { name: "En todas las páginas" }),
  ).toHaveCount(0);
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the new options fit in the signing panel", async ({ page }) => {
    await openFixture(page, "two-pages.pdf");
    await page
      .getByRole("navigation", { name: "Categorías de herramientas" })
      .getByRole("button", { name: "Firmar" })
      .click();
    await adopt(page);
    const every = panel(page).getByRole("button", {
      name: "En todas las páginas",
    });
    const auto = panel(page).locator("label", {
      hasText: "Poner la fecha bajo la firma",
    });
    for (const control of [every, auto]) {
      const b = (await control.boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(390);
      expect(b.height).toBeGreaterThanOrEqual(43.5);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `${DIR}/panel-movil.png` });
    await every.click();
    await expect(pageN(page, 2).locator(".item-signature")).toHaveCount(1);
  });
});
