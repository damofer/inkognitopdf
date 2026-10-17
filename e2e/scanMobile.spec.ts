// Spec 009: the scanner on a phone. Every step fits in one screen, without
// scrolling, with the next action in view. Screenshots of each step go to
// docs/screenshots/scan/.
import { expect, test, type Page } from "@playwright/test";
import { firstPage } from "./helpers";
import { writePhotos, type PhotoFiles } from "./scanPhotos";

const SIZES = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
];

let photos: PhotoFiles;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  photos = await writePhotos({
    // Upright, as a phone takes them.
    "foto-1.jpg": { seed: 901, width: 1800, height: 2400 },
    "foto-2.jpg": {
      seed: 902,
      width: 1800,
      height: 2400,
      background: "texture",
    },
  });
});

const scanner = (page: Page) =>
  page.getByRole("dialog", { name: "Escanear documento" });

/** No page scroll either way, and the scanner's main action in view. */
async function fitsOneScreen(page: Page) {
  const size = await page.evaluate(() => {
    const root = document.scrollingElement!;
    return {
      scrollHeight: root.scrollHeight,
      scrollWidth: root.scrollWidth,
      innerHeight,
      innerWidth,
    };
  });
  expect(size.scrollHeight).toBeLessThanOrEqual(size.innerHeight);
  expect(size.scrollWidth).toBeLessThanOrEqual(size.innerWidth);

  // Nothing of the scanner is below the screen or off its sides (the page
  // strip scrolls sideways inside itself).
  const outside = await scanner(page).evaluate((view) =>
    [...view.querySelectorAll<HTMLElement>("*")]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return false;
        if (box.bottom > innerHeight + 0.5) return true;
        if (el.closest(".scan-strip")) return false;
        return box.left < -0.5 || box.right > innerWidth + 0.5;
      })
      .map((el) => `${el.tagName}.${el.className}`),
  );
  expect(outside).toEqual([]);

  const primary = scanner(page).locator("button.primary:visible");
  await expect(primary).toHaveCount(1);
  const box = (await primary.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(size.innerHeight);
}

/** Every visible control of the scanner is at least 44 × 44 px. */
async function touchTargets(page: Page) {
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        ".scan-view :is(button, select)",
      ),
    ]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          name: el.getAttribute("aria-label") ?? el.textContent,
          width: box.width,
          height: box.height,
        };
      })
      .filter((b) => b.width < 43.5 || b.height < 43.5),
  );
  expect(small).toEqual([]);
}

const shoot = (page: Page, size: { width: number }, name: string) =>
  page.screenshot({
    path: `docs/screenshots/scan/${size.width}-${name}.png`,
  });

async function check(page: Page, size: { width: number }, name: string) {
  // Nothing in progress ("Processing…"): the step as the user ends up seeing it.
  await expect(scanner(page).locator(".scan-status")).toHaveCount(0);
  await fitsOneScreen(page);
  await touchTargets(page);
  await shoot(page, size, name);
}

