// Landing page: the promo video, the hero's right column, in the page's
// language. The poster shows at once; the video is fetched only after the
// load event and once in view (on a phone, only when scrolled to). Switching
// the language swaps poster and video without fetching the other language
// before. Muted loop with an accessible pause button, which a switch
// respects; poster only with reduced motion. Screenshots in
// docs/screenshots/promo/.
import { expect, test, type Page } from "@playwright/test";

const OUT = "docs/screenshots/promo";
const figure = (page: Page) => page.locator("[data-promo]");
const video = (page: Page) => figure(page).locator("video");
const toggle = (page: Page) => figure(page).locator("[data-promo-toggle]");
const poster = (page: Page) => figure(page).locator("img");

/** Every request for a promo file, as its file name. */
function promoRequests(page: Page) {
  const names: string[] = [];
  page.on("request", (r) => {
    const m = /\/promo\/([^/?]+)/.exec(r.url());
    if (m) names.push(m[1]!);
  });
  return names;
}
const videos = (names: string[]) => names.filter((n) => /^promo-720/.test(n));
const isSpanish = (name: string) => /-es\.\w+$/.test(name);

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

async function useLang(page: Page, lang: "es" | "en") {
  await page.addInitScript(
    (l) => localStorage.setItem("inkognitopdf.lang", l),
    lang,
  );
}

const paused = (page: Page) =>
  video(page).evaluate((v: HTMLVideoElement) => v.paused);
const currentVideo = (page: Page) =>
  video(page).evaluate((v: HTMLVideoElement) => v.currentSrc);
