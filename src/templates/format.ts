// Money, dates and defaults by country for templates (spec 021).
import type { Lang } from "../i18n/core";
import type { PaperSize } from "./types";

/** Currencies offered in billing templates. */
export const CURRENCIES = [
  "COP",
  "MXN",
  "USD",
  "EUR",
  "ARS",
  "CLP",
  "PEN",
  "GBP",
] as const;
export type Currency = (typeof CURRENCIES)[number];

const LOCALE: Record<Lang, string> = { es: "es-CO", en: "en-US" };

/** Currencies written without cents. */
const NO_CENTS = new Set<string>(["COP", "CLP"]);

const currencyOfRegion: Record<string, Currency> = {
  CO: "COP",
  MX: "MXN",
  US: "USD",
  ES: "EUR",
  AR: "ARS",
  CL: "CLP",
  PE: "PEN",
  GB: "GBP",
  EC: "USD",
  PA: "USD",
  SV: "USD",
  PR: "USD",
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  PT: "EUR",
  NL: "EUR",
  IE: "EUR",
};

/** Countries that use US Letter paper. */
const LETTER_REGIONS = new Set([
  "US",
  "CA",
  "MX",
  "CO",
  "VE",
  "CL",
  "PH",
  "GT",
  "CR",
  "DO",
  "PR",
  "PA",
  "SV",
  "HN",
  "NI",
]);

const regionOf = (tag: string) => {
  try {
    return new Intl.Locale(tag).maximize().region ?? null;
  } catch {
    return null;
  }
};

const browserLanguages = (): readonly string[] =>
  globalThis.navigator?.languages ?? [];

/** The currency of the browser's country; US dollars when unknown. */
export function defaultCurrency(
  languages: readonly string[] = browserLanguages(),
): Currency {
  for (const tag of languages) {
    if (!/-/.test(tag)) continue;
    const currency = currencyOfRegion[regionOf(tag) ?? ""];
    if (currency) return currency;
  }
  return "USD";
}

/** Letter in the Americas and the Philippines, A4 elsewhere (spec 021, CA7). */
export function defaultPaper(
  languages: readonly string[] = browserLanguages(),
): PaperSize {
  const tag = languages.find((l) => /-/.test(l));
  if (!tag) return "a4";
  return LETTER_REGIONS.has(regionOf(tag) ?? "") ? "letter" : "a4";
}

/** Parses a number typed by the user: "1.200.000", "1,200.50", "1200,5". */
export function parseAmount(text: string): number {
  const clean = text.replace(/[^\d.,-]/g, "");
  if (!clean) return 0;
  const lastDot = clean.lastIndexOf(".");
  const lastComma = clean.lastIndexOf(",");
  const decimalAt = Math.max(lastDot, lastComma);
  let normalized = clean;
  if (decimalAt >= 0) {
    const decimals = clean.length - decimalAt - 1;
    const separator = clean[decimalAt]!;
    const repeated = clean.split(separator).length > 2;
    // "1.200" or "1,200.000": thousands, not decimals.
    const isDecimal = !repeated && decimals !== 3;
    normalized = isDecimal
      ? clean.slice(0, decimalAt).replace(/[.,]/g, "") +
        "." +
        clean.slice(decimalAt + 1)
      : clean.replace(/[.,]/g, "");
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

export function formatMoney(amount: number, currency: string, lang: Lang) {
  const digits = NO_CENTS.has(currency) ? 0 : 2;
  try {
    return new Intl.NumberFormat(LOCALE[lang], {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency}`;
  }
}

/** "2026-10-17" → "17 de octubre de 2026"; other text is kept as typed. */
export function formatDate(iso: string, lang: Lang): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso.trim();
  const [, y, mo, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Today as "YYYY-MM-DD", in local time. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
