// Spec 001, phase 4: editing tools through the UI (T013–T018).
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  OPS,
  firstPage,
  makePng,
  openFixture,
  openPdf,
  saveAndRead,
  textRuns,
} from "./helpers";

const A4_HEIGHT = 841.89;

const tool = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Herramientas de edición" })
    .getByRole("button", { name, exact: true });

async function dragOn(
  page: Page,
  target: Locator,
  points: { x: number; y: number }[],
) {
  const box = (await target.boundingBox())!;
  const [first, ...rest] = points;
  await page.mouse.move(box.x + first!.x, box.y + first!.y);
  await page.mouse.down();
  for (const p of rest)
    await page.mouse.move(box.x + p.x, box.y + p.y, { steps: 4 });
  await page.mouse.up();
}

/** Size and origin of each image drawn on a page, from its operator list. */
async function imagePlacements(bytes: Uint8Array) {
  const doc = await openPdf(bytes);
  const ops = await (await doc.getPage(1)).getOperatorList();
  type M = [number, number, number, number, number, number];
  const mul = (m: M, n: M): M => [
    n[0] * m[0] + n[1] * m[2],
    n[0] * m[1] + n[1] * m[3],
    n[2] * m[0] + n[3] * m[2],
    n[2] * m[1] + n[3] * m[3],
    n[4] * m[0] + n[5] * m[2] + m[4],
    n[4] * m[1] + n[5] * m[3] + m[5],
  ];
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  const images: { x: number; y: number; width: number; height: number }[] = [];
  ops.fnArray.forEach((fn, i) => {
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i] as M);
    else if (fn === OPS.paintImageXObject)
      images.push({
        x: ctm[4],
        y: ctm[5],
        width: Math.hypot(ctm[0], ctm[1]),
        height: Math.hypot(ctm[2], ctm[3]),
      });
  });
  await doc.loadingTask.destroy();
  return images;
}

test("CA2: text typed on the page is saved as real text where it was placed", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await tool(page, "Texto").click();
  await page.getByLabel("Fuente").selectOption("Times");
  await page.getByLabel("Tamaño").fill("18");
  await page.getByLabel("Color del texto").fill("#cc0000");

  await firstPage(page).click({ position: { x: 100, y: 200 } });
  await page.keyboard.type("Hola desde pdfcraft");
  await page.keyboard.press("Control+Enter");
  const item = firstPage(page).locator(".item-text");
  await expect(item).toHaveText("Hola desde pdfcraft");

  // Clicking the text with the text tool edits it.
  await item.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Hola de nuevo");
  await page.keyboard.press("Control+Enter");
  await expect(item).toHaveText("Hola de nuevo");

  const { bytes } = await saveAndRead(page);
  const run = (await textRuns(bytes)).find((r) => r.str === "Hola de nuevo");
  expect(run).toBeDefined();
  // Baseline: click y plus the preview's baseline offset (font size 18, line height 1.2).
  const baseline = (21.6 - 1.15 * 18) / 2 + 0.905 * 18;
  expect(run!.x).toBeCloseTo(100, 0);
  expect(Math.abs(run!.y - (A4_HEIGHT - 200 - baseline))).toBeLessThan(1);
  expect(run!.size).toBeCloseTo(18, 1);
  expect(run!.fontFamily).toBe("serif");

  const doc = await openPdf(bytes);
  const ops = await (await doc.getPage(1)).getOperatorList();
  const colors = ops.fnArray
    .map((fn, i) => (fn === OPS.setFillRGBColor ? ops.argsArray[i] : null))
    .filter(Boolean)
    .map(String);
  expect(
    colors.some((c) => c.toLowerCase().includes("cc0000") || c === "204,0,0"),
  ).toBe(true);
  await doc.loadingTask.destroy();
});

test("CA5: images keep their aspect ratio when placed, moved and resized", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await page.getByTestId("image-input").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: makePng(4, 2),
  });
  await expect(tool(page, "Imagen")).toHaveAttribute("aria-pressed", "true");
  await firstPage(page).click({ position: { x: 100, y: 300 } });

  const image = firstPage(page).locator(".item-image");
  await expect(image).toHaveCount(1);
  let box = (await image.boundingBox())!;
  expect(box.width).toBeCloseTo(150, 0);
  expect(box.height).toBeCloseTo(75, 0);

  // Resize from the corner handle: the aspect ratio is kept.
  await dragOn(page, page.getByTestId("resize-handle"), [
    { x: 6, y: 6 },
    { x: 56, y: 6 },
  ]);
  box = (await image.boundingBox())!;
  expect(box.width).toBeCloseTo(200, 0);
  expect(box.height).toBeCloseTo(100, 0);

  // Move it.
  await dragOn(page, image, [
    { x: 50, y: 50 },
    { x: 80, y: 90 },
  ]);

  const { bytes } = await saveAndRead(page);
  const [placed] = await imagePlacements(bytes);
  expect(placed).toBeDefined();
  expect(placed!.width / placed!.height).toBeCloseTo(2, 2);
  expect(placed!.width).toBeCloseTo(200, 0);
  expect(Math.abs(placed!.x - 130)).toBeLessThan(1);
  expect(Math.abs(placed!.y - (A4_HEIGHT - 340 - 100))).toBeLessThan(1);
});

