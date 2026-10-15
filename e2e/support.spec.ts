// Donations: the "Apoyar" panel in the app (header and phone menu) and the
// section on the landing. Screenshots go to docs/screenshots/support/.
import { expect, test, type Locator } from "@playwright/test";

const DIR = "docs/screenshots/support";

async function tiers(scope: Locator) {
  return scope
    .locator("a[data-tier]")
    .evaluateAll((links) =>
      links.map((a) => [
        a.getAttribute("data-tier"),
        a.getAttribute("target"),
        a.getAttribute("rel"),
      ]),
    );
}

const ES_ORDER = ["10000", "20000", "50000", "other", "kofi"];
const EN_ORDER = ["kofi", "10000", "20000", "50000", "other"];

test("the panel opens from the header and closes with Escape", async ({
  page,
}) => {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Apoyar" }).click();
  const panel = page.getByRole("dialog", { name: "Apoya InkognitoPDF" });
  await expect(panel).toBeVisible();
  const found = await tiers(panel);
  expect(found.map((l) => l[0])).toEqual(ES_ORDER);
  for (const [, target, rel] of found) {
    expect(target).toBe("_blank");
    expect(rel).toBe("noopener noreferrer");
  }
  await expect(panel.getByRole("link", { name: "Otro monto" })).toBeVisible();
  await expect(panel).toContainText("¿Fuera de Colombia?");
  await page.screenshot({ path: `${DIR}/panel-escritorio.png` });
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // In English, Ko-fi comes first.
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Support" }).click();
  const english = page.getByRole("dialog", { name: "Support InkognitoPDF" });
  expect((await tiers(english)).map((l) => l[0])).toEqual(EN_ORDER);
  await expect(english).toContainText("From Colombia?");
  await page.screenshot({ path: `${DIR}/panel-escritorio-en.png` });
});

test("the landing shows the options in the order of the language", async ({
  page,
}) => {
  await page.goto("/");
  const section = page.locator("#support");
  await section.scrollIntoViewIfNeeded();
  expect((await tiers(section)).map((l) => l[0])).toEqual(ES_ORDER);
  await expect(section.getByRole("heading", { level: 3 })).toHaveText([
    "Con Mercado Pago",
    "¿Fuera de Colombia?",
  ]);
  await section.screenshot({ path: `${DIR}/landing-es.png` });
  await page.getByRole("button", { name: "English", exact: true }).click();
  expect((await tiers(section)).map((l) => l[0])).toEqual(EN_ORDER);
  await expect(section.getByRole("heading", { level: 3 })).toHaveText([
    "From Colombia?",
  ]);
  await section.screenshot({ path: `${DIR}/landing-en.png` });
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the panel is in the menu and fits", async ({ page }) => {
    await page.goto("/app/");
    await page.getByRole("button", { name: "Menú" }).click();
    await page.getByRole("button", { name: "Apoyar" }).click();
    const panel = page.getByRole("dialog", { name: "Apoya InkognitoPDF" });
    await expect(panel).toBeVisible();
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    for (const link of await panel.getByRole("link").all())
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    await page.screenshot({ path: `${DIR}/panel-movil.png` });
  });
});

test("the app menu links to the source code on GitHub", async ({ page }) => {
  await page.goto("/app/");
  const link = page.getByRole("link", { name: "Código fuente" });
  await expect(link).toHaveAttribute(
    "href",
    "https://github.com/damofer/inkognitopdf",
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByRole("link", { name: "Source code" })).toBeVisible();
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the source code link is in the menu, 44 px tall", async ({ page }) => {
    await page.goto("/app/");
    await page.getByRole("button", { name: "Menú" }).click();
    const link = page.getByRole("link", { name: "Código fuente" });
    await expect(link).toBeVisible();
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});
