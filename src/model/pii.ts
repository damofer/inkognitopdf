// Personal data in text (spec 016): identity numbers, bank accounts, cards,
// emails and phones of Spain and Latin America. Patterns with their check
// digits, so a number that only looks like one is not proposed. No network,
// no AI: everything runs on the device.

export type PiiKind =
  | "idEs"
  | "taxIdEs"
  | "idCo"
  | "nitCo"
  | "rutCl"
  | "cuitAr"
  | "cpfBr"
  | "curpMx"
  | "iban"
  | "card"
  | "email"
  | "phone"
  | "birthDate";

/** In the order the review shows them. */
export const PII_KINDS: readonly PiiKind[] = [
  "idEs",
  "taxIdEs",
  "idCo",
  "nitCo",
  "rutCl",
  "cuitAr",
  "cpfBr",
  "curpMx",
  "iban",
  "card",
  "email",
  "phone",
  "birthDate",
];

export interface PiiMatch {
  kind: PiiKind;
  /** Range in the text searched. */
  start: number;
  end: number;
  /** The text found, spaces normalized. */
  value: string;
}

const digits = (s: string) => s.replace(/\D/g, "");

// --- Check digits -----------------------------------------------------------

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** Spanish DNI (8 digits + letter) and NIE (X/Y/Z + 7 digits + letter). */
export function validSpanishId(value: string): boolean {
  const v = value.toUpperCase().replace(/[\s.-]/g, "");
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(v);
  if (!m) return false;
  const [, prefix, num, letter] = m;
  if (prefix ? num!.length !== 7 : num!.length !== 8) return false;
  const n = Number(`${prefix ? "XYZ".indexOf(prefix) : ""}${num}`);
  return DNI_LETTERS[n % 23] === letter;
}

/** Spanish CIF / company NIF: letter, 7 digits, control digit or letter. */
export function validSpanishCif(value: string): boolean {
  const v = value.toUpperCase().replace(/[\s.-]/g, "");
  const m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(v);
  if (!m) return false;
  const [, letter, body, control] = m;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(body![i]);
    if (i % 2 === 0) {
      const x = d * 2;
      sum += Math.floor(x / 10) + (x % 10);
    } else sum += d;
  }
  const c = (10 - (sum % 10)) % 10;
  const asLetter = "JABCDEFGHI"[c]!;
  if ("PQRSNW".includes(letter!)) return control === asLetter;
  if ("ABEH".includes(letter!)) return control === String(c);
  return control === String(c) || control === asLetter;
}

/** IBAN: ISO 13616 mod 97. */
export function validIban(value: string): boolean {
  const v = value.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  const moved = v.slice(4) + v.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const n = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of n) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** Card numbers: Luhn, 13–19 digits, a known first digit. */
