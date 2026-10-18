// Spec 036: the signing guide, in the visitor's language, and the links to
// it from the signing panels.
import { expect, test, type Page } from "@playwright/test";
import { openFixture } from "./helpers";

/** The screenshots that have loaded, by their path. */
const loadedShots = (page: Page) =>
  page.locator("img[data-shot]").evaluateAll((imgs: HTMLImageElement[]) =>
    imgs.map((img) => {
      img.scrollIntoView();
      return img.complete && img.naturalWidth > 0
        ? new URL(img.src).pathname
        : `not loaded: ${img.src}`;
    }),
  );

test("the guide reads in Spanish, with its screenshots, and switches to English", async ({
  page,
}) => {
  await page.goto("/guia/firmar/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Firmar con varias personas y con firma digital (PAdES)",
  );
  await expect(page).toHaveTitle(/^Guía: firmar un PDF/);
  const shots = page.locator("img[data-shot]");
  await expect(shots).toHaveCount(8);
  for (const img of await shots.all()) {
    await img.scrollIntoViewIfNeeded();
    await expect(img).toHaveJSProperty("complete", true);
  }
  for (const path of await loadedShots(page))
    expect(path).toMatch(/^\/guia\/firmar\/img\/es\/[a-z-]+\.webp$/);

  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Signing with several people and with a digital signature (PAdES)",
  );
  await expect(shots.first()).toHaveAttribute(
    "src",
    "/guia/firmar/img/en/pades-place.webp",
  );
  await page
    .getByRole("link", { name: "Several people sign the same PDF" })
    .click();
  await expect(page).toHaveURL(/#varios-firmantes$/);
});

test("the signing panels link to the guide in another tab", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Firmar", exact: true });
  const guide = panel.getByRole("link", {
    name: "Cómo funciona: ver la guía",
  });

  await panel.getByText("Varios firmantes").click();
  await expect(guide).toHaveAttribute("href", "/guia/firmar/#varios-firmantes");
  await expect(guide).toHaveAttribute("target", "_blank");

  await panel
    .getByRole("button", { name: "Siguiente: firmar y guardar" })
    .click();
  await expect(guide).toHaveAttribute("href", "/guia/firmar/#firma-digital");
  const opened = page.waitForEvent("popup");
  await guide.click();
  const tab = await opened;
  await expect(tab.getByRole("heading", { level: 1 })).toHaveText(
    "Firmar con varias personas y con firma digital (PAdES)",
  );
  expect(new URL(tab.url()).hash).toBe("#firma-digital");
});
