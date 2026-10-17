// Spec 004: signing in Chrome. Phase 1: visual signatures (CA1–CA6).
import { expect, test, type Page } from "@playwright/test";
import { createCanvas } from "@napi-rs/canvas";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  opensslPath,
  opensslVerify,
  pdfSignatures,
} from "../tests/signHelpers";
import { firstPage, openFixture, saveAndRead, textRuns } from "./helpers";

const panel = (page: Page) => page.getByRole("dialog", { name: "Firmar" });

/** Draws a wavy stroke on the signature pad. */
async function drawSignature(page: Page) {
  const pad = page.getByTestId("sign-canvas");
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++)
    await page.mouse.move(
      box.x + 30 + i * 12,
      box.y + box.height * (0.6 - 0.25 * Math.sin(i / 3)),
      { steps: 2 },
    );
  await page.mouse.up();
}

async function placeAt(page: Page, button: string, fx: number, fy: number) {
  await panel(page).getByRole("button", { name: button }).click();
  const box = (await firstPage(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/** A photo-like PNG: grey paper with a dark signature stroke. */
async function signaturePhoto(): Promise<string> {
  const canvas = createCanvas(600, 300);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 600, 300);
  gradient.addColorStop(0, "rgb(205,200,190)");
  gradient.addColorStop(1, "rgb(170,165,160)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 600, 300);
  ctx.strokeStyle = "rgb(20,30,90)";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(80, 200);
  ctx.bezierCurveTo(180, 40, 300, 280, 520, 90);
  ctx.stroke();
  const dir = await mkdtemp(join(tmpdir(), "pdfcraft-sign-"));
  const path = join(dir, "firma.png");
  await writeFile(path, canvas.toBuffer("image/png"));
  return path;
}

test("CA1, CA2, CA5, CA6: draw a signature, type initials, add the date, save", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  await expect(panel(page)).toBeVisible();

  // CA1: draw, undo the last stroke, draw again.
  await panel(page).getByRole("button", { name: "Crear" }).first().click();
  await drawSignature(page);
  await page.getByRole("button", { name: "Deshacer trazo" }).click();
  await expect(page.getByRole("button", { name: "Usar" })).toBeDisabled();
  await drawSignature(page);
  await page.getByRole("button", { name: "Usar" }).click();
  await expect(
    panel(page).getByTestId("adopted-signature").locator("svg"),
  ).toBeVisible();

  // CA2: typed initials, three handwriting styles.
  await panel(page).getByRole("button", { name: "Crear", exact: true }).click();
  await page.getByRole("tab", { name: "Escribir" }).click();
  await page.getByRole("textbox", { name: "Iniciales" }).fill("AP");
  const styles = page
    .getByRole("radiogroup", { name: "Estilo" })
    .getByRole("radio");
  await expect(styles).toHaveCount(3);
  await styles.nth(1).check();
  await page.getByRole("button", { name: "Usar" }).click();

  await placeAt(page, "Colocar firma", 0.6, 0.75);
  await expect(firstPage(page).locator(".item-signature")).toHaveCount(1);
  // Left of the page: the signing panel covers its right side.
  await placeAt(page, "Colocar iniciales", 0.3, 0.75);
  await expect(firstPage(page).locator(".item-signature")).toHaveCount(2);
  // CA5: undo works on placed signatures.
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(firstPage(page).locator(".item-signature")).toHaveCount(1);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(firstPage(page).locator(".item-signature")).toHaveCount(2);

  await placeAt(page, "Colocar fecha", 0.6, 0.85);
  const today = new Date();
  const date = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
  await expect(firstPage(page).locator(".item-text")).toHaveText(date);

  // CA6: flattened into the page content, not annotations.
  const saved = await saveAndRead(page);
  const runs = await textRuns(saved.bytes);
  expect(runs.map((r) => r.str).join(" ")).toContain(date);
  const doc = await PDFDocument.load(saved.bytes);
  expect(doc.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  const xobjects = doc.getPage(0).node.Resources()!.toString();
  expect(xobjects.match(/\/Sig/g)?.length).toBe(2);
});

test("CA3: a photo of a signature gets a transparent background", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  await panel(page).getByRole("button", { name: "Crear" }).first().click();
  await page.getByRole("tab", { name: "Imagen" }).click();
  await page.getByTestId("sign-image").setInputFiles(await signaturePhoto());
  const preview = page.locator(".sign-image-preview img");
  await expect(preview).toBeVisible();
  // Cropped to the stroke, with transparent corners.
  const info = await preview.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) opaque++;
    return {
      width: c.width,
      height: c.height,
      corner: d[3],
      share: opaque / (c.width * c.height),
    };
  });
  expect(info.width).toBeLessThan(500);
  expect(info.height).toBeLessThan(250);
  expect(info.corner).toBe(0);
  expect(info.share).toBeGreaterThan(0.01);
  expect(info.share).toBeLessThan(0.3);
});

