// Spec 012, CA13: secure redaction also removes the data outside the areas
// (notes, bookmarks, attachments, field values, metadata), after saying where
// it is. The file is made here. Screenshots go to docs/screenshots/redaction/.
import { expect, test, type Page } from "@playwright/test";
import {
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { firstPage, openPdf, saveAndRead } from "./helpers";

const DIR = "docs/screenshots/redaction";
const SECRET = "REDACTADO-2222";
const run = promisify(execFile);

const QPDF = [
  process.env.QPDF,
  join(import.meta.dirname, "..", "..", "tools", "qpdf", "bin", "qpdf.exe"),
  "/usr/bin/qpdf",
].find((p): p is string => !!p && existsSync(p));
const PDFTOTEXT = [
  process.env.PDFTOTEXT,
  "C:/Program Files/Git/mingw64/bin/pdftotext.exe",
  "/usr/bin/pdftotext",
].find((p): p is string => !!p && existsSync(p));

/** A page with the secret, quoted again in every other place of the file. */
async function makePdf() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const draw = (s: string, y: number) =>
    page.drawText(s, { x: 72, y, size: 20, font });
  draw("TITULO PUBLICO", 780);
  draw(SECRET, 620);
  draw("VISIBLE-3333", 560);

  const form = doc.getForm();
  const field = form.createTextField("campo_fuera");
  field.setText(`Ref ${SECRET}`);
  field.addToPage(page, { x: 300, y: 250, width: 200, height: 30, font });

  page.node.addAnnot(
    ctx.register(
      ctx.obj({
        Type: "Annot",
        Subtype: "Text",
        Rect: [500, 780, 520, 800],
        Contents: PDFString.of(`NOTA-FUERA: ${SECRET}`),
      }),
    ),
  );

  const parent = ctx.nextRef();
  const child = ctx.register(
    ctx.obj({ Title: PDFHexString.fromText("Anexo"), Parent: parent }),
  );
  const item = ctx.register(
    ctx.obj({
      Title: PDFHexString.fromText(`MARCADOR: ${SECRET}`),
      Parent: parent,
      First: child,
      Last: child,
      Count: 1,
      Dest: [page.ref, "XYZ", 0, 842, 0],
    }),
  );
  (ctx.lookup(child) as never as { set: (k: PDFName, v: unknown) => void }).set(
    PDFName.of("Parent"),
    item,
  );
  ctx.assign(
    parent,
    ctx.obj({ Type: "Outlines", First: item, Last: item, Count: 2 }),
  );
  doc.catalog.set(PDFName.of("Outlines"), parent);
  await doc.attach(Buffer.from(`ADJUNTO-8888 ${SECRET}`), "secreto.txt", {
    mimeType: "text/plain",
  });

  doc.setTitle(`Informe ${SECRET}`);
  doc.setSubject(SECRET);
  doc.setKeywords([SECRET]);
  doc.catalog.set(
    PDFName.of("Metadata"),
    ctx.register(
      ctx.stream(
        `<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:title>XMP ${SECRET}</dc:title></x:xmpmeta>`,
        { Type: "Metadata", Subtype: "XML" },
      ),
    ),
  );
  return Buffer.from(await doc.save());
}

async function openMade(page: Page) {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles({
    name: "datos.pdf",
    mimeType: "application/pdf",
    buffer: await makePdf(),
  });
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
}

/** Searches the secret with the tool and opens the warning. */
async function markAndOpen(page: Page, en = false) {
  await page
    .getByRole("group", {
      name: en ? "Editing tools" : "Herramientas de edición",
    })
    .getByRole("button", {
      name: en ? "Secure redaction" : "Borrado seguro",
      exact: true,
    })
    .click();
  const options = page.getByRole("group", {
    name: en ? "Secure redaction" : "Borrado seguro",
  });
  await options.getByRole("searchbox").fill(SECRET);
  await options
    .getByRole("button", { name: en ? "Mark matches" : "Marcar coincidencias" })
    .click();
  await expect(firstPage(page).locator('[data-kind="redaction"]')).toHaveCount(
    1,
  );
  await options
    .getByRole("button", { name: /Aplicar borrado|Apply redaction/ })
    .click();
  return page.getByRole("alertdialog");
}

/** Values of what pdf.js returns as a Map or as an object. */
const valuesOf = (o: object | null): unknown[] =>
  o instanceof Map ? [...o.values()] : Object.values(o ?? {});

/** Where the secret still is, by every reader. */
async function whereIs(bytes: Uint8Array) {
  const where: string[] = [];
  const pdf = await openPdf(bytes);
  const p = await pdf.getPage(1);
  const text = (await p.getTextContent()).items
    .map((i) => ("str" in i ? i.str : ""))
    .join(" ");
  if (text.includes(SECRET)) where.push("pdf.js text");
  if (JSON.stringify(await p.getAnnotations()).includes(SECRET))
    where.push("pdf.js annotations");
  if (JSON.stringify((await pdf.getOutline()) ?? []).includes(SECRET))
    where.push("pdf.js outline");
  const files = await pdf.getAttachments();
  for (const [id, f] of files ?? []) {
    const content = f.content ?? (await pdf.getAttachmentContent(id));
    if (`${f.filename} ${Buffer.from(content ?? [])}`.includes(SECRET))
      where.push("pdf.js attachments");
  }
  const meta = await pdf.getMetadata();
  if (
    JSON.stringify(meta.info).includes(SECRET) ||
    (meta.metadata && String(meta.metadata.getRaw()).includes(SECRET))
  )
    where.push("pdf.js metadata");
  const fields = await pdf.getFieldObjects();
  if (JSON.stringify(valuesOf(fields)).includes(SECRET))
    where.push("pdf.js fields");
  await pdf.loadingTask.destroy();

  const dir = await mkdtemp(join(tmpdir(), "pdfcraft-"));
  const file = join(dir, "out.pdf");
  await writeFile(file, bytes);
  if (PDFTOTEXT) {
    const { stdout } = await run(PDFTOTEXT, [file, "-"]);
    if (stdout.includes(SECRET)) where.push("pdftotext");
  }
  if (QPDF) {
    await run(QPDF, ["--check", file]);
    const { stdout } = await run(
      QPDF,
      ["--qdf", "--object-streams=disable", "--decode-level=all", file, "-"],
      { encoding: "latin1", maxBuffer: 64 << 20 },
    );
    const upper = stdout.toUpperCase();
    const hex = Buffer.from(SECRET, "latin1").toString("hex").toUpperCase();
    const utf16 = Buffer.from(SECRET, "utf16le")
      .swap16()
      .toString("hex")
      .toUpperCase();
    if (stdout.includes(SECRET) || upper.includes(hex) || upper.includes(utf16))
      where.push("qpdf decompressed");
  }
  return where;
}

