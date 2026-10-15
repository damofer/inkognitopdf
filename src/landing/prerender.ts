// Writes the texts of the landing page into its HTML (spec 008). Elements
// carry data-i18n="key" (their text) or data-i18n-attr="attr:key;attr:key"
// (attributes). The build fills them in English, so the page reads without
// JavaScript and search engines see it; main.ts switches them at run time.
export type Lookup = (key: string) => string;

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Pairs [attribute, key] of a data-i18n-attr value. */
export const attrPairs = (spec: string): [string, string][] =>
  spec
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf(":");
      return [part.slice(0, at), part.slice(at + 1)];
    });

export function prerender(html: string, lookup: Lookup): string {
  return html
    .replace(
      /(<([a-z][a-z0-9]*)\b[^>]*?\sdata-i18n="([^"]+)"[^>]*>)\s*(<\/\2>)/g,
      (_m, open: string, _tag: string, key: string, close: string) =>
        open + escapeHtml(lookup(key)) + close,
    )
    .replace(/\sdata-i18n-attr="([^"]+)"/g, (match, spec: string) => {
      const attrs = attrPairs(spec)
        .map(([attr, key]) => ` ${attr}="${escapeHtml(lookup(key))}"`)
        .join("");
      return match + attrs;
    });
}