test("CA4: the signature is remembered only when asked, and can be forgotten", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  await panel(page).getByRole("button", { name: "Crear" }).first().click();
  await page.getByRole("tab", { name: "Escribir" }).click();
  await page.getByLabel("Nombre").fill("Ana Pérez");
  await page.getByRole("button", { name: "Usar" }).click();

  // Not remembered: gone after reloading.
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  await expect(panel(page).getByTestId("adopted-signature")).toHaveText(
    "Sin crear",
  );

  await panel(page).getByRole("button", { name: "Crear" }).first().click();
  await page.getByRole("tab", { name: "Escribir" }).click();
  await page.getByLabel("Nombre").fill("Ana Pérez");
  await page.getByRole("button", { name: "Usar" }).click();
  await panel(page).getByLabel("Recordar en este dispositivo").check();
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  await expect(
    panel(page).getByTestId("adopted-signature").locator("text"),
  ).toHaveText("Ana Pérez");
  await expect(
    panel(page).getByLabel("Recordar en este dispositivo"),
  ).toBeChecked();

  // Forgetting removes it from the device.
  await panel(page).getByLabel("Recordar en este dispositivo").uncheck();
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  await expect(panel(page).getByTestId("adopted-signature")).toHaveText(
    "Sin crear",
  );
});

/** Share of dark pixels of the page canvas inside a box given in points. */
async function canvasInk(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
) {
  return firstPage(page)
    .locator("canvas.page-canvas")
    .evaluate((canvas: HTMLCanvasElement, b) => {
      const scale = canvas.width / 595.28;
      const ctx = canvas.getContext("2d")!;
      const x = Math.round(b.x * scale);
      const y = Math.round((841.89 - b.y - b.height) * scale);
      const w = Math.round(b.width * scale);
      const h = Math.round(b.height * scale);
      const d = ctx.getImageData(x, y, w, h).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i]! + d[i + 1]! + d[i + 2]! < 450) ink++;
      return ink / (w * h);
    }, box);
}

test("CA7, CA8, CA11, CA12, CA13: sign digitally, verify in the app and with OpenSSL", async ({
  page,
}) => {
  const outside: string[] = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:4173/")) return route.continue();
    outside.push(url);
    return route.abort();
  });
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  await panel(page).getByRole("button", { name: "Crear" }).first().click();
  await drawSignature(page);
  await page.getByRole("button", { name: "Usar" }).click();
  await placeAt(page, "Colocar firma", 0.6, 0.8);
  const placed = firstPage(page).locator(".item-signature");
  await expect(placed).toHaveCount(1);

  // A self-signed identity made on the device, in the second step.
  await panel(page)
    .getByRole("button", { name: "Siguiente: firmar y guardar" })
    .click();
  await panel(page).getByLabel("Nombre del firmante").fill("Ana Pérez");
  await panel(page).getByLabel("Correo (opcional)").fill("ana@example.com");
  await panel(page)
    .getByRole("button", { name: "Crear certificado", exact: true })
    .click();
  await expect(panel(page).getByLabel("Certificado")).toContainText(
    "Ana Pérez",
  );

  const pending = page.waitForEvent("download");
  await panel(page).getByRole("button", { name: "Guardar firmado" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("simple-text (firmado).pdf");
  const path = (await download.path())!;
  const bytes = new Uint8Array(await readFile(path));

  // Independent check (D5).
  if (opensslPath) {
    const [sig] = pdfSignatures(bytes);
    expect((await opensslVerify(sig!)).out).toMatch(/Verification successful/);
  }

  // Opened again: the app reports one intact signature, and shows it.
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles({
    name: "firmado.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  const notice = page.getByTestId("signed-notice");
  await expect(notice).toContainText("una firma digital");
  await expect(notice).toContainText("Todas son íntegras");
  const doc = await PDFDocument.load(bytes);
  const widget = doc.getForm().getFields()[0]!.acroField.getWidgets()[0]!;
  const r = widget.getRectangle();
  expect(await canvasInk(page, r)).toBeGreaterThan(0.01);

  await notice.getByRole("button", { name: "Ver firmas" }).click();
  const report = page.getByTestId("sig-report");
  await expect(report).toContainText("Ana Pérez");
  await expect(report.getByTestId("sig-integrity")).toHaveText("Firma íntegra");
  await expect(report.getByTestId("sig-changes")).toContainText(
    "todo el documento",
  );
  await expect(report.getByTestId("sig-trust")).toContainText("autofirmado");

  // CA12: saving from the editor warns that the signature will break.
  await page.getByRole("button", { name: "Guardar PDF" }).click();
  await expect(page.getByRole("alertdialog", { name: "Firmas" })).toBeVisible();
  await page.getByRole("button", { name: "Cancelar" }).click();

  expect(outside).toEqual([]);
});