for (const size of SIZES) {
  test.describe(`${size.width}×${size.height}`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true });

    test("each scan step fits in one screen", async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto("/app/");
      await page.getByRole("button", { name: "Escanear" }).click();
      const view = scanner(page);

      // Empty: two big buttons.
      await expect(
        view.getByRole("button", { name: "Hacer foto" }),
      ).toBeVisible();
      await expect(
        view.getByRole("button", { name: "Elegir imágenes" }),
      ).toBeVisible();
      await check(page, size, "1-vacio");

      // Corners: the whole photo, "Continue" at the bottom.
      await view
        .getByTestId("scan-images")
        .setInputFiles([photos.path("foto-1.jpg"), photos.path("foto-2.jpg")]);
      await expect(view.locator(".crop-hit")).toHaveCount(4);
      await expect(view.locator(".scan-heading")).toContainText(
        "Página 1 de 2",
      );
      const photo = (await view.locator(".crop-editor img").boundingBox())!;
      const main = (await view.locator(".scan-main").boundingBox())!;
      expect(photo.y).toBeGreaterThanOrEqual(main.y);
      expect(photo.y + photo.height).toBeLessThanOrEqual(
        main.y + main.height + 0.5,
      );
      await check(page, size, "2-esquinas");

      // Mode: a row of modes, rotation, adjust and "Continue".
      await view.getByRole("button", { name: "Continuar" }).click();
      const result = view.locator("img.scan-result");
      await expect(result).toHaveAttribute("data-mode", "bw");
      const gray = view.getByRole("button", { name: "Grises", exact: true });
      await gray.click();
      await expect(gray).toHaveAttribute("aria-pressed", "true");
      await expect(result).toHaveAttribute("data-mode", "gray");
      // Spec 030: the straightening animation has given way to the page.
      await expect(view.getByTestId("scan-morph")).toHaveCount(0);
      await check(page, size, "3-filtro");

      // "Continue" goes on to the second photo, then to the pages.
      await view.getByRole("button", { name: "Continuar" }).click();
      await expect(view.locator(".scan-heading")).toContainText(
        "Página 2 de 2",
      );
      await expect(view.locator(".crop-hit")).toHaveCount(4);
      await view.getByRole("button", { name: "Continuar" }).click();
      await expect(result).toHaveAttribute("data-mode", "bw");
      await view.getByRole("button", { name: "Continuar" }).click();
      await expect(view.locator(".scan-heading")).toContainText("2 páginas");
      // Two pages and «Añadir página»; the modes of the shown page (spec 027).
      await expect(view.locator(".scan-thumb")).toHaveCount(3);
      await expect(
        view.getByRole("button", { name: "Añadir página" }),
      ).toBeVisible();
      await expect(
        view.getByRole("button", { name: "Fotocopia", exact: true }),
      ).toBeVisible();
      await check(page, size, "4-paginas");

      // Outside the ID card mode, the mode is the shown page's only: page 2
      // turns to "Original" and page 1 stays in "Grises".
      const original = view.getByRole("button", {
        name: "Original",
        exact: true,
      });
      await original.click();
      await expect(result).toHaveAttribute("data-mode", "original");
      await view.getByRole("button", { name: /^Página 1:/ }).click();
      await expect(result).toHaveAttribute("data-mode", "gray");
      await view.getByRole("button", { name: /^Página 2:/ }).click();
      await expect(original).toHaveAttribute("aria-pressed", "true");

      // «Añadir página»: the live camera, a new photo or the gallery.
      await view.getByRole("button", { name: "Añadir página" }).click();
      const add = view.getByRole("dialog", { name: "Añadir página" });
      for (const name of ["Hacer foto", "Elegir imágenes"])
        expect(
          (await add.getByRole("button", { name }).boundingBox())!.height,
        ).toBeGreaterThanOrEqual(44);
      await check(page, size, "4b-anadir");
      const chooser = page.waitForEvent("filechooser");
      await add.getByRole("button", { name: "Hacer foto" }).click();
      const photoChooser = await chooser;
      expect(photoChooser.isMultiple()).toBe(false);
      expect(await photoChooser.element().getAttribute("capture")).toBe(
        "environment",
      );
      await expect(add).toHaveCount(0);

      // Settings in a sheet.
      await view.getByRole("button", { name: "Ajustes del escáner" }).click();
      const sheet = view.getByRole("dialog", { name: "Ajustes del escáner" });
      await expect(sheet.getByLabel("Detección automática")).toBeChecked();
      await expect(sheet.getByLabel("Tamaño de página")).toBeVisible();
      await expect(sheet.getByLabel("Reconocer texto (OCR)")).not.toBeChecked();
      await check(page, size, "5-ajustes");
      await sheet.getByRole("button", { name: "Cerrar los ajustes" }).click();
      await expect(sheet).toHaveCount(0);

      // Open in the editor: two pages, the help says "tap".
      await view.getByRole("button", { name: "Abrir en el editor" }).click();
      await expect(scanner(page)).toHaveCount(0);
      await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
      await expect(page.locator(".page")).toHaveCount(2);
      await expect(page.locator(".tool-hint")).toContainText("Toca");
      await shoot(page, size, "6-editor");
    });
  });
}

