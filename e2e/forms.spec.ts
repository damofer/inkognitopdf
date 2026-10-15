// Spec 005: forms and annotations through the UI.
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  decodePDFRawStream,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "pdf-lib";
import {
  firstPage,
  openFixture,
  openPdf,
  saveAndRead,
  textRuns,
} from "./helpers";

const FIXTURE = "forms-annotations.pdf";
const A4 = { width: 595.28, height: 841.89 };

const tool = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Herramientas de edición" })
    .getByRole("button", { name, exact: true });

const secondPage = async (page: Page) => {
  const target = page.locator('.page[data-page-number="2"]');
  await target.scrollIntoViewIfNeeded();
  await expect(target).toHaveAttribute("data-rendered", "true");
  return target;
};

/** Screen point of a PDF point of a page (no rotation). */
async function at(target: Locator, x: number, y: number) {
  const box = (await target.boundingBox())!;
  const scale = box.width / A4.width;
  return { x: box.x + x * scale, y: box.y + (A4.height - y) * scale };
}

async function dragPdf(
  page: Page,
  target: Locator,
  from: [number, number],
  to: [number, number],
) {
  const a = await at(target, ...from);
  const b = await at(target, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

async function clickPdf(page: Page, target: Locator, x: number, y: number) {
  const p = await at(target, x, y);
  await page.mouse.click(p.x, p.y);
}

/** Selects a whole text line of the page with a text tool. */
async function markLine(page: Page, target: Locator, text: string) {
  const line = target.locator(".textLayer span", { hasText: text });
  const box = (await line.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
}

async function annotationsOf(bytes: Uint8Array, pageNumber: number) {
  const doc = await openPdf(bytes);
  const list = await (await doc.getPage(pageNumber)).getAnnotations();
  await doc.loadingTask.destroy();
  return list;
}

test("CA1–CA3: fields are filled on the page and keep their font, size and color", async ({
  page,
}) => {
  await openFixture(page, FIXTURE);
  const target = firstPage(page);
  const nombre = target.getByRole("textbox", { name: "nombre" });
  await expect(nombre).toHaveValue("Valor inicial");
  await nombre.fill("Ana María");
  await nombre.press("Enter");
  await target.getByRole("textbox", { name: "codigo" }).fill("AB-12");
  await target.getByRole("textbox", { name: "comentarios" }).fill("Uno\nDos");
  await target.getByRole("checkbox", { name: "acepto" }).click();
  await expect(
    target.getByRole("checkbox", { name: "acepto" }),
  ).toHaveAttribute("aria-checked", "true");
  await target.getByRole("radio", { name: "talla" }).nth(1).click();
  await target.getByRole("combobox", { name: "pais" }).selectOption("Peru");
  await target.getByRole("listbox", { name: "colores" }).selectOption("Verde");
  // Focus out of the last control commits it.
  await page.locator(".app-header").click({ position: { x: 2, y: 2 } });

  const { bytes } = await saveAndRead(page);
  const saved = await PDFDocument.load(bytes);
  const form = saved.getForm();
  const nombreField = form.getField("nombre") as PDFTextField;
  expect(nombreField.getText()).toBe("Ana María");
  // The field keeps its default appearance: Times 14 pt, dark red.
  expect(nombreField.acroField.getDefaultAppearance()).toBe(
    "0.8 0.1 0.1 rg\n/Times-Roman 14 Tf",
  );
  expect((form.getField("codigo") as PDFTextField).getText()).toBe("AB-12");
  expect((form.getField("comentarios") as PDFTextField).getText()).toBe(
    "Uno\nDos",
  );
  expect((form.getField("acepto") as PDFCheckBox).isChecked()).toBe(true);
  expect((form.getField("talla") as PDFRadioGroup).getSelected()).toBe("M");
  expect((form.getField("pais") as PDFDropdown).getSelected()).toEqual([
    "Peru",
  ]);
  expect((form.getField("colores") as PDFOptionList).getSelected()).toEqual([
    "Verde",
  ]);

  // The saved appearance of the name uses Times at 14 pt.
  const ap = saved.context.lookup(
    nombreField.acroField.getWidgets()[0]!.getNormalAppearance(),
  );
  if (!(ap instanceof PDFRawStream)) throw new Error("no appearance");
  const content = new TextDecoder().decode(decodePDFRawStream(ap).decode());
  expect(content).toMatch(/\/(\S+) 14 Tf/);
  const fontName = content.match(/\/(\S+) 14 Tf/)![1]!;
  const fonts = ap.dict
    .lookup(PDFName.of("Resources"), PDFDict)
    .lookup(PDFName.of("Font"), PDFDict);
  const font = fonts.lookup(PDFName.of(fontName), PDFDict);
  expect(String(font.get(PDFName.of("BaseFont")))).toBe("/Times-Roman");
  // Colors go through #rrggbb: 0.1 is written as 0.102.
  expect(content).toMatch(/0\.8 0\.10\d* 0\.10\d* rg/);
});

test("CA1: filling a field can be undone", async ({ page }) => {
  await openFixture(page, FIXTURE);
  const target = firstPage(page);
  await target.getByRole("checkbox", { name: "acepto" }).click();
  const box = target.getByRole("checkbox", { name: "acepto" });
  await expect(box).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(box).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(box).toHaveAttribute("aria-checked", "true");
});

test("CA5: fields created on the page are saved as AcroForm fields", async ({
  page,
}) => {
  await openFixture(page, FIXTURE);
  const target = firstPage(page);
  await tool(page, "Campos").click();
  await page.getByLabel("Tipo de campo").selectOption("text");
  await page.getByLabel("Fuente del campo").selectOption("Courier");
  await page.getByLabel("Tamaño del campo").selectOption("12");
  await clickPdf(page, target, 380, 690);
  await expect(target.locator('.item[data-kind="formField"]')).toHaveCount(1);
  const name = page
    .getByRole("group", { name: "Propiedades del campo" })
    .getByLabel("Nombre");
  await expect(name).toHaveValue("texto_1");
  await name.fill("apellido");
  await name.press("Enter");
  await expect(target.locator(".form-field-label")).toHaveText("apellido");

  // A name already in use is not accepted.
  await name.fill("nombre");
  await name.press("Enter");
  await expect(name).toHaveValue("apellido");

  await page.getByLabel("Tipo de campo").selectOption("checkbox");
  await clickPdf(page, target, 380, 500);
  await page.getByLabel("Tipo de campo").selectOption("dropdown");
  await clickPdf(page, target, 400, 430);
  await expect(target.locator('.item[data-kind="formField"]')).toHaveCount(3);

  // With the select tool the new field is filled like the others.
  await tool(page, "Seleccionar").click();
  await target.getByRole("textbox", { name: "apellido" }).fill("Pérez");
  await page.locator(".app-header").click({ position: { x: 2, y: 2 } });

  const { bytes } = await saveAndRead(page);
  const form = (await PDFDocument.load(bytes)).getForm();
  const names = form.getFields().map((f) => f.getName());
  expect(names).toEqual(
    expect.arrayContaining(["apellido", "casilla_1", "lista_desplegable_1"]),
  );
  const created = form.getField("apellido") as PDFTextField;
  expect(created.getText()).toBe("Pérez");
  expect(created.acroField.getDefaultAppearance()).toMatch(/\/Cour 12 Tf/);
  expect(
    (form.getField("lista_desplegable_1") as PDFDropdown).getOptions(),
  ).toEqual(["Opción 1", "Opción 2", "Opción 3"]);
});

test("CA6: flattening turns the fields into page content", async ({ page }) => {
  await openFixture(page, FIXTURE);
  const target = firstPage(page);
  await target.getByRole("textbox", { name: "codigo" }).fill("PLANO-7");
  await page.locator(".app-header").click({ position: { x: 2, y: 2 } });
  await page.getByLabel("Aplanar formulario").check();

  const { bytes } = await saveAndRead(page);
  const doc = await PDFDocument.load(bytes);
  expect(doc.getForm().getFields()).toHaveLength(0);
  const strings = (await textRuns(bytes)).map((r) => r.str).join(" ");
  expect(strings).toContain("PLANO-7");
  expect(strings).toContain("Valor inicial");
  expect(await annotationsOf(bytes, 1)).toHaveLength(0);
});

test("CA7: underline, strikeout, note, free text and arrow are saved as annotations", async ({
  page,
}) => {
  await openFixture(page, FIXTURE);
  const target = await secondPage(page);

  await tool(page, "Subrayar").click();
  await markLine(page, target, "Segunda linea");
  await tool(page, "Tachar").click();
  await markLine(page, target, "Tercera linea");

  await tool(page, "Nota").click();
  await clickPdf(page, target, 480, 760);
  const note = page.getByRole("textbox", { name: "Texto de la nota" });
  await note.fill("Revisar esta línea");
  await note.press("Control+Enter");

  await tool(page, "Texto libre").click();
  await clickPdf(page, target, 330, 400);
  const free = page.getByRole("textbox", { name: "Texto libre" });
  await free.fill("Comentario libre");
  await page.locator(".app-header").click({ position: { x: 2, y: 2 } });

  await tool(page, "Flecha").click();
  await dragPdf(page, target, [100, 300], [300, 340]);

  await expect(target.locator('.item[data-kind="annotation"]')).toHaveCount(5);

  const { bytes } = await saveAndRead(page);
  const annots = await annotationsOf(bytes, 2);
  const added = annots.filter((a) => a.titleObj?.str !== "Generador");
  expect(added.map((a) => a.subtype).sort()).toEqual([
    "FreeText",
    "Line",
    "StrikeOut",
    "Text",
    "Underline",
  ]);
  expect(added.find((a) => a.subtype === "Text")!.contentsObj.str).toBe(
    "Revisar esta línea",
  );
  expect(added.find((a) => a.subtype === "FreeText")!.contentsObj.str).toBe(
    "Comentario libre",
  );
  const arrow = added.find((a) => a.subtype === "Line")!;
  expect(arrow.lineEndings).toEqual(["None", "OpenArrow"]);
  // The underline sits on the second line (baseline y = 730).
  const [, y0, , y1] = added.find((a) => a.subtype === "Underline")!
    .rect as number[];
  expect(y0!).toBeLessThan(731);
  expect(y1!).toBeGreaterThan(737);
});

test("CA8: annotations of the file are moved, recolored and deleted", async ({
  page,
}) => {
  await openFixture(page, FIXTURE);
  const target = await secondPage(page);
  const existing = (subtype: string) =>
    target.locator(`.item-existing[data-subtype="${subtype}"]`);
  await expect(existing("Square")).toHaveCount(1);

  // Recolor the square.
  await existing("Square").click();
  await page.getByLabel("Color del trazo").fill("#ff0000");
  // Move the circle 40 pt to the right.
  await dragPdf(page, target, [241, 460], [281, 460]);
  // Delete the ink drawing and the stamp (which pdfcraft cannot redraw).
  await existing("Ink").click();
  await page.keyboard.press("Delete");
  await expect(existing("Ink")).toHaveCount(0);
  await existing("Stamp").click();
  await page.keyboard.press("Delete");
  await expect(existing("Stamp")).toHaveCount(0);
  // Undo brings the stamp back.
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(existing("Stamp")).toHaveCount(1);

  const { bytes } = await saveAndRead(page);
  const annots = await annotationsOf(bytes, 2);
  const subtypes = annots.map((a) => a.subtype).sort();
  expect(subtypes).not.toContain("Ink");
  expect(subtypes).toEqual(
    expect.arrayContaining([
      "Circle",
      "FreeText",
      "Highlight",
      "Square",
      "Stamp",
      "Text",
    ]),
  );
  const square = annots.find((a) => a.subtype === "Square")!;
  expect(Array.from(square.color as Uint8ClampedArray)).toEqual([255, 0, 0]);
  // Changed annotations keep their author and the note keeps its text.
  expect(square.titleObj.str).toBe("Generador");
  const circle = annots.find((a) => a.subtype === "Circle")!;
  expect((circle.rect as number[])[0]).toBeGreaterThan(270);
  expect(annots.find((a) => a.subtype === "Text")!.contentsObj.str).toBe(
    "nota existente",
  );
});
