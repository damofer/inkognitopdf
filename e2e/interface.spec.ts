// Spec 025: tasks, one menu, one docked panel, signing in two steps and the
// theme chosen in the menu.
import { expect, test } from "@playwright/test";
import { fixture, openFixture } from "./helpers";

const tools = (page: import("@playwright/test").Page) =>
  page.getByRole("group", { name: /^Herramientas de/ });

test("CA-1: each task shows only its tools", async ({ page }) => {
  await openFixture(page, "two-pages.pdf");
  await expect(tools(page).getByRole("button")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Resaltar" })).toHaveCount(0);
  await page.getByRole("button", { name: "Anotar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resaltar" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Texto", exact: true }),
  ).toHaveCount(0);
});

test("CA-2: one panel at a time, docked at the right of the pages", async ({
  page,
}) => {
  await openFixture(page, "two-pages.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  const sign = page.getByRole("dialog", { name: "Firmar" });
  await expect(sign).toBeVisible();
  await expect(page.locator(".dock")).toContainText("Firmar");
  const pages = await page.locator(".pages").boundingBox();
  const dock = await page.locator(".dock").boundingBox();
  expect(pages!.x + pages!.width).toBeLessThanOrEqual(dock!.x + 1);

  await page.getByRole("button", { name: "Revisar", exact: true }).click();
  await page.getByRole("button", { name: "OCR", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Reconocer texto" }),
  ).toBeVisible();
  await expect(sign).toHaveCount(0);
});

test("CA-3: opening, language and theme are in the «⋯» menu", async ({
  page,
}) => {
  await page.goto("/app/");
  await expect(page.getByRole("link", { name: "Código fuente" })).toBeHidden();
  await page.getByRole("button", { name: "Menú" }).click();
  const menu = page.locator("#app-menu");
  for (const name of [
    "Abrir PDF",
    "Escanear",
    "Plantillas",
    "Privacidad",
    "Apoyar",
  ])
    await expect(menu.getByText(name, { exact: true })).toBeVisible();
  await expect(menu.getByRole("group", { name: "Idioma" })).toBeVisible();
  await expect(menu.getByRole("group", { name: "Tema" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  // The file input works with the menu closed.
  await page.getByTestId("open-pdf").setInputFiles(fixture("two-pages.pdf"));
  await expect(page.locator(".page").first()).toBeVisible();
});

test("CA-4: the theme is chosen in the menu and remembered", async ({
  page,
}) => {
  await page.goto("/app/");
  const theme = () =>
    page.evaluate(() => document.documentElement.dataset.theme ?? null);
  await page.getByRole("button", { name: "Menú" }).click();
  await page.getByRole("button", { name: "Oscuro" }).click();
  expect(await theme()).toBe("dark");
  const bg = await page.evaluate(
    () => getComputedStyle(document.body).backgroundColor,
  );
  expect(bg).toBe("rgb(24, 27, 33)");
  await page.reload();
  expect(await theme()).toBe("dark");
  await page.getByRole("button", { name: "Menú" }).click();
  await page.getByRole("button", { name: "Sistema" }).click();
  expect(await theme()).toBeNull();
});

test("CA-5: signing in two steps", async ({ page }) => {
  await openFixture(page, "two-pages.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  const sign = page.getByRole("dialog", { name: "Firmar" });
  await expect(
    sign.getByRole("button", { name: "Colocar firma" }),
  ).toBeVisible();
  await expect(
    sign.getByRole("button", { name: "Guardar firmado" }),
  ).toHaveCount(0);
  await sign
    .getByRole("button", { name: "Siguiente: firmar y guardar" })
    .click();
  await expect(
    sign.getByRole("button", { name: "Guardar firmado" }),
  ).toBeVisible();
  await sign.getByRole("button", { name: "Volver a colocar" }).click();
  await expect(
    sign.getByRole("button", { name: "Colocar firma" }),
  ).toBeVisible();
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("CA-6: Edit has its six tools; More has review, protection and forms", async ({
    page,
  }) => {
    await openFixture(page, "two-pages.pdf");
    const bar = page.getByRole("navigation", {
      name: "Categorías de herramientas",
    });
    await expect(bar.getByRole("button")).toHaveText([
      "Editar",
      "Anotar",
      "Firmar",
      "Páginas",
      "Más",
    ]);
    await bar.getByRole("button", { name: "Editar" }).click();
    await expect(page.locator(".mobile-sheet .sheet-item")).toHaveCount(6);
    await page.getByRole("button", { name: "Cerrar" }).click();
    await bar.getByRole("button", { name: "Más" }).click();
    const sheet = page.getByRole("dialog", { name: "Más" });
    for (const name of [
      "Radiografía",
      "Comparar",
      "Reconocer texto (OCR)",
      "Contraseña",
      "Comprimir",
      "Campos",
    ])
      await expect(sheet.getByRole("button", { name })).toBeVisible();
  });
});