const currentPoster = (page: Page) =>
  poster(page).evaluate((i: HTMLImageElement) => i.currentSrc);

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

    for (const lang of ["es", "en"] as const)
      test(`${lang}: poster at once, video after the load and in view, only in ${lang}`, async ({
        page,
      }) => {
        const requests = promoRequests(page);
        const posters: { url: string; bytes: number }[] = [];
        page.on("response", async (r) => {
          if (/\/promo\/promo-poster-720/.test(r.url()))
            posters.push({ url: r.url(), bytes: (await r.body()).length });
        });
        await useLang(page, lang);
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

        // The largest paint is in the hero: its text, or the poster, which
        // is a small WebP preloaded from the head.
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
                }).observe({
                  type: "largest-contentful-paint",
                  buffered: true,
                });
              },
            ),
        );
        expect(lcp.inHero).toBe(true);
        expect(await currentPoster(page)).toMatch(
          lang === "es"
            ? /promo-poster-720-es\.webp$/
            : /promo-poster-720\.webp$/,
        );
        if (lcp.tag === "IMG") {
          await expect.poll(() => posters.length).toBeGreaterThan(0);
          expect(posters[0]!.bytes).toBeLessThan(16_000);
        }
        test.info().annotations.push({
          type: "lcp",
          description: `${lcp.tag} ${lcp.time} ms`,
        });

        // Where it sits: the hero's right column on a desktop; under the
        // text, full width with margins, on a phone. Square.
        const media = (await figure(page).boundingBox())!;
        const copy = (await page.locator(".hero-copy").boundingBox())!;
        expect(Math.abs(media.width - media.height)).toBeLessThan(1);
        if (name === "desktop") {
          expect(media.x).toBeGreaterThan(copy.x + copy.width);
          expect(media.width).toBeLessThanOrEqual(520);
          expect(media.width).toBeGreaterThan(400);
          // In view without scrolling, the poster already there.
          expect(media.y + media.height).toBeLessThanOrEqual(size.height);
          await expect(poster(page)).toBeVisible();
          await expect
            .poll(() =>
              poster(page).evaluate((i: HTMLImageElement) => i.naturalWidth),
            )
            .toBe(720);
        } else {
          expect(media.y).toBeGreaterThanOrEqual(copy.y + copy.height);
          expect(media.x).toBeGreaterThanOrEqual(12);
          expect(media.x + media.width).toBeLessThanOrEqual(size.width - 12);
          expect(media.width).toBeGreaterThan(size.width - 60);
          await figure(page).scrollIntoViewIfNeeded();
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
        expect(await currentVideo(page)).toMatch(
          lang === "es" ? /promo-720-es\.webm$/ : /promo-720\.webm$/,
        );
        // Only the files of this language were fetched.
        expect(videos(requests).length).toBeGreaterThan(0);
        expect(requests.every((n) => isSpanish(n) === (lang === "es"))).toBe(
          true,
        );

        // The pause button: 44 px, labelled, toggles.
        const box = (await toggle(page).boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        const [pause, play] =
          lang === "es"
            ? ["Pausar el vídeo", "Reproducir el vídeo"]
            : ["Pause the video", "Play the video"];
        await expect(toggle(page)).toHaveAccessibleName(pause);
        await page.waitForTimeout(1500);
        await figure(page).screenshot({
          path: `${OUT}/${name}-video-${lang}.png`,
        });
        if (name === "desktop")
          await page.screenshot({ path: `${OUT}/${name}-portada-${lang}.png` });
        else {
          // The hero as a phone shows it once scrolled: text, then video.
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
          await page.screenshot({ path: `${OUT}/${name}-portada-${lang}.png` });
        }
        await toggle(page).click();
        await expect.poll(() => paused(page)).toBe(true);
        await expect(toggle(page)).toHaveAccessibleName(play);
        await toggle(page).click();
        await expect.poll(() => paused(page)).toBe(false);
      });

    test("switching the language swaps the video; a pause is kept", async ({
      page,
    }) => {
      const requests = promoRequests(page);
      await useLang(page, "es");
      await page.goto("/");
      await figure(page).scrollIntoViewIfNeeded();
      await expect(figure(page)).toHaveAttribute("data-state", "playing");
      expect(requests.some((n) => !isSpanish(n))).toBe(false);

      // Playing: to English, it keeps playing, now the English video.
      await page.locator('[data-lang="en"]').first().click();
      await expect.poll(() => currentVideo(page)).toMatch(/promo-720\.webm$/);
      await expect
        .poll(() => currentPoster(page))
        .toMatch(/promo-poster-720\.webp$/);
      await expect(figure(page)).toHaveAttribute("data-state", "playing");
      expect(await paused(page)).toBe(false);
      expect(videos(requests).some((n) => !isSpanish(n))).toBe(true);
      await expect(toggle(page)).toHaveAccessibleName("Pause the video");

      // Paused: back to Spanish, it stays paused on the Spanish poster.
      await toggle(page).click();
      await expect.poll(() => paused(page)).toBe(true);
      await page.locator('[data-lang="es"]').first().click();
      await expect
        .poll(() => currentPoster(page))
        .toMatch(/promo-poster-720-es\.webp$/);
      await expect(figure(page)).toHaveAttribute("data-state", "switching");
      await page.waitForTimeout(1000);
      expect(await paused(page)).toBe(true);
      await expect(toggle(page)).toHaveAccessibleName("Reproducir el vídeo");
      await expect(poster(page)).toBeVisible();
      if (name === "desktop")
        await figure(page).screenshot({
          path: `${OUT}/${name}-cambio-pausado-es.png`,
        });
      // Played again: the Spanish video.
      await toggle(page).click();
      await expect(figure(page)).toHaveAttribute("data-state", "playing");
      expect(await currentVideo(page)).toMatch(/promo-720-es\.webm$/);
    });

    for (const lang of ["es", "en"] as const)
      test(`${lang}: with reduced motion only the poster shows`, async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        const requests = promoRequests(page);
        await useLang(page, lang);
        await page.goto("/");
        await figure(page).scrollIntoViewIfNeeded();
        await expect(figure(page)).toHaveAttribute("data-state", "poster");
        await expect(video(page)).toBeHidden();
        await expect(toggle(page)).toBeHidden();
        await expect(poster(page)).toBeVisible();
        await expect(poster(page)).toHaveAttribute(
          "alt",
          lang === "es" ? /^Fotograma del vídeo/ : /^A frame of the video/,
        );
        await expect
          .poll(() =>
            poster(page).evaluate((i: HTMLImageElement) => i.naturalWidth),
          )
          .toBe(720);
        // Switching the language: the other poster, still no video.
        await page
          .locator(`[data-lang="${lang === "es" ? "en" : "es"}"]`)
          .first()
          .click();
        await expect
          .poll(() => currentPoster(page))
          .toMatch(
            lang === "es"
              ? /promo-poster-720\.webp$/
              : /promo-poster-720-es\.webp$/,
          );
        await page.waitForTimeout(1000);
        expect(videos(requests)).toEqual([]);
        expect(await paused(page)).toBe(true);
        if (lang === "es")
          await figure(page).screenshot({ path: `${OUT}/${name}-poster.png` });
      });
  });

test.describe("short phone", () => {
  test.use({ viewport: { width: 360, height: 640 }, isMobile: true });

  test("the video is fetched only once scrolled into view, in the language then chosen", async ({
    page,
  }) => {
    const requests = promoRequests(page);
    await useLang(page, "es");
    await page.goto("/");
    await page.waitForLoadState("load");
    // Out of view: the poster is there, but the video is not fetched, even
    // well after the load, nor after switching the language.
    expect((await figure(page).boundingBox())!.y).toBeGreaterThan(640);
    await page.waitForTimeout(1000);
    await page.locator('[data-lang="en"]').first().click();
    await page.waitForTimeout(500);
    expect(videos(requests)).toEqual([]);
    await figure(page).scrollIntoViewIfNeeded();
    await expect(figure(page)).toHaveAttribute("data-state", "playing");
    // Only the English video, never the Spanish one.
    expect(videos(requests).length).toBeGreaterThan(0);
    expect(videos(requests).some(isSpanish)).toBe(false);
  });
});
