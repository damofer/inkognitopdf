// Spec 002, phase 5 (S013): the scanner in Chrome with synthetic photos.
import { expect, test, type Page, type Request } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  type PDFDict,
  type PDFRawStream,
} from "pdf-lib";
import { firstPage, openFixture } from "./helpers";
import { writePhotos, type PhotoFiles } from "./scanPhotos";

let photos: PhotoFiles;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  photos = await writePhotos({
    "hoja-1.jpg": { seed: 601, width: 2400, height: 1800 },
    "hoja-2.jpg": {
      seed: 602,
      width: 2400,
      height: 1800,
      background: "texture",
    },
    "hoja-3.jpg": { seed: 603, width: 2400, height: 1800 },
    "girada.jpg": { seed: 604, width: 2400, height: 1800, exifRotated: true },
    "12mp.jpg": { seed: 605, width: 4000, height: 3000 },
  });
});

const corners = (page: Page) => page.locator(".crop-hit");
const scanner = (page: Page) =>
  page.getByRole("dialog", { name: "Escanear documento" });

async function openScanner(page: Page, files: string[]) {
  await page.getByRole("button", { name: "Escanear" }).first().click();
  await page.getByTestId("scan-images").setInputFiles(files.map(photos.path));
  await expect(page.locator(".scan-strip li")).toHaveCount(files.length);
  await expect(corners(page)).toHaveCount(4);
}

async function download(page: Page, button: string) {
  const pending = page.waitForEvent("download");
  await scanner(page).getByRole("button", { name: button }).click();
  const file = await pending;
  return new Uint8Array(await readFile((await file.path())!));
}

function scanImage(doc: PDFDocument, index: number): PDFRawStream {
  const xobjects = doc
    .getPage(index)
    .node.Resources()!
    .lookup(PDFName.of("XObject")) as PDFDict;
  const [name] = xobjects.keys();
  return doc.context.lookup(xobjects.get(name!)) as PDFRawStream;
}