test.describe("settings", () => {
  test.use({
    viewport: SIZES[1],
    hasTouch: true,
    isMobile: true,
  });

  test("are remembered, and pages can be removed and reordered", async ({
    page,
  }) => {
    await page.goto("/app/");
    await page.getByRole("button", { name: "Escanear" }).click();
    let view = scanner(page);
    await view.getByRole("button", { name: "Ajustes del escáner" }).click();
    let sheet = view.getByRole("dialog", { name: "Ajustes del escáner" });
    await sheet.getByLabel("Detección automática").uncheck();
    await sheet.getByLabel("Tamaño de página").selectOption("a4");
    await page.reload();

    await page.getByRole("button", { name: "Escanear" }).click();
    view = scanner(page);
    await view.getByRole("button", { name: "Ajustes del escáner" }).click();
    sheet = view.getByRole("dialog", { name: "Ajustes del escáner" });
    await expect(sheet.getByLabel("Detección automática")).not.toBeChecked();
    await expect(sheet.getByLabel("Tamaño de página")).toHaveValue("a4");
    await sheet.getByRole("button", { name: "Cerrar los ajustes" }).click();

    // Without detection the whole photo is proposed; the detected edges are
    // one tap away.
    await view
      .getByTestId("scan-images")
      .setInputFiles([photos.path("foto-1.jpg"), photos.path("foto-2.jpg")]);
    await expect(view.locator(".crop-hit")).toHaveCount(4);
    await view.getByRole("button", { name: "Bordes detectados" }).click();
    await expect(
      view.getByRole("button", { name: "Imagen completa" }),
    ).toBeVisible();
    const result = view.locator("img.scan-result");
    for (const page of [1, 2]) {
      await expect(view.locator(".scan-heading")).toContainText(
        `Página ${page} de 2`,
      );
      await expect(view.locator(".crop-hit")).toHaveCount(4);
      await view.getByRole("button", { name: "Continuar" }).click();
      await expect(result).toHaveAttribute("data-mode", "bw");
      await view.getByRole("button", { name: "Continuar" }).click();
    }
    await expect(view.locator(".scan-heading")).toContainText("2 páginas");

    const names = () =>
      view
        .locator(".scan-strip .scan-thumb:not(.scan-add)")
        .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    expect(await names()).toEqual([
      "Página 1: foto-1.jpg",
      "Página 2: foto-2.jpg",
    ]);
    await view.getByRole("button", { name: "Página 2: foto-2.jpg" }).click();
    await view.getByRole("button", { name: "Mover la página 2 antes" }).click();
    expect(await names()).toEqual([
      "Página 1: foto-2.jpg",
      "Página 2: foto-1.jpg",
    ]);
    await view.getByRole("button", { name: "Quitar la página 1" }).click();
    await expect(view.locator(".scan-heading")).toContainText("1 página");

    // "Add page" goes back to the corners of the new photo.
    await view.getByRole("button", { name: "Añadir página" }).click();
    const chooser = page.waitForEvent("filechooser");
    await view
      .getByRole("dialog", { name: "Añadir página" })
      .getByRole("button", { name: "Elegir imágenes" })
      .click();
    expect((await chooser).isMultiple()).toBe(true);
    await (await chooser).setFiles(photos.path("foto-2.jpg"));
    await expect(view.locator(".crop-hit")).toHaveCount(4);
    await expect(view.locator(".scan-heading")).toContainText("Página 2 de 2");
  });
});
