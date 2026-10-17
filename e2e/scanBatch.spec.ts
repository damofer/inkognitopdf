// Spec 020: scanning a batch with the live camera (taken by itself when the
// sheet holds still) and the ID card mode. The camera is a canvas stream the
// test fills with synthetic photos, so every step is under its control.
// Screenshots go to docs/screenshots/scan-batch/.
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName, type PDFDict, type PDFRawStream } from "pdf-lib";
import {
  cardPage,
  otherSheet,
  writePhotos,
  type PhotoFiles,
} from "./scanPhotos";

const DIR = "docs/screenshots/scan-batch";
let photos: PhotoFiles;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  const view = { width: 960, height: 720, tilt: 12, spin: 6 };
  photos = await writePhotos({
    "hoja-a.jpg": { seed: 701, fill: 0.85, ...view },
    "hoja-b.jpg": { seed: 702, fill: 0.85, ...view, page: otherSheet() },
    "mesa.jpg": { seed: 701, empty: true, ...view },
    "dni-anverso.jpg": {
      seed: 703,
      fill: 0.45,
      ...view,
      page: cardPage("front"),
    },
    "dni-reverso.jpg": {
      seed: 704,
      fill: 0.45,
      ...view,
      page: cardPage("back"),
    },
  });
});

const scanner = (page: Page) =>
  page.getByRole("dialog", { name: "Escanear documento" });
const cameraDialog = (page: Page) =>
  page.getByRole("dialog", { name: "Escaneo con la cámara" });

/**
 * A camera that shows one of the photos, chosen with `show(page, name)`.
 * `fail` makes opening it fail, as when the permission is refused.
 */
async function fakeCamera(page: Page, fail = false) {
  const names = [
    "hoja-a.jpg",
    "hoja-b.jpg",
    "mesa.jpg",
    "dni-anverso.jpg",
    "dni-reverso.jpg",
  ];
  const urls: Record<string, string> = {};
  for (const name of names)
    urls[name] =
      `data:image/jpeg;base64,${(await readFile(photos.path(name))).toString("base64")}`;
  await page.addInitScript(
    ({ urls, fail }) => {
      const w = window as unknown as {
        __show: (name: string) => void;
        __stream?: MediaStream;
      };
      const canvas = document.createElement("canvas");
      canvas.width = 960;
      canvas.height = 720;
      const ctx = canvas.getContext("2d")!;
      const images = new Map<string, HTMLImageElement>();
      for (const [name, url] of Object.entries(urls)) {
        const img = new Image();
        img.src = url;
        images.set(name, img);
      }
      let shown = "mesa.jpg";
      w.__show = (name) => (shown = name);
      const draw = () => {
        const img = images.get(shown);
        if (img?.complete) ctx.drawImage(img, 0, 0);
      };
      setInterval(draw, 40);
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            if (fail) throw new DOMException("test", "NotAllowedError");
            draw();
            w.__stream = canvas.captureStream(25);
            return w.__stream;
          },
        },
      });
    },
    { urls, fail },
  );
}

const show = (page: Page, name: string) =>
  page.evaluate(
    (name) =>
      (window as unknown as { __show: (n: string) => void }).__show(name),
    name,
  );

function scanImages(doc: PDFDocument) {
  return doc.getPages().map((p) => {
    const xobjects = p.node
      .Resources()!
      .lookup(PDFName.of("XObject")) as PDFDict;
    const [name] = xobjects.keys();
    return doc.context.lookup(xobjects.get(name!)) as PDFRawStream;
  });
}

async function download(page: Page) {
  const pending = page.waitForEvent("download");
  await scanner(page).getByRole("button", { name: "Guardar PDF" }).click();
  const file = await pending;
  return PDFDocument.load(new Uint8Array(await readFile((await file.path())!)));
}

test("the camera takes each sheet once, by itself, when it holds still", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await fakeCamera(page);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Escanear" }).first().click();
  await scanner(page)
    .getByRole("button", { name: "Escanear con la cámara" })
    .click();
  const camera = cameraDialog(page);
  await expect(camera.getByRole("status")).toHaveText(
    "Buscando la hoja: ponla sobre un fondo oscuro.",
  );
  await expect(
    camera.getByRole("button", { name: "Disparo automático" }),
  ).toHaveAttribute("aria-pressed", "true");

  await show(page, "hoja-a.jpg");
  await expect(camera.getByRole("button", { name: "Listo (1)" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(camera.getByRole("status")).toHaveText(
    "Hecho. Pon la siguiente hoja.",
  );
  await page.screenshot({ path: `${DIR}/camara-hoja-hecha.png` });
  // The same sheet, left there, is not taken again.
  await page.waitForTimeout(2500);
  await expect(camera.getByRole("button", { name: "Listo (1)" })).toBeVisible();

  // The next sheet (taken away, another one put down).
  await show(page, "mesa.jpg");
  await expect(camera.getByRole("status")).toHaveText(
    "Buscando la hoja: ponla sobre un fondo oscuro.",
  );
  await show(page, "hoja-b.jpg");
  await expect(camera.getByRole("button", { name: "Listo (2)" })).toBeVisible({
    timeout: 10_000,
  });
  await camera.getByRole("button", { name: "Listo (2)" }).click();
  await expect(camera).toBeHidden();
  // The camera is off.
  expect(
    await page.evaluate(() =>
      (window as unknown as { __stream: MediaStream }).__stream
        .getTracks()
        .map((t) => t.readyState),
    ),
  ).toEqual(["ended"]);

  // Both pages are already cropped: the first one shows its result.
  await expect(scanner(page).locator(".scan-strip li")).toHaveCount(2);
  await expect(scanner(page).locator("img.scan-result")).toBeVisible();
  await page.screenshot({ path: `${DIR}/lote-escritorio.png` });
  const doc = await download(page);
  expect(doc.getPageCount()).toBe(2);
  const [a, b] = scanImages(doc);
  expect(Buffer.from(a!.contents).equals(Buffer.from(b!.contents))).toBe(false);
});

test("without the automatic shutter, the button takes the photo", async ({
  page,
}) => {
  await fakeCamera(page);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Escanear" }).first().click();
  await scanner(page)
    .getByRole("button", { name: "Escanear con la cámara" })
    .click();
  const camera = cameraDialog(page);
  await camera.getByRole("button", { name: "Disparo automático" }).click();
  await show(page, "hoja-a.jpg");
  await expect(camera.getByRole("status")).toHaveText(
    "Hoja encontrada. Pulsa el botón para hacer la foto.",
  );
  await page.waitForTimeout(1500);
  await expect(
    camera.getByRole("button", { name: "Listo", exact: true }),
  ).toBeVisible();
  await camera.getByRole("button", { name: "Hacer la foto" }).click();
  await expect(camera.getByRole("button", { name: "Listo (1)" })).toBeVisible();
  await camera.getByRole("button", { name: "Listo (1)" }).click();
  // Remembered on this device.
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("inkognitopdf.scan")!).autoCapture,
    ),
  ).toBe(false);
});

