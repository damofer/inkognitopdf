// Building blocks shared by the templates (spec 021): common fields, section
// titles, letter parts and signature lines.
import type { Block, TextBlock } from "../layout";
import type { BuildContext, FieldDef, FieldKind, Localized } from "../types";

export const L = (es: string, en: string): Localized => ({ es, en });

export const field = (
  key: string,
  kind: FieldKind,
  es: string,
  en: string,
  hint?: Localized,
): FieldDef => ({ key, kind, label: L(es, en), hint });

export const MUTED = "#5B6470";
export const LINE = "#D0D5DB";

/** A light tint of a color, for backgrounds: `amount` of white mixed in. */
export function tint(hex: string, amount = 0.88): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export const text = (
  value: string,
  options: Omit<TextBlock, "type" | "text"> = {},
): TextBlock => ({ type: "text", text: value, ...options });

/** Title of a section: accent color, capitals, a thin rule under it. */
export function section(
  ctx: BuildContext,
  title: string,
  color?: string,
): Block[] {
  const ink = color ?? ctx.style.accent;
  return [
    text(title.toLocaleUpperCase(ctx.lang), {
      role: "heading",
      variant: "Bold",
      size: 10.5,
      color: ink,
      before: 14,
      after: 3,
      keepWithNext: true,
    }),
    { type: "rule", color: ink, thickness: 0.8, after: 6 },
  ];
}

/** Several non-empty values joined, e.g. "Bogotá · ana@correo.com". */
export const joined = (values: string[], separator = "  ·  ") =>
  values.filter(Boolean).join(separator);

/** A signature line with the name and other lines under it. */
export function signature(
  lines: string[],
  options: { width?: number; before?: number } = {},
): Block {
  const [first = "", ...rest] = lines.filter(Boolean);
  return {
    type: "group",
    before: options.before ?? 48,
    blocks: [
      {
        type: "rule",
        color: "#1F2328",
        thickness: 0.7,
        width: options.width ?? 0.45,
        after: 4,
      },
      text(first, { variant: "Bold" }),
      ...rest.map((line) => text(line, { color: MUTED, size: 9.5 })),
    ],
  };
}

/** Paragraphs of a multiline field, justified-looking with spacing. */
export const paragraphs = (value: string, after = 8): Block[] =>
  value
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => text(p, { after, leading: 1.45 }));

/** Bullet lines: each line of a multiline field becomes "•  line". */
export const bullets = (value: string): Block[] =>
  value
    .split("\n")
    .map((line) => line.replace(/^\s*[-•*]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => ({
      type: "row",
      gap: 4,
      cells: [{ width: 0.03, blocks: [text("•")] }, { blocks: [text(line)] }],
    }));

/** "2019 – 2023", "2021 – Actualidad". */
export const period = (ctx: BuildContext, from: string, to: string) =>
  from || to
    ? joined([from, to || ctx.tx(L("Actualidad", "Present"))], " – ")
    : "";
