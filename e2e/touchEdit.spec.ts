// On a phone, «Editar texto» acts on a tap: a finger dragging over the text
// scrolls the page and opens nothing.
import { expect, test, type Page } from "@playwright/test";
import { firstPage, openFixture } from "./helpers";

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

/** A finger swipe from (x, y), sent as the touch screen would send it. */
async function swipe(page: Page, x: number, y: number, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", at = y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y: at, id: 1 }],
    });
  await touch("touchStart");
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", y + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  await touch("touchEnd");
}

test("a swipe in Editar texto scrolls; a tap opens the text", async ({
  page,
}) => {
  await openFixture(page, "many-pages.pdf");
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByRole("button", { name: "Editar texto", exact: true }).click();
  const pages = page.locator(".pages");
  const textbox = page.getByRole("textbox", { name: "Texto", exact: true });

  // A line of text of the first page.
  const line = page.locator('.page[data-page-number="1"] .textLayer span');
  await expect(line.first()).toBeAttached();
  const at = (await line.first().boundingBox())!;
  const x = at.x + Math.min(at.width / 2, 30);
  const y = at.y + at.height / 2;

  const top = await pages.evaluate((el) => el.scrollTop);
  await swipe(page, x, y, -300);
  await expect
    .poll(() => pages.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(top + 100);
  await expect(textbox).toHaveCount(0);

  // Back up, and a tap on the same line opens it.
  await pages.evaluate((el) => (el.scrollTop = 0));
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  const again = (await line.first().boundingBox())!;
  await page.touchscreen.tap(
    again.x + Math.min(again.width / 2, 30),
    again.y + again.height / 2,
  );
  await expect(textbox).toBeVisible();
  await expect(textbox).not.toHaveValue("");
});
