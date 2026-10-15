// Landing page: the promo video, the hero's right column. The poster shows at
// once; the video is fetched only after the load event and once in view (on a
// phone, only when scrolled to). Muted loop with an accessible pause button,
// poster only with reduced motion. Screenshots in docs/screenshots/promo/.
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

/** Records, at the load event, the video sources that already had a URL. */
async function sourcesAtLoad(page: Page) {
  await page.addInitScript(() =>
    addEventListener("load", () => {
      (window as unknown as { atLoad: (string | null)[] }).atLoad = [
        ...document.querySelectorAll("[data-promo] video source"),
      ].map((s) => s.getAttribute("src"));
    }),
  );
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

    test("poster at once, video after the load and in view; the button pauses it", async ({
      page,
    }) => {
      const requests = videoRequests(page);
      const posters: { url: string; bytes: number }[] = [];
      page.on("response", async (r) => {
        if (/\/promo\/promo-poster-720\./.test(r.url()))
          posters.push({ url: r.url(), bytes: (await r.body()).length });
      });
      await sourcesAtLoad(page);
      await page.goto("/");
      // Nothing of the video had been asked for when the page loaded.
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { atLoad?: unknown[] }).atLoad,
          ),
        )
        .toEqual([null, null]);

      // The largest paint is in the hero: its text, or the poster, which is
      // a small WebP fetched at once.
      const lcp = await page.evaluate(
        () =>
          new Promise<{ tag: string; inHero: boolean; time: number }>(
            (resolve) => {
              new PerformanceObserver((list) => {
                const last = list.getEntries().at(-1) as PerformanceEntry & {
                  element?: Element;
                };
                resolve({
                  tag: last.element?.tagName ?? "?",
                  inHero: !!last.element?.closest(".hero"),
                  time: Math.round(last.startTime),
                });
              }).observe({ type: "largest-contentful-paint", buffered: true });
            },
          ),
      );
      expect(lcp.inHero).toBe(true);
      const poster = figure(page).locator("img");
      if (lcp.tag === "IMG") {
        expect(
          await poster.evaluate((i: HTMLImageElement) => i.currentSrc),
        ).toMatch(/\.webp$/);
        await expect.poll(() => posters.length).toBeGreaterThan(0);
        expect(posters[0]!.bytes).toBeLessThan(16_000);
      }
      test.info().annotations.push({
        type: "lcp",
        description: `${lcp.tag} ${lcp.time} ms`,
      });

      // Where it sits: the hero's right column on a desktop; under the text,
      // full width with margins, on a phone. Square.
      const media = (await figure(page).boundingBox())!;
      const copy = (await page.locator(".hero-copy").boundingBox())!;
      expect(Math.abs(media.width - media.height)).toBeLessThan(1);
      if (name === "desktop") {
        expect(media.x).toBeGreaterThan(copy.x + copy.width);
        expect(media.width).toBeLessThanOrEqual(520);
        expect(media.width).toBeGreaterThan(400);
        // In view without scrolling, the poster already there.
        expect(media.y + media.height).toBeLessThanOrEqual(size.height);
        await expect(poster).toBeVisible();
        await expect
          .poll(() => poster.evaluate((i: HTMLImageElement) => i.naturalWidth))
          .toBe(720);
      } else {
        expect(media.y).toBeGreaterThanOrEqual(copy.y + copy.height);
        expect(media.x).toBeGreaterThanOrEqual(12);
        expect(media.x + media.width).toBeLessThanOrEqual(size.width - 12);
        expect(media.width).toBeGreaterThan(size.width - 60);
      }

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
      if (name === "desktop")
        await page.screenshot({ path: `${OUT}/${name}-portada.png` });
      else {
        // The hero as a phone shows it once scrolled: the text, then the video.
        await page.evaluate(() =>
          scrollTo({
            top:
              document.querySelector("[data-promo]")!.getBoundingClientRect()
                .bottom +
              scrollY -
              innerHeight +
              24,
            behavior: "instant",
          }),
        );
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/${name}-portada.png` });
      }
      await toggle(page).click();
      await expect
        .poll(() => video(page).evaluate((v: HTMLVideoElement) => v.paused))
        .toBe(true);
      await expect(toggle(page)).toHaveAccessibleName("Reproducir el vídeo");
      await toggle(page).click();
      await expect
        .poll(() => video(page).evaluate((v: HTMLVideoElement) => v.paused))
        .toBe(false);
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

test.describe("short phone", () => {
  test.use({ viewport: { width: 360, height: 640 }, isMobile: true });

  test("the video is fetched only once scrolled into view", async ({
    page,
  }) => {
    const requests = videoRequests(page);
    await page.goto("/");
    await page.waitForLoadState("load");
    // Out of view: the poster is there, but the video is not fetched, even
    // well after the load.
    expect((await figure(page).boundingBox())!.y).toBeGreaterThan(640);
    await page.waitForTimeout(1500);
    expect(requests).toEqual([]);
    await figure(page).scrollIntoViewIfNeeded();
    await expect(figure(page)).toHaveAttribute("data-state", "playing");
    expect(requests.length).toBeGreaterThan(0);
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
  await expect(figure(page).locator("img")).toHaveAttribute(
    "alt",
    /^A frame of the video/,
  );
});
