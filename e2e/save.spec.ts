// Spec 001, phase 3: saving (T010/T011) and privacy (T012 / CA10).
import { expect, test, type Page, type Request } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const fixture = (name: string) =>
  join(import.meta.dirname, "..", "tests", "fixtures", name);

async function openFixture(page: Page, name: string) {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(fixture(name));
  await expect(page.locator('.page[data-page-number="1"]')).toHaveAttribute(
    "data-rendered",
    "true",
  );
}

async function saveAndRead(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Guardar PDF" }).click();
  const file = await download;
  return {
    name: file.suggestedFilename(),
    bytes: new Uint8Array(await readFile((await file.path())!)),
  };
}

test("CA9: saving produces a new PDF and keeps the original name untouched", async ({
  page,
}) => {
  await openFixture(page, "two-pages.pdf");
  const { name, bytes } = await saveAndRead(page);
  expect(name).toBe("two-pages (editado).pdf");
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  await expect(page.getByTestId("toast")).toContainText("Guardado");
});

test("CA10: no network request carries document content", async ({ page }) => {
  const requests: Request[] = [];
  page.on("request", (r) => requests.push(r));
  await openFixture(page, "simple-text.pdf");
  await saveAndRead(page);

  const appOrigin = new URL(page.url()).origin;
  const offending = requests.filter((r) => {
    const url = new URL(r.url());
    if (url.protocol === "blob:" || url.protocol === "data:") return false;
    return (
      url.origin !== appOrigin || r.method() !== "GET" || r.postData() !== null
    );
  });
  expect(offending.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
});

test("spec 038: the PDF is built in the save worker", async ({ page }) => {
  const workers: string[] = [];
  const warnings: string[] = [];
  page.on("worker", (w) => workers.push(w.url()));
  page.on("console", (m) => {
    if (m.type() === "warning") warnings.push(m.text());
  });
  await openFixture(page, "two-pages.pdf");
  const { bytes } = await saveAndRead(page);
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  expect(workers.some((url) => url.includes("saveWorker"))).toBe(true);
  expect(warnings.filter((w) => w.includes("Save worker"))).toEqual([]);
});

test("spec 038: without workers the PDF is still saved", async ({ page }) => {
  await page.addInitScript(() => {
    // @ts-expect-error: a browser without module workers.
    delete window.Worker;
  });
  await openFixture(page, "two-pages.pdf");
  const { name, bytes } = await saveAndRead(page);
  expect(name).toBe("two-pages (editado).pdf");
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
});
