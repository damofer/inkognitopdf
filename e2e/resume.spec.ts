// Spec 028: the work not saved when the app is closed is offered on return,
// with a mouse and on a phone.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { firstPage, openFixture, saveAndRead } from "./helpers";

/** Adds a text to the first page with the Texto tool. */
async function addText(page: Page, touch: boolean, text: string) {
  if (touch) {
    await page
      .getByRole("navigation", { name: "Categorías de herramientas" })
      .getByRole("button", { name: "Editar" })
      .click();
    await page
      .getByRole("dialog", { name: "Editar" })
      .getByRole("button", { name: "Texto", exact: true })
      .click();
  } else {
    await page
      .getByRole("group", { name: /^Herramientas de/ })
      .getByRole("button", { name: "Texto", exact: true })
      .click();
  }
  const b = (await firstPage(page).boundingBox())!;
  const x = b.x + b.width * 0.3;
  const y = b.y + b.height * 0.45;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await page.locator(".text-draft").fill(text);
  if (touch) await page.getByRole("button", { name: "Aceptar" }).click();
  else await page.locator(".text-draft").press("Control+Enter");
  await expect(firstPage(page).locator(".item-text")).toHaveCount(1);
}

/** Closes the app after the automatic save and opens it again. */
async function reopen(page: Page, context: BrowserContext) {
  await page.waitForTimeout(1500);
  await page.close();
  const again = await context.newPage();
  await again.goto("/app/");
  await expect(
    again.getByRole("button", { name: "Abrir PDF" }).first(),
  ).toBeVisible();
  return again;
}

const offer = (page: Page) =>
  page.getByRole("region", { name: "Tienes trabajo sin guardar" });

for (const device of [
  { name: "escritorio", touch: false },
  { name: "móvil", touch: true },
]) {
  test.describe(device.name, () => {
    if (device.touch)
      test.use({
        viewport: { width: 412, height: 915 },
        isMobile: true,
        hasTouch: true,
      });

    test("CA-1: se retoma el PDF con sus cambios", async ({
      page,
      context,
    }) => {
      await openFixture(page, "simple-text.pdf");
      await addText(page, device.touch, "Sin guardar");
      const again = await reopen(page, context);
      await expect(offer(again)).toContainText("simple-text.pdf");
      await again.getByRole("button", { name: "Retomar" }).click();
      await expect(firstPage(again)).toHaveAttribute("data-rendered", "true");
      await expect(firstPage(again).locator(".item-text")).toContainText(
        "Sin guardar",
      );
      await expect(again.locator(".file-name")).toHaveText("simple-text.pdf");
    });

    test("CA-2: descartar no vuelve a ofrecerlo", async ({ page, context }) => {
      await openFixture(page, "simple-text.pdf");
      await addText(page, device.touch, "Sin guardar");
      const again = await reopen(page, context);
      await again.getByRole("button", { name: "Descartar" }).click();
      await expect(offer(again)).toHaveCount(0);
      const third = await reopen(again, context);
      await expect(offer(third)).toHaveCount(0);
    });
  });
}

test("CA-1: lo retomado sigue sin guardar tras cerrar otra vez", async ({
  page,
  context,
}) => {
  await openFixture(page, "simple-text.pdf");
  await addText(page, false, "Sin guardar");
  const again = await reopen(page, context);
  await again.getByRole("button", { name: "Retomar" }).click();
  await expect(firstPage(again).locator(".item-text")).toHaveCount(1);
  const third = await reopen(again, context);
  await expect(offer(third)).toBeVisible();
});

test("CA-3: tras guardar el PDF no se ofrece", async ({ page, context }) => {
  await openFixture(page, "simple-text.pdf");
  await addText(page, false, "Guardado");
  await saveAndRead(page);
  const again = await reopen(page, context);
  await expect(offer(again)).toHaveCount(0);
});

test("CA-4: un PDF abierto sin cambios no se ofrece", async ({
  page,
  context,
}) => {
  await openFixture(page, "simple-text.pdf");
  const again = await reopen(page, context);
  await expect(offer(again)).toHaveCount(0);
});

test("CA-4: deshacer todos los cambios lo borra", async ({ page, context }) => {
  await openFixture(page, "simple-text.pdf");
  await addText(page, false, "Deshecho");
  await page.waitForTimeout(1500);
  await page.keyboard.press("Control+z");
  await expect(firstPage(page).locator(".item-text")).toHaveCount(0);
  const again = await reopen(page, context);
  await expect(offer(again)).toHaveCount(0);
});

test("CA-5: un documento en blanco se retoma", async ({ page, context }) => {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Documento en blanco" }).click();
  await expect(firstPage(page)).toBeVisible();
  await addText(page, false, "En blanco");
  const again = await reopen(page, context);
  await expect(offer(again)).toContainText("Documento nuevo");
  await again.getByRole("button", { name: "Retomar" }).click();
  await expect(firstPage(again).locator(".item-text")).toContainText(
    "En blanco",
  );
});