export function validCard(value: string): boolean {
  const d = digits(value);
  if (d.length < 13 || d.length > 19 || !/^[2-6]/.test(d)) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Colombian NIT: 9 digits and its check digit (DIAN weights). */
export function validNit(value: string): boolean {
  const [body = "", dv] = value.split("-");
  const d = digits(body);
  if (d.length < 8 || d.length > 10 || dv === undefined) return false;
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  let sum = 0;
  for (let i = 0; i < d.length; i++)
    sum += Number(d[d.length - 1 - i]) * weights[i]!;
  const r = sum % 11;
  return Number(digits(dv)) === (r > 1 ? 11 - r : r);
}

/** Chilean RUT: mod 11, check digit 0–9 or K. */
export function validRut(value: string): boolean {
  const m = /^([\d.]+)-([\dkK])$/.exec(value.trim());
  if (!m) return false;
  const d = digits(m[1]!);
  if (d.length < 7 || d.length > 8) return false;
  let sum = 0;
  let w = 2;
  for (let i = d.length - 1; i >= 0; i--) {
    sum += Number(d[i]) * w;
    w = w === 7 ? 2 : w + 1;
  }
  const r = 11 - (sum % 11);
  const dv = r === 11 ? "0" : r === 10 ? "K" : String(r);
  return dv === m[2]!.toUpperCase();
}

/** Argentine CUIT/CUIL: 11 digits, mod 11. */
export function validCuit(value: string): boolean {
  const d = digits(value);
  if (d.length !== 11 || !/^(20|23|24|27|30|33|34)/.test(d)) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * weights[i]!;
  const r = 11 - (sum % 11);
  const dv = r === 11 ? 0 : r === 10 ? 9 : r;
  return dv === Number(d[10]);
}

/** Brazilian CPF: 11 digits, two check digits. */
export function validCpf(value: string): boolean {
  const d = digits(value);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

/** Mexican CURP: 18 characters, its last digit checks the rest. */
export function validCurp(value: string): boolean {
  const v = value.toUpperCase();
  if (!/^[A-Z][AEIOUX][A-Z]{2}\d{6}[HMX][A-Z]{5}[A-Z0-9]\d$/.test(v))
    return false;
  const alphabet = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"; // i18n-ignore: CURP alphabet
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += alphabet.indexOf(v[i]!) * (18 - i);
  return (10 - (sum % 10)) % 10 === Number(v[17]);
}

// --- Patterns ---------------------------------------------------------------

interface Rule {
  kind: PiiKind;
  pattern: RegExp;
  /** Index of the group holding the value (0: the whole match). */
  group?: number;
  valid?: (value: string) => boolean;
}

const B = "(?<![\\p{L}\\p{N}])"; // no letter or digit before
const E = "(?![\\p{L}\\p{N}])"; // nor after

const RULES: Rule[] = [
  {
    kind: "idEs",
    pattern: new RegExp(
      `${B}[XYZxyz]?[- ]?\\d{1,2}\\.?\\d{3}\\.?\\d{3}[- ]?[A-Za-z]${E}`,
      "gu",
    ),
    valid: validSpanishId,
  },
  {
    kind: "taxIdEs",
    pattern: new RegExp(`${B}[ABCDEFGHJNPQRSUVW]-?\\d{7}-?[0-9A-J]${E}`, "gu"),
    valid: validSpanishCif,
  },
  {
    kind: "nitCo",
    pattern: new RegExp(`${B}\\d{3}\\.?\\d{3}\\.?\\d{3}-\\d${E}`, "gu"),
    valid: validNit,
  },
  {
    // A Colombian ID has no check digit: only after its name.
    kind: "idCo",
    pattern: new RegExp(
      // i18n-ignore: the words that introduce a Colombian ID
      `${B}(?:C\\.?\\s?C\\.?|c[eé]dula(?:\\s+de\\s+ciudadan[ií]a)?)\\s*(?:n[uú]mero|no\\.?|n\\.?º|#)?\\s*:?\\s*(\\d{1,3}(?:[.\\s]?\\d{3}){1,3})${E}`,
      "giu",
    ),
    group: 1,
  },
  {
    kind: "rutCl",
    pattern: new RegExp(`${B}\\d{1,2}\\.?\\d{3}\\.?\\d{3}-[\\dkK]${E}`, "gu"),
    valid: validRut,
  },
  {
    kind: "cuitAr",
    pattern: new RegExp(`${B}\\d{2}-\\d{8}-\\d${E}`, "gu"),
    valid: validCuit,
  },
  {
    kind: "cpfBr",
    pattern: new RegExp(`${B}\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}${E}`, "gu"),
    valid: validCpf,
  },
  {
    kind: "curpMx",
    pattern: new RegExp(
      `${B}[A-Z][AEIOUX][A-Z]{2}\\d{6}[HMX][A-Z]{5}[A-Z0-9]\\d${E}`,
      "gu",
    ),
    valid: validCurp,
  },
  {
    kind: "iban",
    pattern: new RegExp(
      `${B}[A-Z]{2}\\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?${E}`,
      "gu",
    ),
    valid: validIban,
  },
  {
    kind: "card",
    pattern: new RegExp(`${B}\\d(?:[ -]?\\d){12,18}${E}`, "gu"),
    valid: validCard,
  },
  {
    kind: "email",
    pattern: new RegExp(
      `${B}[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}.-]+\\.[\\p{L}]{2,}${E}`,
      "gu",
    ),
  },
  {
    // International (+34 …), Spanish (9 digits from 6–9) and Colombian
    // mobiles (10 digits from 3).
    kind: "phone",
    pattern: new RegExp(
      `${B}(?:\\+\\d{1,3}[ .-]?(?:\\(\\d{1,4}\\)[ .-]?)?\\d{2,4}(?:[ .-]?\\d{2,4}){1,3}|[6789]\\d{2}(?:[ .-]?\\d{2,3}){3}|[6789]\\d{8}|3\\d{2}[ .-]?\\d{3}[ .-]?\\d{4})${E}`,
      "gu",
    ),
    valid: (v) => {
      const n = digits(v).length;
      return n >= 9 && n <= 15;
    },
  },
  {
    kind: "birthDate",
    pattern: new RegExp(
      // i18n-ignore: the words that introduce a birth date
      `(?:nacimiento|nacid[oa]|f\\.?\\s?nac\\.?|date of birth|born|DOB)\\s*(?:el|on|:)?\\s*:?\\s*(\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{1,2} de \\p{L}+ de \\d{4})`,
      "giu",
    ),
    group: 1,
  },
];

/** Every piece of personal data in `text`, without overlaps, in order. */
export function findPersonalData(text: string): PiiMatch[] {
  const found: PiiMatch[] = [];
  for (const rule of RULES)
    for (const m of text.matchAll(rule.pattern)) {
      const raw = m[rule.group ?? 0];
      if (!raw) continue;
      const offset = rule.group ? m[0].lastIndexOf(raw) : 0;
      const start = m.index + offset;
      const end = start + raw.length;
      if (raw.includes("\n")) continue;
      if (rule.valid && !rule.valid(raw)) continue;
      // The first rule wins: an ID is not also a phone.
      if (found.some((f) => f.start < end && start < f.end)) continue;
      found.push({
        kind: rule.kind,
        start,
        end,
        value: raw.replace(/\s+/g, " "),
      });
    }
  return found.sort((a, b) => a.start - b.start);
}
