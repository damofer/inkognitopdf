// Spec 017: «Open with» (File Handling), PDFs shared from other apps (Web
// Share Target, through the service worker) and sharing the result (Web
// Share). Screenshots go to docs/screenshots/open-share/.
import { expect, test, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { fixture, firstPage, openFixture } from "./helpers";

const DIR = "docs/screenshots/open-share";

test("the manifest declares «Open with» and the share target", async ({
  request,
}) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.file_handlers).toEqual([
    { action: "/app/", accept: { "application/pdf": [".pdf"] } },
  ]);
  expect(manifest.share_target).toMatchObject({
    action: "/app/share-target",
    method: "POST",
    enctype: "multipart/form-data",
    params: { files: [{ name: "pdf" }] },
  });
  const sw = await (await request.get("/sw.js")).text();
  expect(sw).toContain("share-target.js");
});

/** A launch queue like the browser's, that the test can fire. */
async function fakeLaunchQueue(page: Page) {
  // Chrome has its own (it only fills it when launched from the system).
  await page.addInitScript(() => {
    const w = window as unknown as { __launch?: (p: unknown) => void };
    Object.defineProperty(window, "launchQueue", {
      configurable: true,
      value: { setConsumer: (c: (p: unknown) => void) => (w.__launch = c) },
    });
  });
}

async function launch(page: Page, names: string[]) {
  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      bytes: [...(await readFile(fixture(name)))],
    })),
  );
  await page.waitForFunction(() => "__launch" in window);
  await page.evaluate((files) => {
    const handles = files.map((f) => ({
      getFile: async () =>
        new File([new Uint8Array(f.bytes)], f.name, {
          type: "application/pdf",
        }),
    }));
    (window as unknown as { __launch: (p: unknown) => void }).__launch({
      files: handles,
    });
  }, files);
}

test("«Open with» opens the PDF, and several are joined", async ({ page }) => {
  await fakeLaunchQueue(page);
  await page.goto("/app/");
  await launch(page, ["simple-text.pdf"]);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await expect(page.getByText("simple-text.pdf")).toBeVisible();

  await page.goto("/app/");
  await launch(page, ["simple-text.pdf", "two-pages.pdf"]);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await expect(page.locator(".page")).toHaveCount(3);
});

/** Submits the share form as Android does, through the service worker. */
async function shareFiles(page: Page, paths: string[]) {
  await page.goto("/app/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener("controllerchange", resolve, {
          once: true,
        }),
      );
  });
  await page.evaluate(() => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/app/share-target";
    form.enctype = "multipart/form-data";
    form.id = "share-form";
    const input = document.createElement("input");
    input.type = "file";
    input.name = "pdf";
    input.multiple = true;
    form.append(input);
    document.body.append(form);
  });
  await page.locator("#share-form input").setInputFiles(paths);
  await page.evaluate(() =>
    (document.getElementById("share-form") as HTMLFormElement).submit(),
  );
}

test("a PDF shared from another app opens", async ({ page }) => {
  await shareFiles(page, [fixture("simple-text.pdf")]);
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await expect(page.getByText("simple-text.pdf")).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  // Nothing is left in the cache.
  expect(
    await page.evaluate(async () =>
      (await (await caches.open("inkognito-shared")).keys()).map((r) => r.url),
    ),
  ).toEqual([]);
});

test("a share without a PDF says so", async ({ page }) => {
  await shareFiles(page, [fixture("../../package.json")]);
  await expect(page.getByRole("alert")).toHaveText(
    "No llegó ningún PDF para abrir.",
  );
});

/** navigator.share as a phone has it; `fail` errors the first calls. */
async function fakeShare(page: Page, fail: string[] = []) {
  await page.addInitScript((fail) => {
    const w = window as unknown as {
      __shared: { name: string; bytes: number[] }[];
    };
    w.__shared = [];
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: (data: { files?: File[] }) =>
        !!data.files?.every((f) => f.type === "application/pdf"),
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { files: File[] }) => {
        const error = fail.shift();
        if (error) throw new DOMException("test", error);
        const file = data.files[0]!;
        w.__shared.push({
          name: file.name,
          bytes: [...new Uint8Array(await file.arrayBuffer())],
        });
      },
    });
  }, fail);
}

const sharedFiles = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __shared: { name: string; bytes: number[] }[] })
        .__shared,
  );

test("«Compartir» sends the saved PDF to another app", async ({ page }) => {
  await fakeShare(page);
  await openFixture(page, "simple-text.pdf");
  const share = page.getByRole("button", { name: "Compartir", exact: true });
  await expect(share).toBeVisible();
  await page.screenshot({ path: `${DIR}/compartir-escritorio.png` });
  await share.click();
  await expect.poll(async () => (await sharedFiles(page)).length).toBe(1);
  const [shared] = await sharedFiles(page);
  expect(shared!.name).toBe("simple-text (editado).pdf");
  const doc = await PDFDocument.load(new Uint8Array(shared!.bytes));
  expect(doc.getPageCount()).toBe(1);
});

test("cancelling the share menu is not an error", async ({ page }) => {
  await fakeShare(page, ["AbortError"]);
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Compartir", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Compartir", exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(/No se pudo compartir/)).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("when the tap no longer counts, one more tap shares", async ({ page }) => {
  await fakeShare(page, ["NotAllowedError"]);
  await openFixture(page, "simple-text.pdf");
  await page.getByRole("button", { name: "Compartir", exact: true }).click();
  const ready = page.getByRole("alertdialog", {
    name: "El PDF está listo para compartir",
  });
  await expect(ready).toContainText(
    "«simple-text (editado).pdf» está preparado",
  );
  await page.screenshot({ path: `${DIR}/listo-para-compartir.png` });
  await ready.getByRole("button", { name: "Compartir" }).click();
  await expect(ready).toBeHidden();
  expect((await sharedFiles(page))[0]!.name).toBe("simple-text (editado).pdf");
});

test("without Web Share there is no button", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: undefined,
    }),
  );
  await openFixture(page, "simple-text.pdf");
  await expect(
    page.getByRole("button", { name: "Compartir", exact: true }),
  ).toHaveCount(0);
});

test.describe("phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("the share button fits in the bar", async ({ page }) => {
    await fakeShare(page);
    await openFixture(page, "simple-text.pdf");
    const share = page.getByRole("button", { name: "Compartir", exact: true });
    await expect(share).toBeVisible();
    const box = (await share.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(43.5);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const width = await page.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: `${DIR}/compartir-movil.png` });
    await share.tap();
    await expect.poll(async () => (await sharedFiles(page)).length).toBe(1);
  });
});
