// On a phone, a placed signature and a created form field are moved with a
// finger, and the signature is resized by its handle (spec 004 and 005).
// The gestures are real touch events, as the touch screen sends them.
import { expect, test, type Page } from "@playwright/test";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
} from "pdf-lib";
import { firstPage, openFixture, saveAndRead } from "./helpers";

const DIR = "docs/screenshots/mobile-drag";

/** A finger drag from (x, y) by (dx, dy), as the touch screen sends it. */
async function drag(page: Page, x: number, y: number, dx: number, dy: number) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (
    type: "touchStart" | "touchMove" | "touchEnd",
    px = x,
    py = y,
  ) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x: px, y: py, id: 1 }],
    });
  await touch("touchStart");
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    await touch("touchMove", x + (dx * i) / steps, y + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  await touch("touchEnd");
  await cdp.detach();
}

/** Page content of the first page, decoded. */
function content(doc: PDFDocument) {
  const page = doc.getPage(0).node;
  const c = page.lookup(PDFName.of("Contents"));
  const refs =
    c instanceof PDFArray ? c.asArray() : [page.get(PDFName.of("Contents"))!];
  return refs
    .map((r) => doc.context.lookup(r))
    .filter((s): s is PDFRawStream => s instanceof PDFRawStream)
    .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1"))
    .join("\n");
}

/** The on-screen box of an item, in PDF points (page without rotation). */
async function toPdf(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
) {
  const p = (await firstPage(page).boundingBox())!;
  const k = 595.28 / p.width; // simple-text.pdf and many-pages.pdf are A4
  return {
    x: (box.x - p.x) * k,
    y: (p.y + p.height - box.y - box.height) * k,
    width: box.width * k,
  };
}

const center = (b: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => ({
  x: b.x + b.width / 2,
  y: b.y + b.height / 2,
});

async function placeSignature(page: Page) {
  const bar = page.getByRole("navigation", {
    name: "Categorías de herramientas",
  });
  await bar.getByRole("button", { name: "Firmar" }).click();
  const panel = page.getByRole("dialog", { name: "Firmar" });
  await panel.getByRole("button", { name: "Crear" }).first().click();
  await page.getByRole("tab", { name: "Escribir" }).click();
  await page.getByRole("dialog").getByRole("textbox").first().fill("Ana Pérez");
  await page.getByRole("button", { name: "Usar" }).click();
  await panel.getByRole("button", { name: "Colocar firma" }).click();
  const box = (await firstPage(page).boundingBox())!;
  await page.touchscreen.tap(box.x + box.width * 0.4, box.y + 200);
  const sig = firstPage(page).locator(".item-signature");
  await expect(sig).toHaveCount(1);
  return sig;
}

for (const device of [
  { name: "Pixel 7", width: 412, height: 915 },
  { name: "iPhone 13", width: 390, height: 844 },
]) {
  test.describe(device.name, () => {
    test.use({
      viewport: { width: device.width, height: device.height },
      isMobile: true,
      hasTouch: true,
    });

    test("a placed signature is moved and resized with a finger", async ({
      page,
    }) => {
      await openFixture(page, "simple-text.pdf");
      const sig = await placeSignature(page);
      await page.screenshot({ path: `${DIR}/firma-colocada.png` });
      const before = (await sig.boundingBox())!;
      const scroll = await page
        .locator(".pages")
        .evaluate((el) => el.scrollTop);

      // Move it 60 px right and 80 px down.
      const c = center(before);
      await drag(page, c.x, c.y, 60, 80);
      const moved = (await sig.boundingBox())!;
      expect(moved.x - before.x).toBeCloseTo(60, -1);
      expect(moved.y - before.y).toBeCloseTo(80, -1);
      // The page did not scroll instead.
      expect(await page.locator(".pages").evaluate((el) => el.scrollTop)).toBe(
        scroll,
      );

      // Resize it by its handle, which is easy to touch.
      const handle = firstPage(page).getByTestId("resize-handle");
      const h = (await handle.boundingBox())!;
      // A finger 20 px off its center still takes the handle (44 px area).
      const hc = center(h);
      for (const [ox, oy] of [
        [-20, -20],
        [20, 20],
        [20, -20],
      ] as const)
        expect(
          await page.evaluate(
            ([x, y]) =>
              document
                .elementFromPoint(x, y)
                ?.classList.contains("resize-handle"),
            [hc.x + ox, hc.y + oy],
          ),
        ).toBe(true);
      await drag(page, hc.x, hc.y, 50, 20);
      const resized = (await sig.boundingBox())!;
      expect(resized.width).toBeGreaterThan(moved.width + 30);
      await page.screenshot({ path: `${DIR}/firma-movida.png` });

      // The saved signature is where it was left (its bottom-left corner).
      const want = await toPdf(page, resized);
      const { bytes } = await saveAndRead(page);
      const m = /([-\d.]+) ([-\d.]+) cm\s*\/Sig\S* Do/.exec(
        content(await PDFDocument.load(bytes)),
      );
      expect(m, "signature drawn in the page").toBeTruthy();
      const [, x, y] = m!.map(Number);
      expect(x).toBeCloseTo(want.x, -1);
      expect(y).toBeCloseTo(want.y, -1);
    });

    test("a created form field is moved with a finger", async ({ page }) => {
      await openFixture(page, "simple-text.pdf");
      const bar = page.getByRole("navigation", {
        name: "Categorías de herramientas",
      });
      await bar.getByRole("button", { name: "Más" }).click();
      await page
        .getByRole("dialog", { name: "Más" })
        .getByRole("button", { name: "Campos" })
        .click();
      const box = (await firstPage(page).boundingBox())!;
      await page.touchscreen.tap(box.x + box.width * 0.3, box.y + 250);
      const field = firstPage(page).locator('.item[data-kind="formField"]');
      await expect(field).toHaveCount(1);
      const before = (await field.boundingBox())!;
      const c = center(before);
      await drag(page, c.x, c.y, 50, 90);
      const moved = (await field.boundingBox())!;
      expect(moved.x - before.x).toBeCloseTo(50, -1);
      expect(moved.y - before.y).toBeCloseTo(90, -1);
      await page.screenshot({ path: `${DIR}/campo-movido.png` });

      // Saved where it was left.
      const want = await toPdf(page, moved);
      const { bytes } = await saveAndRead(page);
      const form = (await PDFDocument.load(bytes)).getForm();
      const rect = form
        .getFields()[0]!
        .acroField.getWidgets()[0]!
        .getRectangle();
      expect(rect.x).toBeCloseTo(want.x, -1);
      expect(rect.y).toBeCloseTo(want.y, -1);
    });

    test("a finger off the items still scrolls the page", async ({ page }) => {
      await openFixture(page, "many-pages.pdf");
      const sig = await placeSignature(page);
      const pages = page.locator(".pages");
      const top = await pages.evaluate((el) => el.scrollTop);
      const s = (await sig.boundingBox())!;
      const p = (await firstPage(page).boundingBox())!;
      // Below the signature, on the page.
      const x = p.x + 30;
      const y = Math.min(s.y + s.height + 120, p.y + p.height - 20);
      await drag(page, x, y, 0, -300);
      await expect
        .poll(() => pages.evaluate((el) => el.scrollTop))
        .toBeGreaterThan(top + 100);
    });
  });
}
