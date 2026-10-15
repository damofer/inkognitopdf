// Landing page: the promo video. Loaded only in view, muted loop with an
// accessible pause button, poster only with reduced motion, the hero text
// stays the largest contentful paint. Screenshots in docs/screenshots/promo/.
import { expect, test, type Page } from "@playwright/test";

const OUT = "docs/screenshots/promo";
const figure = (page: Page) => page.locator("[data-promo]");
const video = (page: Page) => figure(page).locator("video");
const toggle = (page: Page) => figure(page).locator("[data-promo-toggle]");

/** Requests for the video files. */
function videoRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (/\/promo\/promo-720\.(webm|mp4)/.test(r.url())) urls.push(r.url());
  });
  return urls;
}

for (const [name, size] of [
  ["desktop", { width: 1280, height: 900 }],
  ["phone", { width: 412, height: 915 }],
] as const)
  test.describe(name, () => {
    test.use({
      viewport: size,
      isMobile: name === "phone",
      hasTouch: name === "phone",
    });

    test("plays muted in a loop once in view; the button pauses it", async ({
      page,
    }) => {
      const requests = videoRequests(page);
      await page.goto("/");
      // The hero text is the largest paint, not the video or its poster.
      const lcp = await page.evaluate(
        () =>
          new Promise<string>((resolve) => {
            new PerformanceObserver((list) => {
              const last = list.getEntries().at(-1) as PerformanceEntry & {
                element?: Element;
              };
              resolve(
                last.element?.closest(".hero")
                  ? "hero"
                  : (last.element?.outerHTML.slice(0, 80) ?? "?"),
              );
            }).observe({ type: "largest-contentful-paint", buffered: true });
          }),
      );
      expect(lcp).toBe("hero");
      if (name === "phone") {
        // Below the fold: nothing fetched yet.
        await page.waitForTimeout(500);
        expect(requests).toEqual([]);
      }

      await figure(page).scrollIntoViewIfNeeded();
      await expect(figure(page)).toHaveAttribute("data-state", "playing");
      const state = await video(page).evaluate((v: HTMLVideoElement) => ({
        muted: v.muted,
        loop: v.loop,
        playsInline: v.playsInline,
        preload: v.getAttribute("preload"),
        controls: v.controls,
        paused: v.paused,
      }));
      expect(state).toEqual({
        muted: true,
        loop: true,
        playsInline: true,
        preload: "none",
        controls: false,
        paused: false,
      });
      expect(requests.length).toBeGreaterThan(0);

      // The pause button: 44 px, labelled, toggles.
      const box = (await toggle(page).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await expect(toggle(page)).toHaveAccessibleName("Pausar el vídeo");
      await page.waitForTimeout(1500);
      await figure(page).screenshot({ path: `${OUT}/${name}-video.png` });
      await toggle(page).click();
      await expect
        .poll(() => video(page).evaluate((v: HTMLVideoElement) => v.paused))
        .toBe(true);
      await expect(toggle(page)).toHaveAccessibleName("Reproducir el vídeo");
      await toggle(page).click();
      await expect
        .poll(() => video(page).evaluate((v: HTMLVideoElement) => v.paused))
        .toBe(false);

      // Size: at most 480 px on a desktop, the full width minus margins on
      // a phone; square.
      const media = (await figure(page).boundingBox())!;
      expect(Math.abs(media.width - media.height)).toBeLessThan(1);
      if (name === "desktop") expect(media.width).toBeLessThanOrEqual(480);
      else {
        expect(media.x).toBeGreaterThanOrEqual(12);
        expect(media.x + media.width).toBeLessThanOrEqual(size.width - 12);
        expect(media.width).toBeGreaterThan(size.width - 60);
      }
      await page.screenshot({ path: `${OUT}/${name}-portada.png` });
    });

    test("with reduced motion only the poster shows", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const requests = videoRequests(page);
      await page.goto("/");
      await figure(page).scrollIntoViewIfNeeded();
      await expect(figure(page)).toHaveAttribute("data-state", "poster");
      await expect(video(page)).toBeHidden();
      await expect(toggle(page)).toBeHidden();
      const poster = figure(page).locator("img");
      await expect(poster).toBeVisible();
      await expect(poster).toHaveAttribute("alt", /^Fotograma del vídeo/);
      await expect
        .poll(() => poster.evaluate((i: HTMLImageElement) => i.naturalWidth))
        .toBe(720);
      await page.waitForTimeout(1000);
      expect(requests).toEqual([]);
      expect(
        await video(page).evaluate((v: HTMLVideoElement) => v.paused),
      ).toBe(true);
      await figure(page).screenshot({ path: `${OUT}/${name}-poster.png` });
    });
  });

test("English labels", async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("inkognitopdf.lang", "en"),
  );
  await page.goto("/");
  await figure(page).scrollIntoViewIfNeeded();
  await expect(figure(page)).toHaveAttribute("data-state", "playing");
  await expect(toggle(page)).toHaveAccessibleName("Pause the video");
  await expect(video(page)).toHaveAttribute("aria-label", /^Silent video/);
  await expect(page.locator("#promo-title")).toHaveText("See it in 20 seconds");
});
