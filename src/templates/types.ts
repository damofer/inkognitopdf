// Reusable templates (spec 021): the shape of a template and of what the user
// fills in. Templates are code (src/templates/content/), their texts are data
// in Spanish and English.
import type { Lang } from "../i18n/core";
import type { Block, DocSpec } from "./layout";

/** A text in every interface language. */
export type Localized = Record<Lang, string>;

export type FieldKind =
  | "text"
  | "multiline"
  | "date"
  | "number"
  | "money"
  | "percent"
  | "currency"
  | "email"
  | "tel";

export interface FieldDef {
  key: string;
  kind: FieldKind;
  label: Localized;
  /** Shown next to the field, e.g. a format hint. */
  hint?: Localized;
}

/** A repeatable section: work experience, billed items… */
export interface ListDef {
  key: string;
  label: Localized;
  /** Label of the "add" button, e.g. "Añadir experiencia". */
  addLabel: Localized;
  fields: FieldDef[];
}

export type Row = Record<string, string>;

/** What the template shows: sample values, overridden by what the user wrote. */
export interface Values {
  fields: Record<string, string>;
  lists: Record<string, Row[]>;
}

export type Category = "jobs" | "billing" | "letters";
export const CATEGORIES: Category[] = ["jobs", "billing", "letters"];

export type PaperSize = "a4" | "letter";
export const PAPER: Record<PaperSize, readonly [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** Accent colors offered in the style picker. */
export const ACCENTS = [
  "#1F4E79",
  "#2E7D5B",
  "#8E2C48",
  "#C4561D",
  "#5B3F9E",
  "#2F3437",
] as const;

export type FontPair = "modern" | "classic" | "elegant";
export const FONT_PAIRS: FontPair[] = ["modern", "classic", "elegant"];

export interface Style {
  accent: string;
  fonts: FontPair;
  paper: PaperSize;
}

export interface Photo {
  bytes: Uint8Array;
  kind: "jpg" | "png";
}

/** Everything a template's `build` gets to lay out the document. */
export interface BuildContext {
  lang: Lang;
  style: Style;
  /** A field's value, trimmed. */
  v(key: string): string;
  /** A list's rows, without the rows the user left empty. */
  list(key: string): Row[];
  photo: Photo | null;
  /** The text of the template in the current language. */
  tx(text: Localized): string;
  money(amount: number): string;
  /** "2026-10-17" → "17 de octubre de 2026" / "October 17, 2026". */
  date(iso: string): string;
  /** A number written in words, with the currency: "mil pesos". */
  amountInWords(amount: number): string;
}

export interface Template {
  id: string;
  category: Category;
  name: Localized;
  description: Localized;
  /** Takes a photo (CVs). */
  photo?: boolean;
  /** Shown above the form: legal or tax caveats (spec 021, CA10). */
  notice?: Localized;
  fields: FieldDef[];
  lists?: ListDef[];
  /** Sample values in a language: the starting point the user edits. */
  sample(lang: Lang): Values;
  build(ctx: BuildContext): DocSpec;
  /** Name of the downloaded file, without ".pdf". */
  fileName(ctx: BuildContext): string;
}

export type { Block, DocSpec };
