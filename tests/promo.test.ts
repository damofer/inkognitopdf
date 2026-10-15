// @vitest-environment jsdom
// Landing page: the promo video (muted loop, loaded only in view, poster
// only with reduced motion, accessible pause button, not precached).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../src/i18n/core";
import { labelPromo, setupPromo } from "../src/landing/promo";

const root = join(import.meta.dirname, "..");
const html = readFileSync(join(root, "index.html"), "utf8");
const section = html.slice(
  html.indexOf('<section class="promo"'),
  html.indexOf("</section>", html.indexOf('<section class="promo"')),
);

function mount() {
  document.body.innerHTML = section + "</section>";
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
    // The poster: WebP with a JPEG fallback, lazy.
    expect(section).toContain('srcset="/promo/promo-poster-720.webp"');
    expect(section).toContain('src="/promo/promo-poster-720.jpg"');
    expect(section).toContain('loading="lazy"');
  });

  it("loads and plays only once in view", () => {
    const { video, sources, button } = mount();
    let show: (() => void) | null = null;
    setupPromo(document, {
      reducedMotion: false,
      whenVisible: (_, s) => (show = s),
    });
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
    setupPromo(document, { reducedMotion: false, whenVisible: (_, s) => s() });
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
    const whenVisible = vi.fn();
    setupPromo(document, { reducedMotion: true, whenVisible });
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