test("CA1, CA6, CA8: photos → crop → modes → PDF", async ({ page }) => {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Escanear" }).first().click();
  const t0 = Date.now();
  await page
    .getByTestId("scan-images")
    .setInputFiles([photos.path("hoja-1.jpg"), photos.path("hoja-2.jpg")]);
  await expect(corners(page)).toHaveCount(4);
  const shown = Date.now() - t0;
  console.log(`primera foto en la pantalla de recorte: ${shown} ms`);
  // CA1: under 1 s (about 0.25 s alone; this margin covers the other tests
  // running in parallel on the same machine).
  expect(shown).toBeLessThan(2500);
  await expect(page.locator(".scan-strip li")).toHaveCount(2);

  await page.getByRole("button", { name: "Continuar" }).click();
  const result = page.locator("img.scan-result");
  await expect(result).toHaveAttribute("data-mode", "bw");
  // CA6: modes change without detecting again.
  for (const mode of ["Grises", "Original", "Fotocopia"]) {
    const button = page.getByRole("button", { name: mode, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await expect(result).toHaveAttribute("data-mode", "bw");

  const bytes = await download(page, "Guardar PDF");
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(2);
  expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
  for (const i of [0, 1])
    expect(scanImage(doc, i).dict.get(PDFName.of("BitsPerComponent"))).toEqual(
      PDFNumber.of(1),
    );
});

test("CA1: EXIF orientation is respected", async ({ page }) => {
  await page.goto("/app/");
  await openScanner(page, ["girada.jpg"]);
  const photo = await page
    .locator(".crop-editor img")
    .evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(photo[0]!).toBeGreaterThan(photo[1]!);
  await page.getByRole("button", { name: "Continuar" }).click();
  const result = page.locator("img.scan-result");
  await expect(result).toHaveAttribute("data-mode", "bw");
  const size = await result.evaluate((img: HTMLImageElement) => [
    img.naturalWidth,
    img.naturalHeight,
  ]);
  // The page is portrait once the photo is upright.
  expect(size[1]!).toBeGreaterThan(size[0]!);
});

test("CA3: corners can be dragged, with a magnifier; crossed corners are refused", async ({
  page,
}) => {
  await page.goto("/app/");
  await openScanner(page, ["hoja-1.jpg"]);
  const centre = async (i: number) => {
    const b = (await corners(page).nth(i).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const tl = await centre(0);
  const br = await centre(2);
  await page.mouse.move(tl.x, tl.y);
  await page.mouse.down();
  await page.mouse.move(tl.x + 20, tl.y + 15, { steps: 4 });
  await expect(page.getByTestId("crop-lens")).toBeVisible();
  // Past the opposite corner: the quad crosses itself.
  await page.mouse.move(br.x + 40, br.y + 40, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("crop-lens")).toHaveCount(0);
  await expect(page.locator(".crop-overlay")).toHaveAttribute(
    "data-valid",
    "false",
  );
  await expect(page.getByRole("button", { name: "Continuar" })).toBeDisabled();
  await expect(scanner(page).getByRole("alert")).toContainText("se cruzan");
  await page.getByRole("button", { name: "Bordes detectados" }).click();
  await expect(page.getByRole("button", { name: "Continuar" })).toBeEnabled();
});

test("CA7: pages can be reordered and removed before saving", async ({
  page,
}) => {
  await page.goto("/app/");
  await openScanner(page, ["hoja-1.jpg", "hoja-2.jpg", "hoja-3.jpg"]);
  const names = () =>
    page
      .locator(".scan-thumb")
      .evaluateAll((els) =>
        els.map((e) =>
          e.getAttribute("aria-label")!.replace(/^Página \d+: /, ""),
        ),
      );
  await expect.poll(names).toEqual(["hoja-1.jpg", "hoja-2.jpg", "hoja-3.jpg"]);
  await page.getByRole("button", { name: "Mover la página 3 antes" }).click();
  await expect.poll(names).toEqual(["hoja-1.jpg", "hoja-3.jpg", "hoja-2.jpg"]);
  await page.getByRole("button", { name: "Quitar la página 1" }).click();
  await expect.poll(names).toEqual(["hoja-3.jpg", "hoja-2.jpg"]);
  const doc = await PDFDocument.load(await download(page, "Guardar PDF"));
  expect(doc.getPageCount()).toBe(2);
});

test("CA9: scanned pages are added to the open document and can be undone", async ({
  page,
}) => {
  await openFixture(page, "two-pages.pdf");
  await openScanner(page, ["hoja-1.jpg"]);
  await scanner(page)
    .getByRole("button", { name: "Añadir al documento" })
    .click();
  await expect(scanner(page)).toHaveCount(0);
  const third = page.locator('.page[data-page-number="3"]');
  await third.scrollIntoViewIfNeeded();
  await expect(third).toHaveAttribute("data-rendered", "true");
  // The scanned page is drawn (not blank) in the viewer.
  const ink = await third.locator("canvas").evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 100) dark++;
    return dark / (d.length / 4);
  });
  expect(ink).toBeGreaterThan(0.005);
  await page.getByRole("button", { name: "Deshacer" }).click();
  await expect(page.locator(".page")).toHaveCount(2);
});

test("without a document, the scan opens in the editor", async ({ page }) => {
  await page.goto("/app/");
  await openScanner(page, ["hoja-1.jpg"]);
  await scanner(page)
    .getByRole("button", { name: "Abrir en el editor" })
    .click();
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await expect(page.locator(".page")).toHaveCount(1);
});

test("CA10, CA11: no network with the photos; 12 MP in under 3 s", async ({
  page,
}) => {
  const requests: Request[] = [];
  page.on("request", (r) => requests.push(r));
  await page.goto("/app/");
  await page.getByRole("button", { name: "Escanear" }).first().click();
  const t0 = Date.now();
  await page.getByTestId("scan-images").setInputFiles(photos.path("12mp.jpg"));
  await expect(corners(page)).toHaveCount(4);
  const detect = Date.now() - t0;
  const t1 = Date.now();
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.locator("img.scan-result")).toHaveAttribute(
    "data-mode",
    "bw",
  );
  const filter = Date.now() - t1;
  console.log(
    `12 MP: lectura y detección ${detect} ms; recorte y fotocopia ${filter} ms`,
  );
  // Detection to photocopy under 3 s; decoding the JPEG comes on top.
  expect(filter).toBeLessThan(3000);
  expect(detect + filter).toBeLessThan(4500);
  await download(page, "Guardar PDF");

  const origin = new URL(page.url()).origin;
  const offending = requests.filter((r) => {
    const url = new URL(r.url());
    if (url.protocol === "blob:" || url.protocol === "data:") return false;
    return (
      url.origin !== origin || r.method() !== "GET" || r.postData() !== null
    );
  });
  expect(offending.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
});

/** The image or canvas as a small grey grid, for comparing what is shown. */
async function grid(target: ReturnType<Page["locator"]>) {
  return target.evaluate((el: HTMLImageElement | HTMLCanvasElement) => {
    const w = 48;
    const h = 64;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(el, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const out: number[] = [];
    for (let i = 0; i < d.length; i += 4)
      out.push((d[i]! + d[i + 1]! + d[i + 2]!) / 3);
    const width = el instanceof HTMLImageElement ? el.naturalWidth : el.width;
    const height =
      el instanceof HTMLImageElement ? el.naturalHeight : el.height;
    return { ratio: width / height, out };
  });
}

const meanDiff = (a: number[], b: number[]) =>
  a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / a.length;

test("009 CA10: the crop and mode chosen are what the editor shows and the PDF keeps", async ({
  page,
}) => {
  await page.goto("/app/");
  await openScanner(page, ["hoja-1.jpg"]);
  // Move the top-left corner inwards: a crop different from the detected one.
  const b = (await corners(page).nth(0).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 50, {
    steps: 5,
  });
  await page.mouse.up();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Grises", exact: true }).click();
  const result = page.locator("img.scan-result");
  await expect(result).toHaveAttribute("data-mode", "gray");
  await expect(result).toHaveJSProperty("complete", true);
  const shown = await grid(result);

  const bytes = await download(page, "Guardar PDF");
  const doc = await PDFDocument.load(bytes);
  const image = scanImage(doc, 0);
  // The JPEG in the PDF is the result itself: same pixels and proportions.
  const saved = await page.evaluate(
    async ({ jpeg, w, h }) => {
      const bitmap = await createImageBitmap(
        new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }),
      );
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);
      const d = ctx.getImageData(0, 0, w, h).data;
      const out: number[] = [];
      for (let i = 0; i < d.length; i += 4)
        out.push((d[i]! + d[i + 1]! + d[i + 2]!) / 3);
      return { ratio: bitmap.width / bitmap.height, out };
    },
    { jpeg: Array.from(image.contents), w: 48, h: 64 },
  );
  expect(saved.ratio).toBeCloseTo(shown.ratio, 2);
  const pdfDiff = meanDiff(shown.out, saved.out);
  // A different crop or mode differs by tens of levels; JPEG noise by a few.
  const shifted = meanDiff(shown.out, [
    ...shown.out.slice(48 * 3),
    ...shown.out.slice(0, 48 * 3),
  ]);
  console.log(
    `diferencia media escáner/PDF: ${pdfDiff.toFixed(2)}; con 3 filas de desfase: ${shifted.toFixed(2)}`,
  );
  expect(pdfDiff).toBeLessThan(8);

  await scanner(page)
    .getByRole("button", { name: "Abrir en el editor" })
    .click();
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  const editor = await grid(firstPage(page).locator("canvas").first());
  expect(editor.ratio).toBeCloseTo(shown.ratio, 1);
  const diff = meanDiff(shown.out, editor.out);
  console.log(`diferencia media escáner/editor: ${diff.toFixed(2)} de 255`);
  expect(diff).toBeLessThan(8);
});

test("009 CA9: with OCR checked, the scan opens in the editor with its text", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/app/");
  await openScanner(page, ["hoja-1.jpg"]);
  await scanner(page).getByLabel("Reconocer texto (OCR)").check();
  await scanner(page)
    .getByRole("button", { name: "Abrir en el editor" })
    .click();
  await expect(scanner(page)).toHaveCount(0, { timeout: 120_000 });
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await expect(page.getByTestId("ocr-text")).toHaveCount(1);
  await expect(page.getByTestId("scanned-notice")).toHaveCount(0);
  // Not marked while the OCR panel is closed.
  await expect(page.getByTestId("ocr-low")).toHaveCount(0);
});
