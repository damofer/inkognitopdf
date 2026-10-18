// Spec 040: a trusted timestamp on the digital signature. The relay at /tsa
// is answered by a test authority; only a hash ever goes to it.
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fakeTsa } from "../tests/fakeTsa";
import {
  opensslPath,
  opensslVerify,
  pdfSignatures,
} from "../tests/signHelpers";
import { firstPage, openFixture } from "./helpers";

const panel = (page: Page) => page.getByRole("dialog", { name: "Firmar" });

/** Up to the second step of a digital signature with a new certificate. */
async function readyToSign(page: Page, newCertificate = true) {
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  await panel(page).getByRole("button", { name: "Crear" }).first().click();
  await page.getByRole("tab", { name: "Escribir" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill("Ana Pérez");
  await page.getByRole("button", { name: "Usar" }).click();
  await panel(page).getByRole("button", { name: "Colocar firma" }).click();
  const box = (await firstPage(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.8);
  await panel(page)
    .getByRole("button", { name: "Siguiente: firmar y guardar" })
    .click();
  if (newCertificate) {
    await panel(page).getByLabel("Nombre del firmante").fill("Ana Pérez");
    await panel(page)
      .getByRole("button", { name: "Crear certificado", exact: true })
      .click();
  }
  await expect(panel(page).getByLabel("Certificado")).toContainText(
    "Ana Pérez",
  );
}

test("CA1–CA3: the signature gets the authority's time, and the app shows it", async ({
  page,
}) => {
  const time = new Date("2026-10-18T16:00:00Z");
  const tsa = await fakeTsa({ name: "Sellos de Prueba", time });
  const sent: number[] = [];
  const outside: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/tsa") {
      const body = request.postDataBuffer()!;
      sent.push(body.length);
      return route.fulfill({
        contentType: "application/timestamp-reply",
        body: Buffer.from(await tsa.respond(new Uint8Array(body))),
      });
    }
    if (url.origin === "http://127.0.0.1:4173") return route.continue();
    outside.push(request.url());
    return route.abort();
  });
  await readyToSign(page);
  const option = panel(page).getByLabel("Añadir sello de tiempo");
  await expect(option).not.toBeChecked();
  await expect(panel(page)).toContainText("nunca el documento");
  await option.check();

  const pending = page.waitForEvent("download");
  await panel(page).getByRole("button", { name: "Guardar firmado" }).click();
  const bytes = new Uint8Array(await readFile((await (await pending).path())!));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toBeLessThan(120);
  expect(outside).toEqual([]);
  if (opensslPath) {
    const [sig] = pdfSignatures(bytes);
    expect((await opensslVerify(sig!)).out).toMatch(/Verification successful/);
  }

  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles({
    name: "firmado.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await page
    .getByTestId("signed-notice")
    .getByRole("button", { name: "Ver firmas" })
    .click();
  const report = page.getByTestId("sig-report");
  await expect(report.getByTestId("sig-integrity")).toHaveText("Firma íntegra");
  await expect(report.getByTestId("sig-timestamp")).toContainText(
    "Sello de tiempo:",
  );
  await expect(report.getByTestId("sig-timestamp")).toContainText(
    "certificado por Sellos de Prueba",
  );
  await expect(report).toContainText("Hora del dispositivo del firmante");

  // The choice is remembered for the next signature.
  await page.goto("/app/");
  await readyToSign(page, false);
  await expect(panel(page).getByLabel("Añadir sello de tiempo")).toBeChecked();
});

test("CA4: if the authority does not answer, nothing is saved and it says so", async ({
  page,
}) => {
  await page.route("**/tsa", (route) => route.fulfill({ status: 502 }));
  await readyToSign(page);
  await panel(page).getByLabel("Añadir sello de tiempo").check();
  let downloads = 0;
  page.on("download", () => downloads++);
  await panel(page).getByRole("button", { name: "Guardar firmado" }).click();
  await expect(page.getByText(/No se pudo contactar/)).toBeVisible();
  expect(downloads).toBe(0);
});

test("CA5: offline the option is off and the signature uses the device time", async ({
  page,
}) => {
  await readyToSign(page);
  // Offline as the browser reports it; the app's own files still load, as
  // they would from the service worker.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", { get: () => false });
    dispatchEvent(new Event("offline"));
  });
  const option = panel(page).getByLabel("Añadir sello de tiempo");
  await expect(option).toBeDisabled();
  await expect(panel(page)).toContainText("necesita conexión");
  const pending = page.waitForEvent("download");
  await panel(page).getByRole("button", { name: "Guardar firmado" }).click();
  await pending;
});