test("CA6: whiteout warns that it is not a redaction and keeps the text in the file", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await tool(page, "Blanqueo").click();
  await expect(page.getByRole("note")).toContainText(
    "no es una redacción segura",
  );
  const line = firstPage(page).locator(".textLayer span", {
    hasText: "El rapido zorro",
  });
  const lineBox = (await line.boundingBox())!;
  const pageBox = (await firstPage(page).boundingBox())!;
  const top = lineBox.y - pageBox.y - 4;
  await dragOn(page, firstPage(page), [
    { x: lineBox.x - pageBox.x - 4, y: top },
    {
      x: lineBox.x - pageBox.x + lineBox.width + 4,
      y: top + lineBox.height + 8,
    },
  ]);
  const whiteout = firstPage(page).locator(".item-whiteout");
  await expect(whiteout).toHaveCount(1);

  // The new whiteout is selected: Supr removes it and Ctrl+Z brings it back.
  await page.keyboard.press("Delete");
  await expect(whiteout).toHaveCount(0);
  await page.keyboard.press("Control+Z");
  await expect(whiteout).toHaveCount(1);

  const { bytes } = await saveAndRead(page);
  const runs = await textRuns(bytes);
  expect(runs.map((r) => r.str).join(" ")).toContain("El rapido zorro");
  const doc = await openPdf(bytes);
  const ops = await (await doc.getPage(1)).getOperatorList();
  expect(ops.fnArray).toContain(OPS.constructPath);
  await doc.loadingTask.destroy();
});

test("CA4: highlight, drawing, line and shapes are saved as standard annotations", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  const target = firstPage(page);

  await tool(page, "Resaltar").click();
  const line = target.locator(".textLayer span", {
    hasText: "El rapido zorro",
  });
  const box = (await line.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(target.locator('.item[data-kind="annotation"]')).toHaveCount(1);

  await tool(page, "Dibujar").click();
  await dragOn(page, target, [
    { x: 100, y: 400 },
    { x: 140, y: 380 },
    { x: 180, y: 420 },
  ]);
  await tool(page, "Línea").click();
  await dragOn(page, target, [
    { x: 100, y: 500 },
    { x: 300, y: 500 },
  ]);
  await tool(page, "Rectángulo").click();
  await dragOn(page, target, [
    { x: 300, y: 550 },
    { x: 380, y: 600 },
  ]);
  await tool(page, "Elipse").click();
  await dragOn(page, target, [
    { x: 400, y: 550 },
    { x: 480, y: 600 },
  ]);
  await expect(target.locator('.item[data-kind="annotation"]')).toHaveCount(5);

  const { bytes } = await saveAndRead(page);
  const doc = await openPdf(bytes);
  const annotations = await (await doc.getPage(1)).getAnnotations();
  expect(annotations.map((a) => a.subtype).sort()).toEqual([
    "Circle",
    "Highlight",
    "Ink",
    "Line",
    "Square",
  ]);
  const highlight = annotations.find((a) => a.subtype === "Highlight")!;
  const [, y0, , y1] = highlight.rect as number[];
  // The paragraph's baseline is at y = 730 (12 pt).
  expect(y0!).toBeLessThan(731);
  expect(y1!).toBeGreaterThan(738);
  await doc.loadingTask.destroy();
});

test("CA7: page actions rotate, insert, reorder and delete pages", async ({
  page,
}) => {
  await openFixture(page, "two-pages.pdf");
  await page
    .getByRole("button", { name: "Girar a la derecha la página 2" })
    .click();
  await page
    .getByRole("button", {
      name: "Insertar una página en blanco después de la página 1",
    })
    .click();
  await expect(page.locator(".thumbnail")).toHaveCount(3);
  await page.getByRole("button", { name: "Subir la página 3" }).click();
  await page.getByRole("button", { name: "Eliminar la página 1" }).click();
  await expect(page.locator(".thumbnail")).toHaveCount(2);
  await expect(page.locator(".page-indicator")).toHaveText("Página 1 de 2");

  // The rotated page is now first and shows in landscape.
  const first = (await firstPage(page).boundingBox())!;
  expect(first.width).toBeGreaterThan(first.height);

  const { bytes } = await saveAndRead(page);
  const doc = await openPdf(bytes);
  expect(doc.numPages).toBe(2);
  expect((await doc.getPage(1)).rotate).toBe(90);
  await doc.loadingTask.destroy();
  expect((await textRuns(bytes, 1)).map((r) => r.str).join(" ")).toContain(
    "Pagina 2 de 2",
  );
  expect(await textRuns(bytes, 2)).toEqual([]);
});

