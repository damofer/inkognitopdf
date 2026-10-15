// Page ranges for splitting (spec 013). No PDF library here, so the split
// panel can preview its files without loading the engine.
import { t } from "../i18n";

export class OrganizeError extends Error {}

/**
 * Page groups from text such as "1-3, 5, 8-" (1-based, inclusive, an open
 * end runs to the last page). Throws a message for the user when invalid.
 */
export function parseRanges(text: string, count: number): number[][] {
  const groups: number[][] = [];
  for (const raw of text.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d+)?\s*(?:[-–]\s*(\d+)?)?$/.exec(part);
    if (!m || (m[1] === undefined && m[2] === undefined))
      throw new OrganizeError(t("organize.badRange", part));
    const dash = /[-–]/.test(part);
    const from = m[1] !== undefined ? Number(m[1]) : 1;
    const to = m[2] !== undefined ? Number(m[2]) : dash ? count : from;
    if (from < 1 || to > count || from > to)
      throw new OrganizeError(t("organize.outOfRange", part, count));
    groups.push(Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i));
  }
  if (groups.length === 0) throw new OrganizeError(t("organize.noRanges"));
  return groups;
}

/** Groups of `n` pages. */
export function everyN(count: number, n: number): number[][] {
  if (!Number.isInteger(n) || n < 1)
    throw new OrganizeError(t("organize.badEvery"));
  const groups: number[][] = [];
  for (let start = 0; start < count; start += n)
    groups.push(
      Array.from({ length: Math.min(n, count - start) }, (_, i) => start + i),
    );
  return groups;
}

/** "1-3", "5", "2, 4, 7-9": the pages of a group, 1-based, for names. */
export function describeGroup(group: number[]): string {
  const runs: [number, number][] = [];
  for (const i of group) {
    const last = runs[runs.length - 1];
    if (last && i === last[1] + 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs
    .map(([a, b]) => (a === b ? `${a + 1}` : `${a + 1}-${b + 1}`))
    .join(", ");
}
