// Spec 011: usage measurement only with consent, and never with document data.
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fixture, firstPage, saveAndRead } from "./helpers";

// No answer yet to the measurement question (the config answers it for the
// other tests).
test.use({ storageState: { cookies: [], origins: [] } });

const GOOGLE =
  /googletagmanager|google-analytics|analytics\.google|googleapis\.com|doubleclick/;
const FILE_NAME = "secreto-cliente-4711.pdf";
const NEW_TEXT = "Texto confidencial 9137";

/**
 * Records every request to Google. Without `answer` they are aborted; with
 * it, the SDK gets fake answers (nothing reaches the real property).
 */
async function watchGoogle(page: Page, answer = false) {
  const requests: string[] = [];
  await page.route(GOOGLE, (route) => {
    const url = route.request().url();
    requests.push(url);
    if (!answer) return route.abort();
    if (url.includes("googletagmanager.com/gtag/js"))
      return route.fulfill({
        contentType: "text/javascript",
        body: "window.__gtagLoaded = true;",
      });
    if (url.includes("/webConfig"))
      return route.fulfill({
        json: {
          appId: "1:1066377971065:web:e3402f5612ce7db55b5ba8",
          measurementId: "G-G1HHR22T6N",
        },
      });
    if (url.includes("firebaseinstallations"))
      return route.fulfill({
        json: {
          name: "projects/inkognitopdf/installations/fTest",
          fid: "fTestInstallation0001",
          refreshToken: "refresh",
          authToken: { token: "token", expiresIn: "604800s" },
        },
      });
    return route.abort();
  });
  // Measuring is allowed on this test server (never the real property).
  await page.addInitScript(() =>
    localStorage.setItem("inkognito.analytics.debug", "1"),
  );
  return requests;
}

/** Visits the landing, then opens, edits and saves a document in the app. */
async function useTheApp(page: Page, choose?: "Aceptar" | "Rechazar") {
  await page.goto("/");
  await expect(page.locator("#analytics")).toBeAttached();
  await page.goto("/app/");
  const notice = page.getByTestId("consent");
  if (choose) await notice.getByRole("button", { name: choose }).click();
  await page.getByTestId("open-pdf").setInputFiles({
    name: FILE_NAME,
    mimeType: "application/pdf",
    buffer: await readFile(fixture("simple-text.pdf")),
  });
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  await page
    .getByRole("group", { name: "Herramientas de edición" })
    .getByRole("button", { name: "Editar texto", exact: true })
    .click();
  const span = firstPage(page).locator(".textLayer span", {
    hasText: "El rapido zorro",
  });
  const box = (await span.boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  const editor = page.getByRole("textbox", { name: "Texto", exact: true });
  await expect(editor).toBeVisible();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(NEW_TEXT);
  await page.keyboard.press("Control+Enter");
  await saveAndRead(page);
}

test("nothing goes to Google before choosing", async ({ page }) => {
  const requests = await watchGoogle(page);
  await page.goto("/");
  await expect(page.locator("[data-consent-notice]")).toBeVisible();
  await useTheApp(page);
  await expect(page.getByTestId("consent")).toBeVisible();
  expect(requests).toEqual([]);
});

test("nothing goes to Google after rejecting", async ({ page }) => {
  const requests = await watchGoogle(page);
  await useTheApp(page, "Rechazar");
  await expect(page.getByTestId("consent")).toHaveCount(0);
  // The choice is remembered, in the app and on the landing.
  await page.reload();
  await expect(page.getByTestId("open-pdf")).toBeAttached();
  await expect(page.getByTestId("consent")).toHaveCount(0);
  await page.goto("/");
  await expect(page.locator("[data-consent-notice]")).toBeHidden();
  await expect(page.locator("[data-analytics-state]")).toContainText(
    /desactivada|off/,
  );
  expect(requests).toEqual([]);
});

test("after accepting, events carry no document data", async ({ page }) => {
  const requests = await watchGoogle(page, true);
  await useTheApp(page, "Aceptar");
  await expect
    .poll(() => page.evaluate(() => "__gtagLoaded" in window))
    .toBe(true);
  expect(requests.some((u) => u.includes("id=G-G1HHR22T6N"))).toBe(true);
  // What the SDK queued for Google, as gtag would read it.
  const queued = await expect
    .poll(async () => {
      const layer = await page.evaluate(() =>
        JSON.stringify((window as { dataLayer?: unknown[] }).dataLayer ?? []),
      );
      return layer.includes("save_document") ? layer : "";
    })
    .not.toBe("")
    .then(() =>
      page.evaluate(() =>
        JSON.stringify((window as { dataLayer?: unknown[] }).dataLayer),
      ),
    );
  for (const event of ["page_view", "open_document", "edit_text"])
    expect(queued).toContain(event);
  for (const secret of [
    "secreto",
    "4711",
    "confidencial",
    "9137",
    "Documento de prueba",
    "rapido zorro",
  ])
    expect(queued).not.toContain(secret);
  // Advertising stays denied.
  expect(queued).toContain('"ad_storage":"denied"');
  expect(queued).toContain('"allow_google_signals":false');
});

test("rejecting later stops measuring", async ({ page }) => {
  const requests = await watchGoogle(page, true);
  await page.goto("/app/");
  await page
    .getByTestId("consent")
    .getByRole("button", { name: "Aceptar" })
    .click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  // «Privacidad» in the menu asks again.
  await page.getByRole("button", { name: "Privacidad" }).click();
  await page
    .getByTestId("consent")
    .getByRole("button", { name: "Rechazar" })
    .click();
  await expect(page.getByTestId("consent")).toHaveCount(0);
  const before = requests.length;
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.waitForTimeout(500);
  expect(requests.length).toBe(before);
});

test("measuring on but Google unreachable (offline): the app works", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const requests = await watchGoogle(page);
  await useTheApp(page, "Aceptar");
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("screenshots of the notice and the landing section", async ({
  browser,
}) => {
  const dir = "docs/screenshots/analytics";
  for (const [name, viewport, mobile] of [
    ["escritorio", { width: 1280, height: 800 }, false],
    ["movil", { width: 390, height: 844 }, true],
  ] as const) {
    const context = await browser.newContext({
      viewport,
      isMobile: mobile,
      hasTouch: mobile,
      locale: "es-ES",
    });
    const page = await context.newPage();
    await page.route(GOOGLE, (route) => route.abort());
    await page.goto("/app/");
    const notice = page.getByTestId("consent");
    await expect(notice).toBeVisible();
    // The notice leaves the start actions free.
    if (mobile) {
      const box = (await notice.boundingBox())!;
      const blank = (await page
        .getByRole("button", { name: "Documento en blanco" })
        .last()
        .boundingBox())!;
      expect(blank.y + blank.height).toBeLessThanOrEqual(box.y);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    await page.screenshot({ path: `${dir}/app-${name}.png` });
    await page.goto("/#analytics");
    await expect(page.locator("[data-consent-notice]")).toBeVisible();
    await page.locator("#analytics").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir}/landing-${name}.png` });
    await context.close();
  }
});
