// Spec 036: the signing guide at /guia/firmar/, a static page whose texts
// come from src/i18n like the landing page's, with screenshots per language.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";
import { attrPairs, prerender } from "../src/landing/prerender";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const html = read("guia/firmar/index.html");
const keys = [
  ...[...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]!),
  ...[...html.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap((m) =>
    attrPairs(m[1] ?? "").map(([, key]) => key),
  ),
];
const shots = [...html.matchAll(/data-shot="([^"]+)"/g)].map((m) => m[1]!);
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);

describe("signing guide", () => {
  test("every text key exists as a plain string in both languages", () => {
    expect(keys.length).toBeGreaterThan(60);
    for (const key of keys) {
      expect(typeof en[key as keyof typeof en], key).toBe("string");
      expect(typeof es[key as keyof typeof es], key).toBe("string");
    }
  });

  test("the whole page is filled in English by the build", () => {
    const out = prerender(html, (key) => en[key as keyof typeof en] as string);
    expect(out).not.toMatch(/data-i18n="[^"]+"[^>]*><\//);
    expect(out).toContain("Several people sign the same PDF");
  });

  test("every screenshot exists in both languages, and only those", () => {
    expect(shots.length).toBe(8);
    for (const lang of ["es", "en"]) {
      const dir = join(root, "public", "guia", "firmar", "img", lang);
      expect(readdirSync(dir).sort()).toEqual(
        shots.map((name) => `${name}.webp`).sort(),
      );
    }
    // Written in English, like the texts; main.ts switches them.
    for (const name of shots)
      expect(html).toContain(`src="/guia/firmar/img/en/${name}.webp"`);
  });

  test("the app and the landing page link to the guide's sections", () => {
    const link = read("src/sign/GuideLink.tsx");
    for (const section of ["firma-digital", "varios-firmantes"]) {
      expect(link).toContain(`"${section}"`);
      expect(ids).toContain(section);
    }
    expect(read("index.html")).toContain('href="/guia/firmar/"');
    expect(read("public/sitemap.xml")).toContain(
      "https://inkognitopdf.com/guia/firmar/",
    );
    expect(read("vite.config.ts")).toContain('"guia/firmar/index.html"');
  });
});
