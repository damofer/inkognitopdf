// @vitest-environment jsdom
// Landing page: the promo video in the hero (muted loop, fetched only after
// the page has loaded and once in view, poster only with reduced motion,
// accessible pause button, not precached).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../src/i18n/core";
import { labelPromo, setupPromo } from "../src/landing/promo";

const root = join(import.meta.dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const hero = html.slice(
  html.indexOf('<section class="hero">'),
  html.indexOf("</section>", html.indexOf('<section class="hero">')),
);
const section = hero.slice(
  hero.indexOf("<figure"),
  hero.indexOf("</figure>") + "</figure>".length,
);

function mount() {
  document.body.innerHTML = section;
  return {
    figure: document.querySelector<HTMLElement>("[data-promo]")!,
    video: document.querySelector("video")!,
    button: document.querySelector<HTMLButtonElement>("[data-promo-toggle]")!,
    sources: [...document.querySelectorAll("source[data-src]")],
  };
}

beforeEach(() => {
  setLang("es");
  // jsdom has no media playback: a minimal one.
  let paused = true;
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get: () => paused,
  });
  HTMLMediaElement.prototype.load = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(function (this: HTMLMediaElement) {
    paused = false;
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  });
  HTMLMediaElement.prototype.pause = vi.fn(function (this: HTMLMediaElement) {
    paused = true;
    this.dispatchEvent(new Event("pause"));
  });
});

describe("promo video", () => {
  it("is muted, inline, looping, autoplaying and not preloaded", () => {
    const { video, sources } = mount();
    for (const attr of ["muted", "loop", "playsinline", "autoplay"])
      expect(video.hasAttribute(attr), attr).toBe(true);
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.hasAttribute("controls")).toBe(false);
    // WebM first, MP4 as the fallback; nothing to fetch until in view.
    expect(sources.map((s) => s.getAttribute("type"))).toEqual([
      "video/webm",
      "video/mp4",
    ]);
    expect(sources.every((s) => !s.hasAttribute("src"))).toBe(true);
    // The poster: WebP with a JPEG fallback, shown at once (not lazy).
    expect(section).toContain('srcset="/promo/promo-poster-720.webp"');
    expect(section).toContain('src="/promo/promo-poster-720.jpg"');
    expect(section).not.toContain('loading="lazy"');
    expect(section).toContain('fetchpriority="high"');
    // ... and preloaded from the head, being the hero's largest image.
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toMatch(
      /<link\s+rel="preload"\s+as="image"\s+href="\/promo\/promo-poster-720\.webp"/,
    );
  });

  it("takes the place of the illustration in the hero, with no heading", () => {
    expect(section).toContain("data-promo");
    expect(hero).not.toContain("hero-art");
    expect(html).not.toContain('class="promo"');
    expect(section).not.toMatch(/<h[1-6]/);
  });

  it("loads and plays only after the page has loaded and once in view", () => {
    const { video, sources, button } = mount();
    let ready: (() => void) | null = null;
    let show: (() => void) | null = null;
    const whenVisible = vi.fn((_: Element, s: () => void) => (show = s));
    setupPromo(document, {
      reducedMotion: false,
      whenLoaded: (r) => (ready = r),
      whenVisible,
    });
    // Before the load event it does not even watch for visibility.
    expect(whenVisible).not.toHaveBeenCalled();
    ready!();
    expect(whenVisible).toHaveBeenCalledOnce();
    expect(sources.every((s) => !s.hasAttribute("src"))).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
    show!();
    expect(sources.map((s) => s.getAttribute("src"))).toEqual([
      "/promo/promo-720.webm",
      "/promo/promo-720.mp4",
    ]);
    expect(video.play).toHaveBeenCalled();
    expect(button.hidden).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Pausar el vídeo");
  });

  it("the button pauses and plays again, labelled in each language", () => {
    const { video, button } = mount();
    setupPromo(document, {
      reducedMotion: false,
      whenLoaded: (r) => r(),
      whenVisible: (_, s) => s(),
    });
    button.click();
    expect(video.paused).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Reproducir el vídeo");
    setLang("en");
    labelPromo();
    expect(button.getAttribute("aria-label")).toBe("Play the video");
    button.click();
    expect(video.paused).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Pause the video");
  });

  it("with reduced motion, only the poster: never loaded nor played", () => {
    const { video, sources, button, figure } = mount();
    const whenLoaded = vi.fn();
    const whenVisible = vi.fn();
    setupPromo(document, { reducedMotion: true, whenLoaded, whenVisible });
    expect(whenLoaded).not.toHaveBeenCalled();
    expect(whenVisible).not.toHaveBeenCalled();
    expect(video.hidden).toBe(true);
    expect(video.hasAttribute("autoplay")).toBe(false);
    expect(sources.every((s) => !s.hasAttribute("src"))).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
    expect(button.hidden).toBe(true);
    expect(figure.dataset.state).toBe("poster");
  });

  it("is not precached by the service worker", () => {
    const config = readFileSync(join(root, "vite.config.ts"), "utf8");
    expect(config).toMatch(/globIgnores: \[[^\]]*"promo\/\*\*"/);
    const patterns = config.match(/globPatterns: \[([^\]]*)\]/)![1]!;
    for (const ext of ["mp4", "webm", "webp", "jpg", "gif"])
      expect(patterns).not.toContain(ext);
  });
});
