// Amounts written in words, in Spanish and English (spec 021, CA6):
// 1 200 000 COP → "un millón doscientos mil pesos".
import type { Lang } from "../../i18n/core";

interface CurrencyName {
  es: [singular: string, plural: string, feminine?: boolean];
  en: [singular: string, plural: string];
  cents: { es: string; en: [string, string] };
}

const PESO: CurrencyName = {
  es: ["peso", "pesos"],
  en: ["peso", "pesos"],
  cents: { es: "centavos", en: ["cent", "cents"] },
};

const NAMES: Record<string, CurrencyName> = {
  COP: PESO,
  MXN: PESO,
  ARS: PESO,
  CLP: PESO,
  USD: {
    es: ["dólar", "dólares"],
    en: ["dollar", "dollars"],
    cents: { es: "centavos", en: ["cent", "cents"] },
  },
  EUR: {
    es: ["euro", "euros"],
    en: ["euro", "euros"],
    cents: { es: "céntimos", en: ["cent", "cents"] },
  },
  PEN: {
    es: ["sol", "soles"],
    en: ["sol", "soles"],
    cents: { es: "céntimos", en: ["cent", "cents"] },
  },
  GBP: {
    es: ["libra esterlina", "libras esterlinas", true],
    en: ["pound", "pounds"],
    cents: { es: "peniques", en: ["penny", "pence"] },
  },
};

// Spanish ------------------------------------------------------------------

const ES_SMALL = [
  "cero",
  "uno",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "once",
  "doce",
  "trece",
  "catorce",
  "quince",
  "dieciséis",
  "diecisiete",
  "dieciocho",
  "diecinueve",
  "veinte",
  "veintiuno",
  "veintidós",
  "veintitrés",
  "veinticuatro",
  "veinticinco",
  "veintiséis",
  "veintisiete",
  "veintiocho",
  "veintinueve",
];
const ES_TENS = [
  "",
  "",
  "",
  "treinta",
  "cuarenta",
  "cincuenta",
  "sesenta",
  "setenta",
  "ochenta",
  "noventa",
];
const ES_HUNDREDS = [
  "",
  "ciento",
  "doscientos",
  "trescientos",
  "cuatrocientos",
  "quinientos",
  "seiscientos",
  "setecientos",
  "ochocientos",
  "novecientos",
];

/** "uno" before a noun: "un" (masculine) or "una" (feminine). */
function apocope(words: string, feminine: boolean): string {
  const one = feminine ? "una" : "un";
  if (words === "uno") return one;
  if (words.endsWith("veintiuno"))
    return words.replace(/veintiuno$/, feminine ? "veintiuna" : "veintiún");
  if (words.endsWith(" y uno")) return words.replace(/ y uno$/, ` y ${one}`);
  if (words.endsWith(" uno")) return words.replace(/ uno$/, ` ${one}`);
  return words;
}

function esBelowThousand(n: number, feminine: boolean): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  let hundred = ES_HUNDREDS[hundreds]!;
  if (feminine) hundred = hundred.replace(/ientos$/, "ientas");
  let tail = "";
  if (rest > 0)
    tail =
      rest < 30
        ? ES_SMALL[rest]!
        : ES_TENS[Math.floor(rest / 10)]! +
          (rest % 10 ? ` y ${ES_SMALL[rest % 10]}` : "");
  return [hundred, tail].filter(Boolean).join(" ");
}

/** An integer in Spanish words; `feminine` agrees with the noun that follows. */
export function spanishWords(n: number, feminine = false): string {
  if (n === 0) return "cero";
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const units = n % 1000;
  const parts: string[] = [];
  if (millions > 0)
    parts.push(
      millions === 1
        ? "un millón"
        : `${apocope(spanishWords(millions), false)} millones`,
    );
  if (thousands > 0)
    parts.push(
      thousands === 1
        ? "mil"
        : `${apocope(esBelowThousand(thousands, feminine), feminine)} mil`,
    );
  if (units > 0) parts.push(esBelowThousand(units, feminine));
  return parts.join(" ");
}

// English ------------------------------------------------------------------

const EN_SMALL = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const EN_TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function enBelowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${EN_SMALL[hundreds]} hundred`);
  if (rest)
    parts.push(
      rest < 20
        ? EN_SMALL[rest]!
        : EN_TENS[Math.floor(rest / 10)]! +
            (rest % 10 ? `-${EN_SMALL[rest % 10]}` : ""),
    );
  return parts.join(" ");
}

export function englishWords(n: number): string {
  if (n === 0) return "zero";
  const scales: [number, string][] = [
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1000, "thousand"],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [size, name] of scales) {
    const count = Math.floor(rest / size);
    if (count) parts.push(`${enBelowThousand(count)} ${name}`);
    rest %= size;
  }
  if (rest) parts.push(enBelowThousand(rest));
  return parts.join(" ");
}

// Amounts ------------------------------------------------------------------

/** An amount with its currency in words; cents in words too when present. */
export function amountInWords(
  amount: number,
  currency: string,
  lang: Lang,
): string {
  const name = NAMES[currency];
  const rounded = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(rounded / 100);
  const cents = rounded % 100;
  if (lang === "es") {
    const [singular, plural, feminine = false] = name?.es ?? [
      currency,
      currency,
    ];
    let words = apocope(spanishWords(whole, feminine), feminine);
    // "un millón de pesos", "dos millones de pesos".
    const noun = whole === 1 ? singular : plural;
    const de = /(millón|millones)$/.test(words) ? " de" : "";
    words = `${words}${de} ${noun}`;
    if (cents)
      words += ` con ${spanishWords(cents)} ${name?.cents.es ?? "centavos"}`;
    return words;
  }
  const [singular, plural] = name?.en ?? [currency, currency];
  let words = `${englishWords(whole)} ${whole === 1 ? singular : plural}`;
  if (cents) {
    const [one, many] = name?.cents.en ?? ["cent", "cents"];
    words += ` and ${englishWords(cents)} ${cents === 1 ? one : many}`;
  }
  return words;
}