test("CA8: at least 50 steps can be undone and redone", async ({ page }) => {
  await openFixture(page, "simple-text.pdf");
  const rotate = page.getByRole("button", {
    name: "Girar a la derecha la página 1",
  });
  const undo = page.getByRole("button", { name: "Deshacer" });
  const redo = page.getByRole("button", { name: "Rehacer" });
  const isLandscape = async () => {
    const box = (await firstPage(page).boundingBox())!;
    return box.width > box.height;
  };

  for (let i = 0; i < 51; i++) await rotate.click(); // 51 × 90° = 270°
  expect(await isLandscape()).toBe(true);
  for (let i = 0; i < 50; i++) await page.keyboard.press("Control+Z");
  await expect.poll(isLandscape).toBe(true); // one step left: 90°
  await undo.click();
  await expect.poll(isLandscape).toBe(false);
  await expect(undo).toBeDisabled();

  for (let i = 0; i < 51; i++) await redo.click();
  await expect(redo).toBeDisabled();
  await expect.poll(isLandscape).toBe(true);
});

test("T018: a blank document can be written on and saved", async ({ page }) => {
  await page.goto("/app/");
  await page
    .getByRole("button", { name: "Documento en blanco" })
    .first()
    .click();
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await tool(page, "Texto").click();
  await firstPage(page).click({ position: { x: 60, y: 60 } });
  await page.keyboard.type("Documento nuevo");
  await page.keyboard.press("Control+Enter");
  const { name, bytes } = await saveAndRead(page);
  expect(name).toBe("documento.pdf");
  expect((await textRuns(bytes)).map((r) => r.str)).toContain(
    "Documento nuevo",
  );
});

test("CA3: existing text is replaced through the edit-text tool", async ({
  page,
}) => {
  await openFixture(page, "simple-text.pdf");
  await tool(page, "Editar texto").click();
  const original = "El rapido zorro marron salta sobre el perro perezoso.";
  const span = firstPage(page).locator(".textLayer span", {
    hasText: "El rapido zorro",
  });
  const box = (await span.boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + box.height / 2);

  const editor = page.getByRole("textbox", { name: "Texto", exact: true });
  await expect(editor).toHaveValue(original);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Texto cambiado en pdfcraft");
  await page.keyboard.press("Control+Enter");
  // The page is shown as the engine will save it, without a white box.
  await expect(firstPage(page).locator("img.page-edited")).toBeVisible();
  await expect(firstPage(page).locator(".item-textEdit-text")).toHaveCount(0);
  await expect(firstPage(page).locator(".item-textEdit")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  // Undo and redo work on the edit like on any other operation.
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(firstPage(page).locator(".item-textEdit")).toHaveCount(0);
  await page.getByRole("button", { name: "Rehacer" }).click();
  await expect(firstPage(page).locator(".item-textEdit")).toHaveCount(1);

  const { bytes } = await saveAndRead(page);
  const runs = await textRuns(bytes);
  expect(runs.map((r) => r.str)).not.toContain(original);
  const added = runs.find((r) => r.str === "Texto cambiado en pdfcraft")!;
  expect(added.x).toBeCloseTo(56, 0);
  expect(added.y).toBeCloseTo(730, 0);
  expect(added.size).toBeCloseTo(12, 1);
  expect(runs.map((r) => r.str)).toContain("Documento de prueba pdfcraft");
  // Spec 009: a short confirmation that goes away by itself.
  await expect(page.getByTestId("toast")).toHaveText("Guardado.");
  await expect(page.getByTestId("toast")).toHaveCount(0, { timeout: 5000 });
});

test("CA3b: the edit preview shows the original font, color and weight", async ({
  page,
}) => {
  await openFixture(page, "text-operators.pdf");
  await tool(page, "Editar texto").click();
  const red = firstPage(page).locator(".textLayer span", {
    hasText: "r o j o",
  });
  const box = (await red.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const editor = page.getByRole("textbox", { name: "Texto", exact: true });
  await expect(editor).toHaveValue("r o j o");
  // The color is read from the content stream, after the click.
  await expect(editor).toHaveCSS("color", "rgb(204, 0, 0)");
  const family = await editor.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toMatch(/^"?g_.*Arimo/);
  await page.keyboard.press("Escape");

  await openFixture(page, "simple-text.pdf");
  await tool(page, "Editar texto").click();
  const title = firstPage(page).locator(".textLayer span", {
    hasText: "Documento de prueba",
  });
  const t = (await title.boundingBox())!;
  await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
  await expect(editor).toHaveCSS("font-weight", "700");
  await expect(editor).toHaveCSS("color", "rgb(0, 0, 0)");
});
