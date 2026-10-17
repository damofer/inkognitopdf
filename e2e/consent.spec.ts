// Spec 011: the measurement question is asked once per browser, shared by
// the landing and the app, and reads well on phones. Screenshots go to
// docs/screenshots/consent/ (the "before" ones were taken from the live site).
import { expect, test, type Page } from "@playwright/test";
import { openMenu } from "./helpers";

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
  await openMenu(page);
  await page.getByRole("button", { name: "Privacidad" }).click();
  await expect(appNotice(page)).toBeVisible();
});

/**
 * The text scrolling behind the header can't be read: the app's header is
 * opaque; the landing's is translucent with a strong blur.
 */
async function hidesWhatScrolls(page: Page, selector: string) {
  const style = await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const css = getComputedStyle(el);
      return { color: css.backgroundColor, filter: css.backdropFilter };
    });
  if (selector === ".app-header") {
    // rgb(…) is opaque; rgba(…, a) with a < 1 is not.
    expect(style.color, selector).toMatch(/^rgb\(/);
    return;
  }
  const alpha = Number(style.color.match(/rgba\(.*,\s*([\d.]+)\)/)?.[1]);
  expect(alpha, selector).toBeGreaterThanOrEqual(0.7);
  expect(alpha, selector).toBeLessThan(1);
  const blur = Number(style.filter.match(/blur\(([\d.]+)px\)/)?.[1]);
  expect(blur, selector).toBeGreaterThanOrEqual(16);
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
          await hidesWhatScrolls(page, header);
          if (path === "/") await page.mouse.wheel(0, 700);
          await page.waitForTimeout(300);
          await page.screenshot({
            path: `${DIR}/after-${size.width}-${path === "/" ? "landing" : "app"}-${lang}.png`,
          });
        }
      });
  });

test.describe("phone 412×915, landing header", () => {
  test.use({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  test("text scrolling behind it is blurred out", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#analytics")).toBeAttached();
    // Put a heading and its text right behind the header.
    await page.evaluate(() => {
      const heading = document.querySelector("#analytics h3")!;
      const top = heading.getBoundingClientRect().top + scrollY - 20;
      scrollTo({ top, behavior: "instant" });
    });
    await page.waitForTimeout(300);
    await hidesWhatScrolls(page, ".site-header");
    await page.screenshot({ path: `${DIR}/header-412-landing.png` });
  });
});
