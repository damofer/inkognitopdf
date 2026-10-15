// Landing page: the promo video under the hero. It is loaded only when it
// comes into view (the sources wait in data-src), plays muted in a loop, and
// with "reduce motion" only its poster is shown. Everything is served by the
// site itself, and the service worker does not precache it.
import { t } from "../i18n/core";

export interface PromoOptions {
  /** The visitor asked the system to reduce motion. */
  reducedMotion: boolean;
  /** Calls `show` once the element is (nearly) in view. */
  whenVisible: (element: Element, show: () => void) => void;
}

/** The browser's own answers. */
export const browserPromoOptions = (): PromoOptions => ({
  reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  whenVisible(element, show) {
    if (!("IntersectionObserver" in window)) return show();
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        show();
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(element);
  },
});

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
) {
  const figure = root.querySelector<HTMLElement>("[data-promo]");
  const video = figure?.querySelector("video");
  const button = figure?.querySelector<HTMLButtonElement>(
    "[data-promo-toggle]",
  );
  if (!figure || !video || !button) return;
  if (options.reducedMotion) {
    // Only the poster: the video is never loaded.
    video.removeAttribute("autoplay");
    video.hidden = true;
    figure.dataset.state = "poster";
    return;
  }
  options.whenVisible(figure, () => {
    for (const source of video.querySelectorAll<HTMLSourceElement>(
      "source[data-src]",
    ))
      source.src = source.dataset.src!;
    video.load();
    void video.play().catch(() => labelPromo(root));
  });
  video.addEventListener("playing", () => {
    figure.dataset.state = "playing";
    button.hidden = false;
    labelPromo(root);
  });
  video.addEventListener("pause", () => labelPromo(root));
  button.addEventListener("click", () => {
    if (video.paused) void video.play();
    else video.pause();
  });
}
