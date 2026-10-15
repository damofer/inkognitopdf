// Bold text stays bold when edited, even when its font is a subset that
// lacks the new letters and whose name says nothing of its weight.
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { anonymousBoldPdf } from "./anonymousBoldPdf";
import { firstPage, saveAndRead } from "./helpers";

async function open(page: Page, bytes: Uint8Array) {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles({
    name: "cuenta.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(bytes),
  });
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
}

/** Names of the fonts of the first page of a saved PDF. */
async function fontNames(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const fonts = doc.getPage(0).node.normalizedEntries().Font;
  return fonts
    ? fonts
        .keys()
        .map((key) => fonts.lookup(key))
        .map((font) =>
          String(font?.toString().match(/\/BaseFont \/(\S+)/)?.[1]),
        )
    : [];
}

for (const [label, program] of [
  ["the font program says bold", true],
  ["only the strokes show it", false],
] as const) {
  test(`edited bold text stays bold: ${label}`, async ({ page }) => {
    await open(page, await anonymousBoldPdf(program));
    await page
      .getByRole("group", { name: "Herramientas de edición" })
      .getByRole("button", { name: "Editar texto", exact: true })
      .click();
    const title = firstPage(page).locator(".textLayer span", {
      hasText: "Resumen de la cuenta",
    });
    const box = (await title.boundingBox())!;
    await page.mouse.click(box.x + 20, box.y + box.height / 2);
    const editor = page.getByRole("textbox", { name: "Texto", exact: true });
    await expect(editor).toHaveValue("Resumen de la cuenta");
    // The preview is bold (read after the click, from the font or the pixels).
    await expect(editor).toHaveCSS("font-weight", "700");
    await page.keyboard.press("Control+A");
    // Q, X and Z are not in the subset.
    await page.keyboard.type("Resumen QXZ de la cuenta");
    await page.keyboard.press("Control+Enter");
    await expect(firstPage(page).locator("img.page-edited")).toBeVisible();

    const { bytes } = await saveAndRead(page);
    const names = await fontNames(bytes);
    expect(names.some((n) => /Arimo-Bold$/.test(n))).toBe(true);
    expect(names.some((n) => /Arimo-Regular$/.test(n))).toBe(false);
  });
}
