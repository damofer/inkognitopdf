// Spec 004, HU6–HU7: several signers in order, each in their own pdfcraft,
// with the audit page (CA9, CA10, CA13).
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName, PDFArray } from "pdf-lib";
import {
  opensslPath,
  opensslVerify,
  pdfSignatures,
} from "../tests/signHelpers";
import { firstPage, openFixture, textRuns } from "./helpers";

const signPanel = (page: Page) =>
  page.getByRole("dialog", { name: "Firmar", exact: true });
const signAsPanel = (page: Page) =>
  page.getByRole("dialog", { name: "Firmar como" });

async function drawSignature(page: Page, wave: number) {
  const pad = page.getByTestId("sign-canvas");
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++)
    await page.mouse.move(
      box.x + 30 + i * 12,
      box.y + box.height * (0.6 - 0.25 * Math.sin(i / wave)),
      { steps: 2 },
    );
  await page.mouse.up();
}

async function clickPage(page: Page, fx: number, fy: number) {
  const box = (await firstPage(page).boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

async function openBytes(page: Page, name: string, bytes: Uint8Array) {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
}

async function download(page: Page, click: () => Promise<void>) {
  const pending = page.waitForEvent("download");
  await click();
  const file = await pending;
  return {
    name: file.suggestedFilename(),
    bytes: new Uint8Array(await readFile((await file.path())!)),
  };
}

/** Signs the opened plan as `name`, with a new self-signed certificate. */
async function signAs(page: Page, name: string, wave: number) {
  const notice = page.getByTestId("plan-notice");
  await expect(notice).toContainText(`Le toca a: ${name}`);
  await notice.getByRole("button", { name: "Firmar como…" }).click();
  const panel = signAsPanel(page);
  await expect(
    panel.getByRole("radio", { name: new RegExp(name) }),
  ).toBeChecked();
  await panel.getByRole("button", { name: "Crear", exact: true }).click();
  await drawSignature(page, wave);
  await page.getByRole("button", { name: "Usar" }).click();
  // The device may already keep another signer's certificate.
  const select = panel.getByRole("combobox", { name: "Certificado" });
  const nameField = panel.getByLabel("Nombre del firmante");
  await expect(select.or(nameField).first()).toBeVisible();
  if (await select.isVisible())
    await panel
      .getByRole("button", { name: "Crear certificado propio" })
      .click();
  await nameField.fill(name);
  await panel
    .getByRole("button", { name: "Crear certificado", exact: true })
    .click();
  await expect(select).toContainText(name);
  return download(page, () =>
    panel.getByRole("button", { name: "Guardar firmado" }).click(),
  );
}

test("CA9, CA10, CA13: two signers in order, each signature valid, audit page", async ({
  page,
}) => {
  const outside: string[] = [];
  await page.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http://127.0.0.1:4173/")) return route.continue();
    outside.push(url);
    return route.abort();
  });

  // The sender prepares the document.
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  const panel = signPanel(page);
  await panel.getByText("Varios firmantes").click();
  await panel.getByRole("button", { name: "Añadir firmante" }).click();
  await panel.getByRole("button", { name: "Añadir firmante" }).click();
  await expect(panel.getByTestId("plan-signer")).toHaveCount(2);
  await panel.getByLabel("Nombre del firmante 1").fill("Ana Uno");
  await panel.getByLabel("Correo del firmante 1").fill("ana@example.com");
  await panel.getByLabel("Nombre del firmante 2").fill("Beto Dos");
  await expect(panel.getByLabel("Orden del firmante 2")).toHaveValue("2");
  const prepare = panel.getByRole("button", { name: "Guardar para firmar" });
  await expect(prepare).toBeDisabled();

  const fieldsOf = (who: string) =>
    panel.getByRole("group", { name: `Campos de ${who}` });
  await fieldsOf("Ana Uno").getByRole("button", { name: "+ Firma" }).click();
  await clickPage(page, 0.3, 0.7);
  await fieldsOf("Ana Uno").getByRole("button", { name: "+ Fecha" }).click();
  await clickPage(page, 0.7, 0.7);
  await fieldsOf("Beto Dos").getByRole("button", { name: "+ Firma" }).click();
  await clickPage(page, 0.3, 0.85);
  const fields = firstPage(page).locator(".item-signField");
  await expect(fields).toHaveCount(3);
  await expect(fields.first()).toContainText("Firma: Ana Uno");

  const prepared = await download(page, () => prepare.click());
  expect(prepared.name).toBe("simple-text (para firmar).pdf");
  {
    const doc = await PDFDocument.load(prepared.bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(
      doc
        .getForm()
        .getFields()
        .map((f) => f.getName()),
    ).toHaveLength(2);
    // The field boxes are not drawn into the page.
    expect(doc.getPage(0).node.Annots()?.size()).toBe(2);
  }
  expect((await textRuns(prepared.bytes, 2)).map((r) => r.str)).toContain(
    "Registro de firmas",
  );

  // Beto cannot sign before Ana.
  await openBytes(page, prepared.name, prepared.bytes);
  await page
    .getByTestId("plan-notice")
    .getByRole("button", { name: "Firmar como…" })
    .click();
  await expect(
    signAsPanel(page).getByRole("radio", { name: /Beto Dos/ }),
  ).toBeDisabled();
  await expect(
    signAsPanel(page).getByTestId("plan-status").nth(1),
  ).toContainText("espera");
  // Ana's fields are outlined on the page.
  await expect(firstPage(page).getByTestId("plan-field")).toHaveCount(2);
  await signAsPanel(page)
    .getByRole("button", { name: "Cerrar firmar como" })
    .click();

  const first = await signAs(page, "Ana Uno", 3);
  expect(first.name).toBe("simple-text (firmado).pdf");

  await openBytes(page, first.name, first.bytes);
  await expect(page.getByTestId("signed-notice")).toContainText(
    "una firma digital",
  );
  const second = await signAs(page, "Beto Dos", 5);

  // Opened again: both signatures intact, everyone signed.
  await openBytes(page, second.name, second.bytes);
  const signed = page.getByTestId("signed-notice");
  await expect(signed).toContainText("2 firmas digitales");
  await expect(signed).toContainText("Todas son íntegras");
  await expect(page.getByTestId("plan-notice")).toContainText(
    "firmado por todos (2)",
  );
  await signed.getByRole("button", { name: "Ver firmas" }).click();
  const reports = page.getByTestId("sig-report");
  await expect(reports).toHaveCount(2);
  await expect(reports.nth(0)).toContainText("Ana Uno");
  await expect(reports.nth(1)).toContainText("Beto Dos");
  for (const i of [0, 1])
    await expect(reports.nth(i).getByTestId("sig-integrity")).toHaveText(
      "Firma íntegra",
    );

  // Independent check (D5).
  if (opensslPath)
    for (const sig of pdfSignatures(second.bytes))
      expect((await opensslVerify(sig)).out).toMatch(/Verification successful/);

  // CA10: one audit row per signer on the audit page.
  const doc = await PDFDocument.load(second.bytes);
  const annots = doc.getPage(1).node.lookup(PDFName.of("Annots"), PDFArray);
  expect(annots.size()).toBe(2);

  expect(outside).toEqual([]);
});

test("CA10: a single digital signer can add the audit page", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Firmar", exact: true }).click();
  const panel = signPanel(page);
  await panel.getByRole("button", { name: "Crear" }).first().click();
  await drawSignature(page, 4);
  await page.getByRole("button", { name: "Usar" }).click();
  await panel.getByRole("button", { name: "Colocar firma" }).click();
  await clickPage(page, 0.6, 0.8);
  await panel.getByLabel("Nombre del firmante").fill("Ana Uno");
  await panel
    .getByRole("button", { name: "Crear certificado", exact: true })
    .click();
  await expect(
    panel.getByRole("combobox", { name: "Certificado" }),
  ).toContainText("Ana Uno");
  await panel
    .getByRole("group", { name: "Guardar firmado" })
    .getByLabel("Añadir página de registro de firmas")
    .check();
  const signed = await download(page, () =>
    panel.getByRole("button", { name: "Guardar firmado" }).click(),
  );

  const doc = await PDFDocument.load(signed.bytes);
  expect(doc.getPageCount()).toBe(2);
  const annots = doc.getPage(1).node.lookup(PDFName.of("Annots"), PDFArray);
  expect(annots.size()).toBe(1);
  expect((await textRuns(signed.bytes, 2)).map((r) => r.str)).toContain(
    "Registro de firmas",
  );
  if (opensslPath) {
    const [sig] = pdfSignatures(signed.bytes);
    expect((await opensslVerify(sig!)).out).toMatch(/Verification successful/);
  }
  // The row is part of the signed revision: nothing changed after signing.
  await openBytes(page, signed.name, signed.bytes);
  await page
    .getByTestId("signed-notice")
    .getByRole("button", { name: "Ver firmas" })
    .click();
  await expect(page.getByTestId("sig-changes")).toContainText(
    "todo el documento",
  );
});
