// @vitest-environment jsdom
// Landing page: the promo video in the hero, in the page's language (muted
// loop, fetched only after the page has loaded and once in view, poster only
// with reduced motion, accessible pause button, the other language fetched
// only after a switch, not precached).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "../src/i18n/core";
import {
  PROMO_FILES,
  labelPromo,
  setupPromo,
  type PromoOptions,
} from "../src/landing/promo";

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
    sources: [...document.querySelectorAll("video source")],
    posterSource: document.querySelector("picture source")!,
    posterImg: document.querySelector("picture img")!,
  };
}

/** Video URLs the element points at. */
const videoSrcs = (sources: Element[]) =>
  sources.map((s) => s.getAttribute("src"));

/** Options where the page has loaded and the video is in view. */
const inView = (): PromoOptions => ({
  reducedMotion: false,
  whenLoaded: (r) => r(),
  whenVisible: (_, s) => s(),
});

beforeEach(() => {
  setLang("es");
  // jsdom has no media playback: a minimal one.
  let paused = true;
  Object.defineProperty(HTMLMediaElement.prototype, "paused", {
    configurable: true,
    get: () => paused,
  });
  HTMLMediaElement.prototype.load = vi.fn(() => {
    paused = true;
  });
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
  it("is muted, inline, looping and not preloaded; no file in the markup", () => {
    const { video, sources } = mount();
    for (const attr of ["muted", "loop", "playsinline"])
      expect(video.hasAttribute(attr), attr).toBe(true);
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.hasAttribute("controls")).toBe(false);
    // WebM first, MP4 as the fallback.
    expect(sources.map((s) => s.getAttribute("type"))).toEqual([
      "video/webm",
      "video/mp4",
    ]);
    // Which files depends on the language, decided in the browser: no
    // attribute in the markup that the browser would fetch on its own.
    expect(section.replace(/<script>[^]*?<\/script>/g, "")).not.toMatch(
      /\/promo\//,
    );
    expect(section).not.toContain('loading="lazy"');
    expect(section).toContain('fetchpriority="high"');
  });

  it("the head preloads the poster of the visitor's language only", () => {
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).not.toMatch(/<link[^>]+promo-poster/);
    const script = head.slice(head.lastIndexOf("<script>") + 8);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const run = (lang: string) => {
      document.head.innerHTML = "";
      document.documentElement.lang = "en";
      localStorage.setItem("inkognitopdf.lang", lang);
      new Function(script.slice(0, script.indexOf("</script>")))();
      return [...document.head.querySelectorAll("link")].map((l) => ({
        rel: l.rel,
        as: l.getAttribute("as"),
        href: l.getAttribute("href"),
        priority: l.getAttribute("fetchpriority"),
      }));
    };
    for (const lang of ["es", "en"] as const)
      expect(run(lang)).toEqual([
        {
          rel: "preload",
          as: "image",
          href: PROMO_FILES[lang].webp,
          priority: "high",
        },
      ]);
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("the script after the poster sets it in the page's language while parsing", () => {
    const script = section.slice(
      section.indexOf("<script>") + 8,
      section.indexOf("</script>"),
    );
    const call = "(document.currentScript.previousElementSibling);";
    expect(script).toContain(call);
    for (const lang of ["es", "en"] as const) {
      const { posterSource, posterImg, sources } = mount();
      document.documentElement.lang = lang;
      new Function("picture", script.replace(call, "(picture);"))(
        document.querySelector("picture"),
      );
      expect(posterSource.getAttribute("srcset")).toBe(PROMO_FILES[lang].webp);
      expect(posterImg.getAttribute("src")).toBe(PROMO_FILES[lang].jpg);
      expect(videoSrcs(sources)).toEqual([null, null]);
    }
  });

  it("takes the place of the illustration in the hero, with no heading", () => {
    expect(section).toContain("data-promo");
    expect(hero).not.toContain("hero-art");
    expect(html).not.toContain('class="promo"');
    expect(section).not.toMatch(/<h[1-6]/);
  });

  it("shows the poster of the page's language at once", () => {
    for (const lang of ["es", "en"] as const) {
      const { posterSource, posterImg, sources } = mount();
      setupPromo(
        document,
        { reducedMotion: false, whenLoaded: () => {}, whenVisible: () => {} },
        lang,
      );
      expect(posterSource.getAttribute("srcset")).toBe(PROMO_FILES[lang].webp);
      expect(posterImg.getAttribute("src")).toBe(PROMO_FILES[lang].jpg);
      expect(videoSrcs(sources)).toEqual([null, null]);
    }
  });

  it("loads and plays only after the page has loaded and once in view", () => {
    const { video, sources, button } = mount();
    let ready: (() => void) | null = null;
    let show: (() => void) | null = null;
    const whenVisible = vi.fn((_: Element, s: () => void) => (show = s));
    setupPromo(
      document,
      { reducedMotion: false, whenLoaded: (r) => (ready = r), whenVisible },
      "es",
    );
    // Before the load event it does not even watch for visibility.
    expect(whenVisible).not.toHaveBeenCalled();
    ready!();
    expect(whenVisible).toHaveBeenCalledOnce();
    expect(videoSrcs(sources)).toEqual([null, null]);
    expect(video.play).not.toHaveBeenCalled();
    show!();
    expect(videoSrcs(sources)).toEqual([
      PROMO_FILES.es.webm,
      PROMO_FILES.es.mp4,
    ]);
    expect(video.play).toHaveBeenCalled();
    expect(button.hidden).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Pausar el vídeo");
  });

  it("in English, the English files", () => {
    setLang("en");
    const { sources, posterImg } = mount();
    setupPromo(document, inView(), "en");
    expect(posterImg.getAttribute("src")).toBe(PROMO_FILES.en.jpg);
    expect(videoSrcs(sources)).toEqual([
      PROMO_FILES.en.webm,
      PROMO_FILES.en.mp4,
    ]);
  });

  it("a switch before the video is fetched changes only the poster", () => {
    const { sources, posterSource, video } = mount();
    let show: (() => void) | null = null;
    const promo = setupPromo(
      document,
      {
        reducedMotion: false,
        whenLoaded: (r) => r(),
        whenVisible: (_, s) => (show = s),
      },
      "en",
    )!;
    promo.setLang("es");
    expect(posterSource.getAttribute("srcset")).toBe(PROMO_FILES.es.webp);
    expect(videoSrcs(sources)).toEqual([null, null]);
    expect(video.load).not.toHaveBeenCalled();
    // In view later: the new language's video, never the old one.
    show!();
    expect(videoSrcs(sources)).toEqual([
      PROMO_FILES.es.webm,
      PROMO_FILES.es.mp4,
    ]);
  });

  it("a switch while playing loads the new video and keeps playing", () => {
    const { sources, video, figure } = mount();
    const promo = setupPromo(document, inView(), "es")!;
    expect(video.paused).toBe(false);
    vi.mocked(video.play).mockClear();
    setLang("en");
    promo.setLang("en");
    expect(videoSrcs(sources)).toEqual([
      PROMO_FILES.en.webm,
      PROMO_FILES.en.mp4,
    ]);
    expect(video.load).toHaveBeenCalledTimes(2);
    expect(video.play).toHaveBeenCalledOnce();
    expect(video.paused).toBe(false);
    expect(figure.dataset.state).toBe("playing");
  });

  it("a switch while paused loads the new video but stays paused", () => {
    const { sources, video, button, figure, posterImg } = mount();
    const promo = setupPromo(document, inView(), "es")!;
    button.click();
    expect(video.paused).toBe(true);
    vi.mocked(video.play).mockClear();
    setLang("en");
    promo.setLang("en");
    expect(videoSrcs(sources)).toEqual([
      PROMO_FILES.en.webm,
      PROMO_FILES.en.mp4,
    ]);
    expect(video.play).not.toHaveBeenCalled();
    expect(video.paused).toBe(true);
    // The new poster shows until the visitor plays it again.
    expect(figure.dataset.state).toBe("switching");
    expect(posterImg.getAttribute("src")).toBe(PROMO_FILES.en.jpg);
    expect(button.getAttribute("aria-label")).toBe("Play the video");
    button.click();
    expect(video.paused).toBe(false);
    expect(figure.dataset.state).toBe("playing");
  });

  it("the button pauses and plays again, labelled in each language", () => {
    const { video, button } = mount();
    setupPromo(document, inView(), "es");
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

  it("with reduced motion, only the poster in each language: never loaded nor played", () => {
    const { video, sources, button, figure, posterImg } = mount();
    const whenLoaded = vi.fn();
    const whenVisible = vi.fn();
    const promo = setupPromo(
      document,
      { reducedMotion: true, whenLoaded, whenVisible },
      "es",
    )!;
    expect(whenLoaded).not.toHaveBeenCalled();
    expect(whenVisible).not.toHaveBeenCalled();
    expect(video.hidden).toBe(true);
    expect(posterImg.getAttribute("src")).toBe(PROMO_FILES.es.jpg);
    promo.setLang("en");
    expect(posterImg.getAttribute("src")).toBe(PROMO_FILES.en.jpg);
    expect(videoSrcs(sources)).toEqual([null, null]);
    expect(video.load).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    expect(button.hidden).toBe(true);
    expect(figure.dataset.state).toBe("poster");
  });

  it("the files of both languages are in public/promo", () => {
    for (const files of Object.values(PROMO_FILES))
      for (const path of Object.values(files))
        expect(() => readFileSync(join(root, "public", path))).not.toThrow();
  });

  it("is not precached by the service worker", () => {
    const config = readFileSync(join(root, "vite.config.ts"), "utf8");
    expect(config).toMatch(/globIgnores: \[[^\]]*"promo\/\*\*"/);
    const patterns = config.match(/globPatterns: \[([^\]]*)\]/)![1]!;
    for (const ext of ["mp4", "webm", "webp", "jpg", "gif"])
      expect(patterns).not.toContain(ext);
  });
});
