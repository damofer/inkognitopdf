// From a template and what the user wrote to a PDF (spec 021).
import type { LoadFont } from "../engine/fonts";
import type { Lang } from "../i18n/core";
import { amountInWords } from "./content/words";
import {
  defaultCurrency,
  formatDate,
  formatMoney,
  parseAmount,
  type Currency,
} from "./format";
import { renderTemplate } from "./render";
import type {
  BuildContext,
  FieldDef,
  Photo,
  Row,
  Style,
  Template,
  Values,
} from "./types";

/**
 * What the user changed: fields they typed in and lists they edited. The rest
 * comes from the template's sample in the current language (CA3).
 */
export interface Draft {
  fields: Record<string, string>;
  lists: Record<string, Row[]>;
}

export const emptyDraft = (): Draft => ({ fields: {}, lists: {} });

/** The currency the samples' amounts are written in. */
const SAMPLE_CURRENCY: Record<Lang, Currency> = { es: "COP", en: "USD" };

/** Rough units per US dollar, only to keep sample amounts believable. */
const SAMPLE_SCALE: Record<Currency, number> = {
  USD: 1,
  EUR: 1,
  GBP: 1,
  PEN: 4,
  MXN: 20,
  COP: 1000,
  ARS: 1000,
  CLP: 1000,
};

/**
 * The sample's amounts in another currency: a Colombian fee of 2.500.000
 * pesos reads as 2.500 euros, not 2.500.000 euros.
 */
function convertSample(
  sample: Values,
  fields: FieldDef[],
  lists: Template["lists"],
  from: Currency,
  to: Currency,
): Values {
  if (from === to) return sample;
  const factor = SAMPLE_SCALE[to] / SAMPLE_SCALE[from];
  const convert = (value: string) => {
    const amount = parseAmount(value);
    return amount ? String(Math.round(amount * factor)) : value;
  };
  const money = (defs: FieldDef[]) =>
    new Set(defs.filter((f) => f.kind === "money").map((f) => f.key));
  const moneyFields = money(fields);
  return {
    fields: Object.fromEntries(
      Object.entries(sample.fields).map(([k, v]) => [
        k,
        moneyFields.has(k) ? convert(v) : v,
      ]),
    ),
    lists: Object.fromEntries(
      Object.entries(sample.lists).map(([key, rows]) => {
        const keys = money(lists?.find((l) => l.key === key)?.fields ?? []);
        return [
          key,
          rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([k, v]) => [
                k,
                keys.has(k) ? convert(v) : v,
              ]),
            ),
          ),
        ];
      }),
    ),
  };
}

/**
 * The values shown: the sample in `lang`, overridden by the draft. The
 * sample's amounts follow the currency in use (chosen, or the country's).
 */
export function effectiveValues(
  t: Template,
  draft: Draft,
  lang: Lang,
  currencyFallback: Currency = defaultCurrency(),
): Values {
  let sample = t.sample(lang);
  const currency = (draft.fields.currency ||
    sample.fields.currency ||
    currencyFallback) as Currency;
  if (Object.hasOwn(SAMPLE_SCALE, currency))
    sample = convertSample(
      sample,
      t.fields,
      t.lists,
      SAMPLE_CURRENCY[lang],
      currency,
    );
  return {
    fields: { ...sample.fields, ...draft.fields },
    lists: { ...sample.lists, ...draft.lists },
  };
}

const isEmptyRow = (row: Row) => Object.values(row).every((v) => !v.trim());

export function buildContext(
  values: Values,
  lang: Lang,
  style: Style,
  photo: Photo | null,
  currencyFallback: string = defaultCurrency(),
): BuildContext {
  const v = (key: string) => (values.fields[key] ?? "").trim();
  const currency = () => v("currency") || currencyFallback;
  return {
    lang,
    style,
    photo,
    v,
    list: (key) =>
      (values.lists[key] ?? [])
        .filter((row) => !isEmptyRow(row))
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([k, val]) => [k, val.trim()]),
          ),
        ),
    tx: (text) => text[lang],
    money: (amount) => formatMoney(amount, currency(), lang),
    date: (iso) => formatDate(iso, lang),
    amountInWords: (amount) => amountInWords(amount, currency(), lang),
  };
}

/** A file name without characters that file systems reject. */
export const safeFileName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|\n\r\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "document";

export interface Generated {
  bytes: Uint8Array;
  fileName: string;
}

export async function generate(
  t: Template,
  values: Values,
  lang: Lang,
  style: Style,
  photo: Photo | null,
  loadFont: LoadFont,
  currencyFallback?: string,
): Promise<Generated> {
  const ctx = buildContext(
    values,
    lang,
    style,
    t.photo ? photo : null,
    currencyFallback,
  );
  const spec = t.build(ctx);
  const images: Record<string, Photo> = ctx.photo ? { photo: ctx.photo } : {};
  const bytes = await renderTemplate(spec, style, images, loadFont);
  return { bytes, fileName: `${safeFileName(t.fileName(ctx))}.pdf` };
}
