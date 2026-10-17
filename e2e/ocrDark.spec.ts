// Spec 003, O017: OCR of light text on a dark background (a book cover),
// through the scanner as a user would do it: photo → scanner (each mode) →
// editor → OCR → saved PDF text. Screenshots go to docs/screenshots/ocr-dark/.
import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COVER_TITLES,
  darkCoverJpeg,
  darkPhotoJpeg,
  PHOTO_BOX,
} from "../tests/ocr/darkCover";
import { firstPage, saveAndRead, textRuns } from "./helpers";

const OUT = "docs/screenshots/ocr-dark";
let cover: string;
let photo: string;

test.beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "ocr-dark-"));
  cover = join(dir, "portada.jpg");
  photo = join(dir, "informe-con-foto.jpg");
  await writeFile(cover, darkCoverJpeg(2));
  await writeFile(photo, darkPhotoJpeg());
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
    await page.getByRole("button", { name: "Escanear" }).first().click();
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

test("a dark photo in a document is not turned into a negative", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/app/");
  await page.getByRole("button", { name: "Escanear" }).first().click();
  await page.getByTestId("scan-images").setInputFiles(photo);
  await expect(page.locator(".scan-strip li")).toHaveCount(1);
  await scanner(page).getByRole("button", { name: "Imagen completa" }).click();
  await scanner(page).getByRole("button", { name: "Continuar" }).click();
  await scanner(page)
    .getByRole("group", { name: "Modo" })
    .getByRole("button", { name: "Fotocopia" })
    .click();
  await scanner(page)
    .getByRole("button", { name: "Abrir en el editor" })
    .click();
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await firstPage(page).screenshot({
    path: `${OUT}/foto-oscura-fotocopia.png`,
  });

  // Mean brightness of areas of the photo, as shares of the page (1240 × 1754).
  const mean = (x0: number, y0: number, x1: number, y1: number) =>
    firstPage(page)
      .locator("canvas")
      .first()
      .evaluate(
        (c: HTMLCanvasElement, [a, b, d, e]) => {
          const ctx = c.getContext("2d")!;
          const x = Math.round(a! * c.width);
          const y = Math.round(b! * c.height);
          const w = Math.max(1, Math.round((d! - a!) * c.width));
          const h = Math.max(1, Math.round((e! - b!) * c.height));
          const px = ctx.getImageData(x, y, w, h).data;
          let sum = 0;
          for (let i = 0; i < px.length; i += 4) sum += px[i]!;
          return sum / (px.length / 4);
        },
        [x0 / 1240, y0 / 1754, x1 / 1240, y1 / 1754],
      );
  const { x0, y0 } = PHOTO_BOX;
  // The moon stays white; the first building (dark, lit windows) stays dark.
  expect(await mean(x0 + 765, y0 + 125, x0 + 795, y0 + 155)).toBeGreaterThan(
    200,
  );
  expect(await mean(x0 + 45, y0 + 180, x0 + 215, y0 + 465)).toBeLessThan(110);
});