test("a camera that cannot be opened says so", async ({ page }) => {
  await fakeCamera(page, true);
  await page.goto("/app/");
  await page.getByRole("button", { name: "Escanear" }).first().click();
  await scanner(page)
    .getByRole("button", { name: "Escanear con la cámara" })
    .click();
  await expect(scanner(page).getByRole("status")).toHaveText(
    "No se pudo abrir la cámara. Permite el acceso o usa «Hacer foto».",
  );
  await expect(cameraDialog(page)).toHaveCount(0);
});

test("ID card mode: both sides on one A4 page, at real size", async ({
  page,
}) => {
  await page.goto("/app/");
  await page.getByRole("button", { name: "Escanear" }).first().click();
  const view = scanner(page);
  await view.getByLabel("Modo DNI (dos caras en un A4)").check();
  await view
    .getByTestId("scan-images")
    .setInputFiles([
      photos.path("dni-anverso.jpg"),
      photos.path("dni-reverso.jpg"),
    ]);
  await expect(view.locator(".scan-strip li")).toHaveCount(2);
  await expect(view.locator(".scan-id-hint")).toContainText(
    "2 caras en 1 hoja",
  );
  await view.getByRole("button", { name: "Continuar" }).click();
  await expect(view.locator("img.scan-result")).toBeVisible();
  // The card, flattened at its real proportions (85.6 × 53.98 mm).
  const size = await view
    .locator("img.scan-result")
    .evaluate((img: HTMLImageElement) => img.naturalWidth / img.naturalHeight);
  expect(size).toBeCloseTo(85.6 / 53.98, 2);
  await page.screenshot({ path: `${DIR}/dni-recorte.png` });

  const doc = await download(page);
  expect(doc.getPageCount()).toBe(1);
  const { width, height } = doc.getPage(0).getSize();
  expect(width).toBeCloseTo(595.28, 0);
  expect(height).toBeCloseTo(841.89, 0);
  const [image] = scanImages(doc);
  expect(image!.dict.get(PDFName.of("Width"))!.toString()).toBe("1654");
  expect(image!.dict.get(PDFName.of("Height"))!.toString()).toBe("2339");

  await view.getByRole("button", { name: "Abrir en el editor" }).click();
  await expect(page.locator(".page").first()).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.screenshot({ path: `${DIR}/dni-en-a4.png` });
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("ID card with the camera: front, back, one page", async ({ page }) => {
    test.setTimeout(90_000);
    await fakeCamera(page);
    await page.goto("/app/");
    await page.getByRole("button", { name: "Escanear" }).click();
    const view = scanner(page);
    await expect(
      view.getByRole("button", { name: "Escanear con la cámara" }),
    ).toBeVisible();
    const check = view.getByLabel("Modo DNI (dos caras en un A4)");
    await check.check();
    expect(
      (await check.locator("..").boundingBox())!.height,
    ).toBeGreaterThanOrEqual(43.5);
    await page.screenshot({ path: `${DIR}/movil-inicio.png` });

    await view.getByRole("button", { name: "Escanear con la cámara" }).click();
    const camera = cameraDialog(page);
    await expect(camera.getByRole("status")).toHaveText(
      "Enfoca el anverso de la tarjeta.",
    );
    for (const name of ["Disparo automático", "Hacer la foto", "Listo"]) {
      const box = (await camera
        .getByRole("button", { name, exact: name === "Listo" })
        .boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(43.5);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
    await show(page, "dni-anverso.jpg");
    await expect(camera.getByRole("button", { name: "Listo (1)" })).toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await expect(camera.getByRole("status")).toHaveText(
      "Hecho. Da la vuelta a la tarjeta.",
    );
    await page.screenshot({ path: `${DIR}/movil-camara-dni.png` });
    await show(page, "mesa.jpg");
    await expect(camera.getByRole("status")).toHaveText(
      "Ahora el reverso de la tarjeta.",
    );
    await show(page, "dni-reverso.jpg");
    await expect(camera.getByRole("button", { name: "Listo (2)" })).toBeVisible(
      {
        timeout: 10_000,
      },
    );
    await camera.getByRole("button", { name: "Listo (2)" }).click();
    await expect(view.locator(".scan-heading")).toContainText(
      "2 caras en 1 hoja",
    );
    await expect(view.locator(".scan-strip li")).toHaveCount(4);
    await page.screenshot({ path: `${DIR}/movil-paginas-dni.png` });
  });
});
