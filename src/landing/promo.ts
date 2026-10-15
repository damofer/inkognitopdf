// Landing page: the promo video in the hero, in the page's language. Its
// poster shows at once; the video itself is fetched only after the page has
// loaded and once it is in view, so it never slows the first load and a phone
// that does not scroll to it never fetches it. Switching the language swaps
// the poster and, if the video was already fetched, the video too; the other
// language's files are never fetched before that. It plays muted in a loop,
// and with "reduce motion" only the poster is shown. Everything is served by
// the site itself, and the service worker does not precache it.
import { getLang, t, type Lang } from "../i18n/core";

/** The files of a language: the English ones carry no suffix. */
const promoFiles = (suffix: string) => ({
  webp: `/promo/promo-poster-720${suffix}.webp`,
  jpg: `/promo/promo-poster-720${suffix}.jpg`,
  webm: `/promo/promo-720${suffix}.webm`,
  mp4: `/promo/promo-720${suffix}.mp4`,
});

/** The files of each language. index.html preloads and sets the same
    posters. */
export const PROMO_FILES: Record<Lang, ReturnType<typeof promoFiles>> = {
  en: promoFiles(""),
  es: promoFiles("-es"),
};

export interface PromoOptions {
  /** The visitor asked the system to reduce motion. */
  reducedMotion: boolean;
  /** Calls `ready` once the page has finished loading. */
  whenLoaded: (ready: () => void) => void;
  /** Calls `show` once the element is in view. */
  whenVisible: (element: Element, show: () => void) => void;
}

/** The browser's own answers. */
export const browserPromoOptions = (): PromoOptions => ({
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  whenLoaded(ready) {
    if (document.readyState === "complete") ready();
    else addEventListener("load", () => ready(), { once: true });
  },
  whenVisible(element, show) {
    if (!("IntersectionObserver" in window)) return show();
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        show();
      },
      // Only once it is actually on screen.
      { threshold: 0 },
    );
    observer.observe(element);
  },
});

export interface Promo {
  /** Shows the video of `lang` (after a switch of the page's language). */
  setLang(lang: Lang): void;
}

/** Labels of the pause / play button in the current language. */
export function labelPromo(root: ParentNode = document) {
  const video = root.querySelector<HTMLVideoElement>("[data-promo] video");
  const button = root.querySelector<HTMLButtonElement>("[data-promo-toggle]");
  if (!video || !button) return;
  const playing = !video.paused;
  button.setAttribute(
    "aria-label",
    t(playing ? "landing.promoPause" : "landing.promoPlay"),
  );
  button.dataset.state = playing ? "playing" : "paused";
}

export function setupPromo(
  root: ParentNode = document,
  options: PromoOptions = browserPromoOptions(),
  lang: Lang = getLang(),
): Promo | null {
  const figure = root.querySelector<HTMLElement>("[data-promo]");
  const video = figure?.querySelector("video");
  const button = figure?.querySelector<HTMLButtonElement>(
    "[data-promo-toggle]",
  );
  const posterSource =
    figure?.querySelector<HTMLSourceElement>("picture source");
  const posterImg = figure?.querySelector<HTMLImageElement>("picture img");
  if (!figure || !video || !button || !posterSource || !posterImg) return null;
  const webm = video.querySelector<HTMLSourceElement>(
    'source[type="video/webm"]',
  )!;
  const mp4 = video.querySelector<HTMLSourceElement>(
    'source[type="video/mp4"]',
  )!;
  // Played from here, so that a video the visitor paused stays paused when
  // the language changes.
  video.removeAttribute("autoplay");
  let shown = false;

  const showPoster = () => {
    posterSource.srcset = PROMO_FILES[lang].webp;
    posterImg.src = PROMO_FILES[lang].jpg;
  };
  const loadVideo = () => {
    webm.src = PROMO_FILES[lang].webm;
    mp4.src = PROMO_FILES[lang].mp4;
    video.load();
  };
  const play = () => void video.play().catch(() => labelPromo(root));

  showPoster();
  if (options.reducedMotion) {
    // Only the poster: the video is never loaded.
    video.hidden = true;
    figure.dataset.state = "poster";
    return { setLang: (next) => ((lang = next), showPoster()) };
  }
  options.whenLoaded(() =>
    options.whenVisible(figure, () => {
      shown = true;
      loadVideo();
      play();
    }),
  );
  video.addEventListener("playing", () => {
    figure.dataset.state = "playing";
    button.hidden = false;
    labelPromo(root);
  });
  video.addEventListener("pause", () => labelPromo(root));
  button.addEventListener("click", () => {
    if (video.paused) play();
    else video.pause();
  });
  return {
    setLang(next) {
      if (next === lang) return;
      lang = next;
      showPoster();
      if (!shown) return;
      // The poster of the new language until its video plays.
      const playing = !video.paused;
      figure.dataset.state = "switching";
      loadVideo();
      if (playing) play();
      labelPromo(root);
    },
  };
}
