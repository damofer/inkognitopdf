// Spec 014: opening password-protected PDFs, saving with a password and
// compressing, on desktop and on a phone. Screenshots go to
// docs/screenshots/compress-password/.
import { createCanvas } from "@napi-rs/canvas";
import { expect, test, type Page } from "@playwright/test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { decryptPdf, encryptPdf, isEncrypted } from "../src/engine/pdfCrypto";
import {
  firstPage,
  fixture,
  openFixture,
  openTask,
  saveAndRead,
  textRuns,
} from "./helpers";

const DIR = "docs/screenshots/compress-password";

let files: { locked: string; photo: string };

test.beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), "protect-e2e-"));
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc
    .addPage([595, 842])
    .drawText("Contrato confidencial 4410", { x: 56, y: 770, size: 20, font });
  const locked = join(dir, "contrato.pdf");
  await writeFile(
    locked,
    await encryptPdf(await doc.save(), {
      password: "abre-4410",
      allowPrint: true,
      allowCopy: true,
    }),
  );

  // A page with a photo far larger than the page needs.
  const size = 2400;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#2a6f97");
  gradient.addColorStop(1, "#f4a261");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `hsl(${(i * 37) % 360} 60% 50% / 0.3)`;
    ctx.fillRect((i * 97) % size, (i * 61) % size, 18, 18);
  }
  const photoDoc = await PDFDocument.create();
  const image = await photoDoc.embedJpg(canvas.toBuffer("image/jpeg", 95));
  const page = photoDoc.addPage([400, 400]);
  page.drawImage(image, { x: 0, y: 0, width: 400, height: 400 });
  page.drawText("Foto del informe", {
    x: 20,
    y: 20,
    size: 14,
    font: await photoDoc.embedFont(StandardFonts.Helvetica),
  });
  const photo = join(dir, "foto.pdf");
  await writeFile(photo, await photoDoc.save());
  files = { locked, photo };
});

/** Page 1 text and permissions as pdf.js reads them with the password. */
async function readLocked(bytes: Uint8Array, password?: string) {
  const doc = await getDocument({ data: bytes.slice(), password }).promise;
  const text = (await (await doc.getPage(1)).getTextContent()).items
    .map((i) => ("str" in i ? i.str : ""))
    .join(" ");
  const permissions = await doc.getPermissions();
  await doc.loadingTask.destroy();
  return { text, permissions };
}

async function download(page: Page, click: () => Promise<void>) {
  const event = page.waitForEvent("download");
  await click();
  const file = await event;
  return {
    name: file.suggestedFilename(),
    bytes: new Uint8Array(await readFile((await file.path())!)),
  };
}

