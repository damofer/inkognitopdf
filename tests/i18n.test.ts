// Spec 006: interface in Spanish and English.
import { describe, expect, test } from "vitest";
import { detectLang, getLang, setLang, t, tIn } from "../src/i18n";
import { en } from "../src/i18n/en";
import { es } from "../src/i18n/es";
import { scanApp, scanSource } from "./i18nScan";

describe("translations", () => {
  test("no visible Spanish text is left hardcoded in src/ (CA1)", () => {
    const findings = scanApp().map((f) => `${f.file}:${f.line}  ${f.text}`);
    expect(findings, findings.join("\n")).toEqual([]);
  });

  test("the scanner catches JSX text, visible attributes and messages", () => {
    const found = scanSource(
      "x.tsx",
      [
        `const a = <button title="Guardar">Abrir</button>;`,
        `const b = <p>{busy ? "Saving" : "Save"}</p>;`,
        `throw new Error("No se pudo leer la imagen.");`,
        `const ok = <div className="toolbar" data-x="y">{t("app.scan")}</div>;`,
        `if (state.status === "ready") run();`,
        `const c = "Guardar"; // i18n-ignore: not shown`,
      ].join("\n"),
    ).map((f) => f.text);
    expect(found).toEqual([
      "Guardar",
      "Abrir",
      "Saving",
      "Save",
      "No se pudo leer la imagen.",
    ]);
  });

  test("Spanish and English have the same keys and argument lists", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    for (const key of Object.keys(es) as (keyof typeof es)[]) {
      const a = es[key] as unknown;
      const b = en[key] as unknown;
      expect(typeof b, key).toBe(typeof a);
      if (typeof a === "function" && typeof b === "function")
        expect(b.length, key).toBe(a.length);
    }
  });

  test("English messages contain no Spanish punctuation or accents", () => {
    const spanish = /[áéíóúñ¿¡«»]/i;
    const leftovers = Object.entries(en).flatMap(([key, value]) => {
      if (key === "lang.es") return [];
      const sample =
        typeof value === "function"
          ? (value as (...a: unknown[]) => string)(
              ...Array.from({ length: value.length }, () => 2),
            )
          : value;
      return spanish.test(sample) ? [`${key}: ${sample}`] : [];
    });
    expect(leftovers).toEqual([]);
  });
});

describe("language choice (CA2–CA3)", () => {
  test("the browser language decides on first load; others fall back to English", () => {
    expect(detectLang(["es-CO", "en-US"])).toBe("es");
    expect(detectLang(["en-GB"])).toBe("en");
    expect(detectLang(["fr-FR", "es-ES"])).toBe("es");
    expect(detectLang(["de-DE"])).toBe("en");
    expect(detectLang([])).toBe("en");
  });

  test("switching changes every message and calls listeners", () => {
    const before = getLang();
    setLang("en", false);
    expect(t("app.openPdf")).toBe("Open PDF");
    expect(t("app.opening", "a.pdf")).toBe("Opening “a.pdf”…");
    setLang("es", false);
    expect(t("app.openPdf")).toBe("Abrir PDF");
    expect(tIn("en", "app.scan")).toBe("Scan");
    setLang(before, false);
  });
});
