// Spec 034: the document's name in the header is renamed with a click; the
// ".pdf" stays and the files saved or shared take the new name. Screenshots
// go to docs/screenshots/rename/.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { firstPage, openFixture, saveAndRead } from "./helpers";

const DIR = "docs/screenshots/rename";

const nameButton = (page: Page) =>
  page.getByTitle("Haz clic para cambiar el nombre");
const nameField = (page: Page) =>
  page.getByRole("textbox", { name: "Nombre del documento, sin «.pdf»" });

async function rename(page: Page, typed: string, key = "Enter") {
  await nameButton(page).click();
  await nameField(page).fill(typed);
  await nameField(page).press(key);
}

/** navigator.share as a phone has it. */
async function fakeShare(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __shared: string[] };
    w.__shared = [];
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { files: File[] }) => {
        w.__shared.push(data.files[0]!.name);
      },
    });
  });
}
const shared = (page: Page) =>
  page.evaluate(() => (window as unknown as { __shared: string[] }).__shared);

test("CA-1: clicking the name edits it with .pdf fixed, and saving uses it", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await expect(nameButton(page)).toHaveText("simple-text.pdf");
  await nameButton(page).click();
  await expect(nameField(page)).toBeFocused();
  await expect(nameField(page)).toHaveValue("simple-text");
  await expect(page.locator(".file-name .file-ext")).toHaveText(".pdf");
  await nameField(page).fill("Contrato de arriendo");
  await page.screenshot({ path: `${DIR}/editando-escritorio.png` });
  await nameField(page).press("Enter");
  await expect(nameField(page)).toHaveCount(0);
  await expect(nameButton(page)).toHaveText("Contrato de arriendo.pdf");
  await page.screenshot({ path: `${DIR}/renombrado-escritorio.png` });
  const { name } = await saveAndRead(page);
  expect(name).toBe("Contrato de arriendo.pdf");
});

test("dark theme: the field keeps the header's look", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openFixture(page, "simple-text.pdf");
  await nameButton(page).hover();
  await page.screenshot({ path: `${DIR}/hover-oscuro.png` });
  await nameButton(page).click();
  await page.screenshot({ path: `${DIR}/editando-oscuro.png` });
});

test("CA-2: a typed .pdf and characters files can't have are dropped", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await rename(page, "factura: 2026/10.pdf");
  await expect(nameButton(page)).toHaveText("factura 202610.pdf");
});

test("CA-3: Esc and an empty name keep the name as it was", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await rename(page, "Otro nombre", "Escape");
  await expect(nameButton(page)).toHaveText("simple-text.pdf");
  await rename(page, "   ");
  await expect(nameButton(page)).toHaveText("simple-text.pdf");
  // Unchanged, the saved copy keeps its «(editado)».
  expect((await saveAndRead(page)).name).toBe("simple-text (editado).pdf");
});

test("CA-3: clicking elsewhere keeps what was typed", async ({ page }) => {
  await openFixture(page, "simple-text.pdf");
  await nameButton(page).click();
  await nameField(page).fill("Acta");
  await firstPage(page).click({ position: { x: 5, y: 5 } });
  await expect(nameButton(page)).toHaveText("Acta.pdf");
});

test("CA-4: sharing uses the new name", async ({ page }) => {
  await fakeShare(page);
  await openFixture(page, "simple-text.pdf");
  await rename(page, "Acta");
  await page.getByRole("button", { name: "Compartir", exact: true }).click();
  await expect.poll(() => shared(page)).toEqual(["Acta.pdf"]);
});

test.describe("móvil", () => {
  test.use({
    viewport: { width: 412, height: 915 },
    isMobile: true,
    hasTouch: true,
  });

  test("CA-1: tapping the name edits it and sharing uses it", async ({
    page,
  }) => {
    await fakeShare(page);
    await openFixture(page, "simple-text.pdf");
    await nameButton(page).tap();
    await expect(nameField(page)).toHaveValue("simple-text");
    await nameField(page).fill("Recibo de luz");
    await page.screenshot({ path: `${DIR}/editando-movil.png` });
    await nameField(page).press("Enter");
    await expect(nameButton(page)).toHaveText("Recibo de luz.pdf");
    await page.screenshot({ path: `${DIR}/renombrado-movil.png` });
    await page.getByRole("button", { name: "Compartir", exact: true }).tap();
    await expect.poll(() => shared(page)).toEqual(["Recibo de luz.pdf"]);
  });
});

test("CA-5: work resumed keeps the name given", async ({ page, context }) => {
  await openFixture(page, "simple-text.pdf");
  await rename(page, "Contrato");
  await page
    .getByRole("button", { name: /^Girar a la derecha/ })
    .first()
    .click();
  const again = await reopen(page, context);
  await expect(
    again.getByRole("region", { name: "Tienes trabajo sin guardar" }),
  ).toContainText("Contrato.pdf");
  await again.getByRole("button", { name: "Retomar" }).click();
  await expect(firstPage(again)).toHaveAttribute("data-rendered", "true");
  await expect(nameButton(again)).toHaveText("Contrato.pdf");
});

async function reopen(page: Page, context: BrowserContext) {
  await page.waitForTimeout(1500);
  await page.close();
  const again = await context.newPage();
  await again.goto("/app/");
  return again;
}