test("by default the data goes from the whole file, after saying where it was", async ({
  page,
}) => {
  expect(QPDF, "qpdf is needed").toBeTruthy();
  await openMade(page);
  const dialog = await markAndOpen(page);
  const list = dialog.locator(".redact-elsewhere li");
  await expect(list).toHaveText([
    "1 nota o comentario",
    "1 marcador",
    "1 archivo adjunto",
    "1 campo de formulario",
  ]);
  const remove = dialog.getByRole("checkbox", {
    name: "Quitar también estas apariciones",
  });
  await expect(remove).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: /metadatos/ }),
  ).toBeChecked();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.screenshot({ path: `${DIR}/otras-apariciones-es.png` });

  // Without the metadata box, the metadata is listed too.
  await dialog.getByRole("checkbox", { name: /metadatos/ }).uncheck();
  await expect(list.last()).toHaveText(/4 datos de los metadatos/);
  await dialog.getByRole("checkbox", { name: /metadatos/ }).check();

  await dialog.getByRole("button", { name: "Aplicar borrado" }).click();
  await expect(dialog).toBeHidden();
  const { bytes } = await saveAndRead(page);
  expect(await whereIs(bytes)).toEqual([]);
  // The rest is still there.
  const pdf = await openPdf(bytes);
  const text = (await (await pdf.getPage(1)).getTextContent()).items
    .map((i) => ("str" in i ? i.str : ""))
    .join(" ");
  expect(text).toContain("VISIBLE-3333");
  expect(JSON.stringify(await pdf.getOutline())).toContain("Anexo");
  await pdf.loadingTask.destroy();
});

test("left unchecked, the dialog warns and the data stays outside the areas", async ({
  page,
}) => {
  await openMade(page);
  const dialog = await markAndOpen(page);
  const remove = dialog.getByRole("checkbox", {
    name: "Quitar también estas apariciones",
  });
  await remove.uncheck();
  await expect(dialog.getByRole("alert")).toHaveText(
    /seguirá en el archivo guardado/,
  );
  await dialog.screenshot({ path: `${DIR}/otras-apariciones-aviso-es.png` });
  await dialog.getByRole("button", { name: "Aplicar borrado" }).click();
  const { bytes } = await saveAndRead(page);
  const where = await whereIs(bytes);
  expect(where).not.toContain("pdf.js text");
  expect(where).not.toContain("pdf.js metadata");
  expect(where).toEqual(
    expect.arrayContaining([
      "pdf.js annotations",
      "pdf.js outline",
      "pdf.js attachments",
      "pdf.js fields",
      // The field shows its value on the page.
      "pdftotext",
      "qpdf decompressed",
    ]),
  );
});

test("in English", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("inkognitopdf.lang", "en"),
  );
  await openMade(page);
  const dialog = await markAndOpen(page, true);
  await expect(dialog.locator(".redact-elsewhere li")).toHaveText([
    "1 note or comment",
    "1 bookmark",
    "1 attached file",
    "1 form field",
  ]);
  await expect(
    dialog.getByRole("checkbox", { name: "Also remove these occurrences" }),
  ).toBeChecked();
  await dialog.screenshot({ path: `${DIR}/otras-apariciones-en.png` });
  await dialog
    .getByRole("checkbox", { name: "Also remove these occurrences" })
    .uncheck();
  await expect(dialog.getByRole("alert")).toHaveText(/stays in the saved file/);
  await dialog.screenshot({ path: `${DIR}/otras-apariciones-aviso-en.png` });
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the list and the boxes fit and are easy to touch", async ({ page }) => {
    await openMade(page);
    const bar = page.getByRole("navigation", {
      name: "Categorías de herramientas",
    });
    await bar.getByRole("button", { name: "Editar" }).click();
    await page
      .getByRole("dialog", { name: "Editar" })
      .getByRole("button", { name: "Borrado seguro" })
      .click();
    const options = page.locator(".mobile-options");
    await options.getByRole("searchbox").fill(SECRET);
    await options.getByRole("button", { name: "Marcar coincidencias" }).click();
    await options.getByRole("button", { name: /Aplicar borrado/ }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.locator(".redact-elsewhere li")).toHaveCount(4);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    for (const control of [
      ...(await dialog.locator("label.toolbar-check").all()),
      ...(await dialog.getByRole("button").all()),
    ])
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
        43.5,
      );
    await page.screenshot({ path: `${DIR}/otras-apariciones-movil.png` });
  });
});
