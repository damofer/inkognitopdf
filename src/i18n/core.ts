// Interface language (spec 006): Spanish and English, chosen from the browser
// on first load and remembered once the user picks one. Messages live in
// es/*.ts (the reference) and en/*.ts, which must have the same keys and
// argument lists; the compiler checks both. This module has no React, so
// the landing page can use it too; index.ts adds the React hooks.
import { es, type Messages } from "./es";
import { en } from "./en";

export type Lang = "es" | "en";
export const LANGS: readonly Lang[] = ["es", "en"];

export type MessageKey = keyof Messages;
type MessageArgs<K extends MessageKey> = Messages[K] extends (
  ...args: infer A
) => string
  ? A
  : [];

const dictionaries: Record<Lang, Messages> = { es, en };
const STORAGE_KEY = "inkognitopdf.lang";

function stored(): Lang | null {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return value === "es" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

/** The first Spanish or English entry of the browser's languages; else English. */
export function detectLang(
  languages: readonly string[] = globalThis.navigator?.languages ?? [],
): Lang {
  for (const tag of languages) {
    const primary = tag.toLowerCase().split("-")[0];
    if (primary === "es" || primary === "en") return primary;
  }
  return "en";
}

let current: Lang = stored() ?? detectLang();
const listeners = new Set<() => void>();

function applyToDocument() {
  if (typeof document !== "undefined") document.documentElement.lang = current;
}
applyToDocument();

export const getLang = (): Lang => current;

/** BCP 47 locale for dates and numbers in the current language. */
export const locale = (): string => (current === "es" ? "es-ES" : "en-US");

/** Changes the language; `remember` keeps it for the next visits. */
export function setLang(lang: Lang, remember = true) {
  if (remember)
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, lang);
    } catch {
      // Private mode or storage disabled: the choice lasts this visit.
    }
  if (lang === current) return;
  current = lang;
  applyToDocument();
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The message `key` in the current language. */
export function t<K extends MessageKey>(key: K, ...args: MessageArgs<K>) {
  const message = dictionaries[current][key] as
    string | ((...a: unknown[]) => string);
  return typeof message === "function" ? message(...args) : message;
}

/** The message `key` in a given language (e.g. for tests). */
export function tIn<K extends MessageKey>(
  lang: Lang,
  key: K,
  ...args: MessageArgs<K>
) {
  const message = dictionaries[lang][key] as
    string | ((...a: unknown[]) => string);
  return typeof message === "function" ? message(...args) : message;
}