test("a protected PDF asks for its password and is saved with it", async ({
  page,
}) => {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(files.locked);
  const prompt = page.getByRole("dialog", { name: "PDF protegido" });
  await expect(prompt).toContainText("«contrato.pdf» está protegido");
  await prompt.getByLabel("Contraseña").fill("otra");
  await prompt.getByRole("button", { name: "Abrir" }).click();
  await expect(prompt.getByRole("alert")).toHaveText(
    "La contraseña no es correcta.",
  );
  await page.screenshot({ path: `${DIR}/pedir-contrasena.png` });
  await prompt.getByLabel("Contraseña").fill("abre-4410");
  await prompt.getByLabel("Contraseña").press("Enter");
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await expect(page.getByText("PDF abierto con su contraseña.")).toBeVisible();

  // Saving keeps the password.
  const saved = await saveAndRead(page);
  expect(isEncrypted(saved.bytes)).toBe(true);
  await expect(readLocked(saved.bytes)).rejects.toThrow(/password/i);
  expect((await readLocked(saved.bytes, "abre-4410")).text).toContain(
    "Contrato confidencial 4410",
  );

  // Removing it saves an open file.
  await openTask(page, "Revisar");
  await page.getByRole("button", { name: "Contraseña", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Proteger con contraseña" });
  await expect(panel).toContainText("se guardará protegido");
  await panel.getByRole("button", { name: "Quitar contraseña" }).click();
  await expect(panel).toContainText("Contraseña quitada");
  const open = await saveAndRead(page);
  expect(isEncrypted(open.bytes)).toBe(false);
  expect((await textRuns(open.bytes))[0]?.str).toBe(
    "Contrato confidencial 4410",
  );
});

test("cancelling the password does not open the file", async ({ page }) => {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(files.locked);
  const prompt = page.getByRole("dialog", { name: "PDF protegido" });
  await prompt.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "No se abrió «contrato.pdf».",
  );
});

test("set a password with restrictions, honestly explained", async ({
  page,
}) => {
  await openFixture(page, "two-pages.pdf");
  await openTask(page, "Revisar");
  await page.getByRole("button", { name: "Contraseña", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Proteger con contraseña" });
  await expect(panel).toContainText("son orientativos");
  await expect(panel).toContainText("no hay forma de recuperar el archivo");
  const apply = panel.getByRole("button", { name: "Proteger al guardar" });
  await apply.click();
  await expect(panel).toContainText("Escribe una contraseña.");
  await panel.getByLabel("Contraseña", { exact: true }).fill("Segura-2026");
  await panel.getByLabel("Repite la contraseña").fill("Segura-2025");
  await apply.click();
  await expect(panel).toContainText("Las contraseñas no coinciden.");
  await panel.getByLabel("Repite la contraseña").fill("Segura-2026");
  await panel.getByLabel("Permitir imprimir").uncheck();
  await apply.click();
  await expect(panel).toContainText("Contraseña lista");
  await page.screenshot({ path: `${DIR}/contrasena-escritorio.png` });

  const { bytes } = await saveAndRead(page);
  await expect(readLocked(bytes, "otra")).rejects.toThrow(/password/i);
  const { text, permissions } = await readLocked(bytes, "Segura-2026");
  expect(text).toContain("Pagina 1 de 2");
  expect(permissions).not.toContain(4); // print
  expect(permissions).toContain(16); // copy
  const plain = await decryptPdf(bytes, "Segura-2026");
  expect((await PDFDocument.load(plain.bytes)).getPageCount()).toBe(2);
});

test("compress: sizes before and after, and a smaller file", async ({
  page,
}) => {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(files.photo);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  const before = (await readFile(files.photo)).length;
  await openTask(page, "Revisar");
  await page.getByRole("button", { name: "Comprimir", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Comprimir PDF" });
  await expect(panel).toContainText("Tamaño del archivo abierto");
  await panel.getByRole("radio", { name: /Tamaño mínimo/ }).check();
  const file = await download(page, () =>
    panel.getByRole("button", { name: "Comprimir y descargar" }).click(),
  );
  expect(file.name).toBe("foto (comprimido).pdf");
  expect(file.bytes.length).toBeLessThan(before / 4);
  await expect(panel).toContainText(/→ .*% menos/);
  await page.screenshot({ path: `${DIR}/comprimir-escritorio.png` });
  expect((await textRuns(file.bytes))[0]?.str).toBe("Foto del informe");
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("compress and password are in the More sheet and fit", async ({
    page,
  }) => {
    await page.goto("/app/");
    await page.getByTestId("open-pdf").setInputFiles(fixture("two-pages.pdf"));
    await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
    const bar = page.getByRole("navigation", {
      name: "Categorías de herramientas",
    });
    for (const [item, title] of [
      ["Comprimir", "Comprimir PDF"],
      ["Contraseña", "Proteger con contraseña"],
    ]) {
      await bar.getByRole("button", { name: "Más" }).click();
      await page
        .getByRole("dialog", { name: "Más" })
        .getByRole("button", { name: item })
        .click();
      const panel = page.getByRole("dialog", { name: title });
      await expect(panel).toBeVisible();
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
      for (const control of await panel
        .locator("button, input:not([type=radio], [type=checkbox]), label")
        .all())
        if (await control.isVisible())
          expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
            43.5,
          );
      await page.screenshot({
        path: `${DIR}/${item === "Comprimir" ? "comprimir" : "contrasena"}-movil.png`,
      });
      await panel.getByRole("button", { name: "Cerrar" }).click();
    }
  });
});
