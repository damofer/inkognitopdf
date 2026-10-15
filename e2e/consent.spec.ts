// Spec 011: the measurement question is asked once per browser, shared by
// the landing and the app, and reads well on phones. Screenshots go to
// docs/screenshots/consent/ (the "before" ones were taken from the live site).
import { expect, test, type Page } from "@playwright/test";

// No answer yet (the config answers it for the other tests).
test.use({ storageState: { cookies: [], origins: [] } });

const DIR = "docs/screenshots/consent";
const landingNotice = (page: Page) => page.locator("[data-consent-notice]");
const appNotice = (page: Page) => page.getByTestId("consent");

for (const [choice, stored] of [
  ["Aceptar", "granted"],
  ["Rechazar", "denied"],
] as const)
  test(`«${choice}» is remembered on reloads, in the landing and the app`, async ({
    page,
  }) => {
    await page.goto("/");
    await expect(landingNotice(page)).toBeVisible();
    await landingNotice(page).getByRole("button", { name: choice }).click();
    await expect(landingNotice(page)).toBeHidden();
    expect(
      await page.evaluate(() => localStorage.getItem("inkognito.analytics")),
    ).toBe(stored);

    await page.reload();
    await expect(page.locator("#analytics")).toBeAttached();
    await expect(landingNotice(page)).toBeHidden();
    await page.goto("/app/");
    await expect(page.getByTestId("open-pdf")).toBeAttached();
    await expect(appNotice(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("open-pdf")).toBeAttached();
    await expect(appNotice(page)).toHaveCount(0);
    await page.goto("/");
    await expect(landingNotice(page)).toBeHidden();
  });

test("answered in the app, the landing does not ask again", async ({
  page,
}) => {
  await page.goto("/app/");
  await appNotice(page).getByRole("button", { name: "Rechazar" }).click();
  await expect(appNotice(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("open-pdf")).toBeAttached();
  await expect(appNotice(page)).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator("#analytics")).toBeAttached();
  await expect(landingNotice(page)).toBeHidden();
  // The choice can still be changed from «Privacidad».
  await page.goto("/app/");
  await page.getByRole("button", { name: "Privacidad" }).click();
  await expect(appNotice(page)).toBeVisible();
});

/** The header lets nothing show through. */
async function opaque(page: Page, selector: string) {
  const color = await page
    .locator(selector)
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  // rgb(…) is opaque; rgba(…, a) with a < 1 is not.
  expect(color, selector).toMatch(/^rgb\(/);
}

for (const size of [
  { width: 360, height: 800 },
  { width: 412, height: 915 },
])
  test.describe(`phone ${size.width}×${size.height}`, () => {
    test.use({
      viewport: size,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });

    for (const lang of ["es", "en"] as const)
      test(`the notice reads whole, in one bar (${lang})`, async ({ page }) => {
        await page.addInitScript(
          (l) => localStorage.setItem("inkognitopdf.lang", l),
          lang,
        );
        for (const [path, notice, header] of [
          ["/", landingNotice, ".site-header"],
          ["/app/", appNotice, ".app-header"],
        ] as const) {
          await page.goto(path);
          const box = notice(page);
          await expect(box).toBeVisible();
          await expect(box.locator(".consent-short")).toBeVisible();
          await expect(box.locator(".consent-long")).toBeHidden();
          const rect = (await box.boundingBox())!;
          expect(rect.x).toBeGreaterThanOrEqual(0);
          expect(rect.x + rect.width).toBeLessThanOrEqual(size.width + 0.5);
          expect(rect.y).toBeGreaterThan(size.height / 2);
          expect(rect.y + rect.height).toBeLessThanOrEqual(size.height + 0.5);
          // Both buttons on one row, 44 px tall.
          const buttons = await box.getByRole("button").all();
          const boxes = await Promise.all(buttons.map((b) => b.boundingBox()));
          expect(boxes).toHaveLength(2);
          expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(1);
          for (const b of boxes) expect(b!.height).toBeGreaterThanOrEqual(43.5);
          await opaque(page, header);
          if (path === "/") await page.mouse.wheel(0, 700);
          await page.waitForTimeout(300);
          await page.screenshot({
            path: `${DIR}/after-${size.width}-${path === "/" ? "landing" : "app"}-${lang}.png`,
          });
        }
      });
  });
