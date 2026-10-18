// Spec 037: the installed app downloads the OCR files ahead, so the first
// recognition works offline.
import { expect, test } from "@playwright/test";
import { firstPage } from "./helpers";
import { writeScannedPdf } from "./scannedPdf";

test("installed app: OCR works offline without ever having been used", async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const scannedPdf = await writeScannedPdf();
  // Opened as an installed app.
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      const list = real(query);
      if (query.includes("display-mode: standalone"))
        Object.defineProperty(list, "matches", { value: true });
      return list;
    };
  });

  await page.goto("/app/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cached = () =>
    page.evaluate(async () =>
      (await (await caches.open("pdfcraft-ocr")).keys()).map(
        (r) => new URL(r.url).pathname,
      ),
    );
  await expect
    .poll(cached, { timeout: 60_000 })
    .toEqual(
      expect.arrayContaining([
        "/tesseract/worker.min.js",
        "/tesseract/spa.traineddata.gz",
        "/tesseract/eng.traineddata.gz",
      ]),
    );
  expect(
    (await cached()).some((p) => /tesseract-core-.*lstm\.wasm\.js$/.test(p)),
  ).toBe(true);

  // Offline, under the service worker, OCR runs for the first time.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.getByTestId("open-pdf").setInputFiles(scannedPdf);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await page
    .getByTestId("scanned-notice")
    .getByRole("button", { name: "Reconocer texto" })
    .click();
  const panel = page.getByRole("dialog", { name: "Reconocer texto" });
  await panel.getByLabel("Idioma").selectOption("spa");
  await panel.getByRole("button", { name: "Reconocer" }).click();
  await expect(panel.getByTestId("ocr-status")).toContainText(
    "Reconocidas 2 páginas",
    { timeout: 180_000 },
  );
});
