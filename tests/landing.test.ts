// Spec 008: the landing page's texts come from src/i18n and are written into
// its HTML by the build.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";
import { attrPairs, prerender } from "../src/landing/prerender";

const html = readFileSync(
  join(import.meta.dirname, "..", "index.html"),
  "utf8",
);
const keys = [
  ...[...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]),
  ...[...html.matchAll(/data-i18n-attr="([^"]+)"/g)].flatMap((m) =>
    attrPairs(m[1] ?? "").map(([, key]) => key),
  ),
];

describe("landing page", () => {
  test("every text key exists as a plain string in both languages", () => {
    expect(keys.length).toBeGreaterThan(50);
    for (const key of keys) {
      expect(typeof en[key as keyof typeof en], key).toBe("string");
      expect(typeof es[key as keyof typeof es], key).toBe("string");
    }
  });

  test("prerender fills texts and attributes, escaping HTML", () => {
    const out = prerender(
      `<title data-i18n="a"></title><h1 data-i18n="b"></h1><meta data-i18n-attr="content:a;title:b" />`,
      (key) => (key === "a" ? "A & B" : `<x> "y"`),
    );
    expect(out).toBe(
      `<title data-i18n="a">A &amp; B</title><h1 data-i18n="b">&lt;x&gt; &quot;y&quot;</h1>` +
        `<meta data-i18n-attr="content:a;title:b" content="A &amp; B" title="&lt;x&gt; &quot;y&quot;" />`,
    );
  });

  test("the whole page is filled, with no empty text element left", () => {
    const out = prerender(html, (key) => en[key as keyof typeof en] as string);
    expect(out).not.toMatch(/data-i18n="[^"]+"[^>]*><\//);
    expect(out).toContain("Your documents never leave your device");
  });

  test("every call to action opens the app at /app/", () => {
    const appLinks = [...html.matchAll(/href="\/app\/"/g)];
    expect(appLinks.length).toBeGreaterThanOrEqual(3);
  });
});
