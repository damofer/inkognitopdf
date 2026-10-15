// Spec 003, O017: OCR of light text on a dark background (a book cover),
// through the scanner as a user would do it: photo → scanner (each mode) →
// editor → OCR → saved PDF text. Screenshots go to docs/screenshots/ocr-dark/.
import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COVER_TITLES, darkCoverJpeg } from "../tests/ocr/darkCover";
import { firstPage, saveAndRead, textRuns } from "./helpers";

const OUT = "docs/screenshots/ocr-dark";
let cover: string;

test.beforeAll(async () => {
  cover = join(await mkdtemp(join(tmpdir(), "ocr-dark-")), "portada.jpg");
  await writeFile(cover, darkCoverJpeg(2));
});

const scanner = (page: Page) =>
  page.getByRole("dialog", { name: "Escanear documento" });
const panel = (page: Page) =>
  page.getByRole("dialog", { name: "Reconocer texto" });

/** Letters and digits only, upper case: small capitals read either way. */
const fold = (s: string) => s.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ");

for (const [mode, file] of [
  ["Fotocopia", "fotocopia"],
  ["Grises", "grises"],
  ["Original", "original"],
] as const)
  test(`a dark cover scanned as «${mode}» is recognized`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto("/app/");
    await page.getByRole("button", { name: "Escanear" }).click();
    await page.getByTestId("scan-images").setInputFiles(cover);
    await expect(page.locator(".scan-strip li")).toHaveCount(1);
    // A cover fills the photo: the whole image is the page.
    await scanner(page)
      .getByRole("button", { name: "Imagen completa" })
      .click();
    await scanner(page).getByRole("button", { name: "Continuar" }).click();
    await scanner(page)
      .getByRole("group", { name: "Modo" })
      .getByRole("button", { name: mode })
      .click();
    await scanner(page)
      .getByRole("button", { name: "Abrir en el editor" })
      .click();
    await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");

    await page.getByRole("button", { name: "OCR", exact: true }).click();
    await panel(page).getByLabel("Idioma").selectOption("spa");
    const started = Date.now();
    await panel(page).getByRole("button", { name: "Reconocer" }).click();
    await expect(panel(page).getByTestId("ocr-status")).toContainText(
      "Reconocida 1 página.",
      { timeout: 120_000 },
    );
    console.log(`OCR portada oscura (${mode}): ${Date.now() - started} ms`);
    await page.getByRole("button", { name: "Cerrar OCR" }).click();
    await firstPage(page).screenshot({ path: `${OUT}/despues-${file}.png` });

    const saved = await saveAndRead(page);
    const text = (await textRuns(saved.bytes, 1)).map((r) => r.str).join(" ");
    console.log(`texto reconocido (${mode}): ${text}`);
    for (const title of COVER_TITLES) expect(fold(text)).toContain(fold(title));
  });
