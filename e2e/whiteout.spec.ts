// Spec 001, CA6: a whiteout covers the page in the editor as it will in the
// saved file (its white box is visible, not only present), on a desktop and
// on a phone; edited text keeps showing through its transparent hit area.
// Screenshots in docs/screenshots/whiteout/.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { firstPage, openFixture } from "./helpers";

const DIR = "docs/screenshots/whiteout";

type Box = { x: number; y: number; width: number; height: number };

/** Share of dark pixels (any channel < 128) in an area of the screen. */
async function darkShare(page: Page, box: Box) {
  const png = await page.screenshot({ clip: box });
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4)
    if (Math.min(data[i]!, data[i + 1]!, data[i + 2]!) < 128) dark++;
  return dark / (data.length / 4);
}

/** The box of a text run, grown a little, in page coordinates. */
async function around(line: Locator, pad = 4): Promise<Box> {
  const b = (await line.boundingBox())!;
  return {
    x: b.x - pad,
    y: b.y - pad,
    width: b.width + 2 * pad,
    height: b.height + 2 * pad,
  };
}

async function drag(page: Page, box: Box) {
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 4,
  });
  await page.mouse.move(box.x + box.width, box.y + box.height, { steps: 4 });
  await page.mouse.up();
}

/** Inside a box, away from its edges (the selection outline). */
const inset = (b: Box, by = 4): Box => ({
  x: b.x + by,
  y: b.y + by,
  width: b.width - 2 * by,
  height: b.height - 2 * by,
});

async function checkWhiteout(page: Page, name: string) {
  const line = firstPage(page).locator(".textLayer span", {
    hasText: "El rapido zorro",
  });
  const area = await around(line);
  // Before: the text is there to be covered.
  expect(await darkShare(page, inset(area, 2))).toBeGreaterThan(0.02);

  await drag(page, area);
  const whiteout = firstPage(page).locator(".item-whiteout");
  await expect(whiteout).toHaveCount(1);
  await expect(whiteout).toHaveCSS("background-color", "rgb(255, 255, 255)");
  // After: the text no longer shows through it, also once it is not selected.
  const box = (await whiteout.boundingBox())!;
  expect(await darkShare(page, inset(box))).toBe(0);
  await page.keyboard.press("Escape");
  await firstPage(page).click({ position: { x: 5, y: 5 } });
  expect(await darkShare(page, inset(box))).toBe(0);
  await page.screenshot({ path: `${DIR}/blanqueo-${name}.png` });
}

test("the whiteout is visible in the editor", async ({ page }) => {
  await openFixture(page, "simple-text.pdf");
  await page
    .getByRole("group", { name: "Herramientas de edición" })
    .getByRole("button", { name: "Blanqueo", exact: true })
    .click();
  await checkWhiteout(page, "escritorio");
});

test("an edited text still shows: its hit area stays transparent", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await page
    .getByRole("group", { name: "Herramientas de edición" })
    .getByRole("button", { name: "Editar texto", exact: true })
    .click();
  const title = firstPage(page).locator(".textLayer span", {
    hasText: "Documento de prueba",
  });
  const t = (await title.boundingBox())!;
  await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
  const editor = page.getByRole("textbox", { name: "Texto", exact: true });
  await editor.fill("Documento editado");
  await page.keyboard.press("Control+Enter");
  const edit = firstPage(page).locator(".item-textEdit");
  await expect(edit).toHaveCount(1);
  await expect(edit).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  // The engine's preview of the page shows the new text under it.
  await expect(firstPage(page).locator("img.page-edited")).toBeVisible();
  const box = (await edit.boundingBox())!;
  await expect.poll(() => darkShare(page, inset(box, 1))).toBeGreaterThan(0.02);
  await page.screenshot({ path: `${DIR}/texto-editado-escritorio.png` });
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the whiteout is visible in the editor", async ({ page }) => {
    await openFixture(page, "simple-text.pdf");
    await page
      .getByRole("navigation", { name: "Categorías de herramientas" })
      .getByRole("button", { name: "Editar" })
      .click();
    await page
      .getByRole("dialog", { name: "Editar" })
      .getByRole("button", { name: "Blanqueo" })
      .click();
    await checkWhiteout(page, "movil");
  });
});
