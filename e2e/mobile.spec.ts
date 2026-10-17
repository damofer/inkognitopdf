// Spec 007: phone layout at 360×800 and 390×844. Screenshots of each step
// are written to test-results/mobile/ for review.
import { expect, test, type Page } from "@playwright/test";
import { firstPage, openFixture, saveAndRead } from "./helpers";

const SIZES = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
];

async function noHorizontalScroll(page: Page) {
  const [scrollWidth, width] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scrollWidth).toBeLessThanOrEqual(width);
}

/** Every visible control of the bars, menus and sheets is at least 44 px. */
async function touchTargets(page: Page) {
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        ".app-header button, .app-header .open-button, .viewer-toolbar button, " +
          ".mobile-options :is(button, select, input), .mobile-bar button, .mobile-sheet button",
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

const shot = (page: Page, size: { width: number }, name: string) =>
  page.screenshot({ path: `test-results/mobile/${size.width}-${name}.png` });

for (const size of SIZES) {
  test.describe(`${size.width}×${size.height}`, () => {
    test.use({ viewport: size, hasTouch: true, isMobile: true });

    test("start screen: compact top bar and big actions", async ({ page }) => {
      await page.goto("/app/");
      await expect(
        page.getByRole("button", { name: "Abrir PDF", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Escanear" }),
      ).toBeVisible();
      await noHorizontalScroll(page);
      await shot(page, size, "start");

      // The overflow menu holds the header actions and the language.
      await page.getByRole("button", { name: "Menú" }).click();
      const menu = page.locator("#app-menu");
      await expect(menu.getByText("Documento en blanco")).toBeVisible();
      await expect(menu.getByRole("button", { name: "English" })).toBeVisible();
      await touchTargets(page);
      await shot(page, size, "menu");
      // The language changes in place; the menu stays open until closed.
      await menu.getByRole("button", { name: "English" }).click();
      await expect(menu.getByText("Blank document")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Open PDF", exact: true }),
      ).toBeVisible();
    });

    test("document: page fits the width, tools by category", async ({
      page,
    }) => {
      await openFixture(page, "forms-annotations.pdf");
      const box = (await firstPage(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      await noHorizontalScroll(page);
      await touchTargets(page);

      // The help is one line until tapped.
      const hint = page.getByRole("note");
      const collapsed = (await hint.boundingBox())!.height;
      expect(collapsed).toBeLessThan(40);
      await hint.click();
      expect((await hint.boundingBox())!.height).toBeGreaterThan(collapsed);
      await shot(page, size, "document");

      // The desktop tool row is replaced by the bottom bar.
      await expect(
        page.getByRole("group", { name: "Herramientas de edición" }),
      ).toHaveCount(0);
      const bar = page.getByRole("navigation", {
        name: "Categorías de herramientas",
      });
      for (const name of ["Editar", "Anotar", "Firmar", "Páginas", "Más"])
        await expect(bar.getByRole("button", { name })).toBeVisible();

      await bar.getByRole("button", { name: "Anotar" }).click();
      const sheet = page.getByRole("dialog", { name: "Anotar" });
      await expect(sheet.getByRole("button", { name: "Flecha" })).toBeVisible();
      await touchTargets(page);
      await noHorizontalScroll(page);
      await shot(page, size, "sheet-annotate");
      await sheet.getByRole("button", { name: "Dibujar" }).click();
      await expect(sheet).toBeHidden();
      await expect(bar.getByRole("button", { name: "Anotar" })).toHaveClass(
        /active/,
      );

      // The tool's options sit in one row that scrolls by itself.
      const options = page.locator(".mobile-options");
      await expect(options.getByLabel("Color del trazo")).toBeVisible();
      await noHorizontalScroll(page);
      await shot(page, size, "options");

      // Signing opens as a sheet from the bottom.
      await bar.getByRole("button", { name: "Firmar" }).click();
      const panel = page.getByRole("dialog", { name: "Firmar" });
      await expect(panel).toBeVisible();
      const panelBox = (await panel.boundingBox())!;
      expect(panelBox.x).toBe(0);
      expect(Math.round(panelBox.width)).toBe(size.width);
      await noHorizontalScroll(page);
      await shot(page, size, "sign");
      // The panel covers the bar; it has its own close button.
      await panel.getByRole("button", { name: "Cerrar firma" }).click();
      await expect(panel).toBeHidden();

      // Pages strip, from the pages sheet.
      await bar.getByRole("button", { name: "Páginas" }).click();
      await page
        .getByRole("dialog", { name: "Páginas" })
        .getByRole("button", { name: "Miniaturas" })
        .click();
      await expect(page.locator(".thumbnails")).toBeVisible();
      await noHorizontalScroll(page);
      await shot(page, size, "pages");

      // Saving still works from the compact toolbar.
      const { bytes } = await saveAndRead(page);
      expect(bytes.length).toBeGreaterThan(1000);
    });

    test("pinch zoom changes the zoom and keeps the page scrollable", async ({
      page,
    }) => {
      await openFixture(page, "simple-text.pdf");
      const zoom = page
        .getByRole("status", { name: "Zoom" })
        .or(page.locator(".zoom-value"));
      const before = await zoom.textContent();
      const pages = page.locator(".pages");
      const box = (await pages.boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + 200;
      const cdp = await page.context().newCDPSession(page);
      const touch = (
        type: "touchStart" | "touchMove" | "touchEnd",
        d: number,
      ) =>
        cdp.send("Input.dispatchTouchEvent", {
          type,
          touchPoints:
            type === "touchEnd"
              ? []
              : [
                  { x: cx - d, y: cy, id: 1 },
                  { x: cx + d, y: cy, id: 2 },
                ],
        });
      await touch("touchStart", 40);
      for (let d = 50; d <= 120; d += 10) await touch("touchMove", d);
      await touch("touchEnd", 0);
      await expect(zoom).not.toHaveText(before!);
      await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
      // A zoomed page can be scrolled to its left edge.
      await pages.evaluate((el) => (el.scrollLeft = 0));
      const left = (await firstPage(page).boundingBox())!.x;
      expect(left).toBeGreaterThanOrEqual(0);
      await shot(page, size, "pinch");
    });
  });
}
