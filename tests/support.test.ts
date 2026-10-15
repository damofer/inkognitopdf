// Donations: the same links in the app and on the landing, each opening a
// new tab without opener or referrer, in the order of the language.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { sanitize } from "../src/analytics/events";
import { setLang } from "../src/i18n/core";
import { SupportLinks } from "../src/support/SupportPanel";

const EXPECTED = [
  ["10000", "https://mpago.li/1Kyib9Q", "$10.000 COP"],
  ["20000", "https://mpago.li/1sVMAt1", "$20.000 COP"],
  ["50000", "https://mpago.li/2s9ot7Z", "$50.000 COP"],
  ["other", "https://link.mercadopago.com.co/damofer"],
  ["kofi", "https://ko-fi.com/damofer"],
];

/** Every <a> with its attributes and text, in document order. */
function links(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>([^<]*)<\/a\s*>/g)].map((m) => {
    const attrs = Object.fromEntries(
      [...m[1]!.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]),
    );
    return { attrs, text: m[2]!.trim() };
  });
}

function rendered(lang: "es" | "en") {
  setLang(lang, false);
  return renderToStaticMarkup(createElement(SupportLinks));
}

afterEach(() => setLang("es", false));

describe("donations (app panel)", () => {
  it("shows the five links, each in a new tab without opener or referrer", () => {
    for (const lang of ["es", "en"] as const) {
      const found = links(rendered(lang));
      expect(found).toHaveLength(5);
      for (const [tier, url, amount] of EXPECTED) {
        const link = found.find((l) => l.attrs["data-tier"] === tier)!;
        expect(link.attrs.href).toBe(url);
        expect(link.attrs.target).toBe("_blank");
        expect(link.attrs.rel).toBe("noopener noreferrer");
        if (amount) expect(link.text).toBe(amount);
      }
    }
  });

  it("Spanish: Mercado Pago first, Ko-fi below for outside Colombia", () => {
    const html = rendered("es");
    expect(links(html).map((l) => l.attrs["data-tier"])).toEqual([
      "10000",
      "20000",
      "50000",
      "other",
      "kofi",
    ]);
    expect(html).toContain("Otro monto");
    expect(html.indexOf("Con Mercado Pago")).toBeLessThan(
      html.indexOf("¿Fuera de Colombia?"),
    );
    expect(html.indexOf("¿Fuera de Colombia?")).toBeLessThan(
      html.indexOf("Apoyar con Ko-fi"),
    );
  });

  it("English: Ko-fi first in USD, Mercado Pago below in COP", () => {
    const html = rendered("en");
    expect(links(html).map((l) => l.attrs["data-tier"])).toEqual([
      "kofi",
      "10000",
      "20000",
      "50000",
      "other",
    ]);
    expect(html).toContain("Support with Ko-fi");
    expect(html).toContain("USD");
    expect(html).toContain("Other amount");
    expect(html.indexOf("From Colombia?")).toBeGreaterThan(
      html.indexOf("Support with Ko-fi"),
    );
    expect(html).toContain("Colombian pesos (COP)");
  });

  it("measures only the amount tier", () => {
    expect(
      sanitize("donate_click", { tier: "kofi", url: "https://x", amount: 5 }),
    ).toEqual({ name: "donate_click", params: { tier: "kofi" } });
    expect(sanitize("donate_click", { tier: "999" })).toEqual({
      name: "donate_click",
      params: {},
    });
  });
});

describe("donations (landing)", () => {
  const html = readFileSync(
    join(import.meta.dirname, "..", "index.html"),
    "utf8",
  );

  it("has the same links with the same attributes, and no payment script", () => {
    const found = links(html.replace(/\s+/g, " ")).filter(
      (l) => l.attrs["data-tier"],
    );
    expect(found).toHaveLength(5);
    for (const [tier, url] of EXPECTED) {
      const link = found.find((l) => l.attrs["data-tier"] === tier)!;
      expect(link.attrs.href).toBe(url);
      expect(link.attrs.target).toBe("_blank");
      expect(link.attrs.rel).toBe("noopener noreferrer");
    }
    expect(html).not.toMatch(/<script[^>]+(mercadopago|ko-fi)/i);
  });
});
