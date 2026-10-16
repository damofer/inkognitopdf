/**
 * Text matching of secure redaction (spec 012): a word without regard to case
 * or accents, or a regular expression. Shared by the search that marks areas
 * and by the search for the same data elsewhere in the file (CA13).
 */

export class BadPatternError extends Error {}

const MAX_MATCHES = 2000;

/** Lower case without accents, keeping one character per character. */
export const fold = (s: string) =>
  [...s]
    .map((c) => {
      const f = c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      if (f.length === c.length) return f;
      const lower = c.toLowerCase();
      return lower.length === c.length ? lower : c;
    })
    .join("");

/** [start, end) ranges of every match of the query in `text`. */
export function findRanges(
  text: string,
  query: string,
  regex: boolean,
): [number, number][] {
  const ranges: [number, number][] = [];
  if (regex) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(query, "giu");
    } catch {
      throw new BadPatternError(query);
    }
    for (const m of text.matchAll(pattern)) {
      if (m[0].length === 0) continue;
      ranges.push([m.index, m.index + m[0].length]);
      if (ranges.length >= MAX_MATCHES) break;
    }
    return ranges;
  }
  const needle = fold(query.trim().replace(/\s+/g, " "));
  if (!needle) return ranges;
  // One character per character: ranges index `text` itself.
  const hay = fold(text.replace(/\s/g, " "));
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    ranges.push([i, i + needle.length]);
    if (ranges.length >= MAX_MATCHES) break;
  }
  return ranges;
}
