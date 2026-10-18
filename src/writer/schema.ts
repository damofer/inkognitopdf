// Spec 032: the document model of the writer, a ProseMirror schema. Blocks are
// paragraphs, headings, lists, images, rules and page breaks; text carries
// marks for bold, italic, underline, strike, color, highlight, font and size.
// The same schema reads pasted HTML (Word, Google Docs, web pages).
import { Schema, type MarkSpec, type NodeSpec } from "prosemirror-model";

export type Align = "left" | "center" | "right" | "justify";
export const ALIGNS: Align[] = ["left", "center", "right", "justify"];

/** Font families the writer offers: the app's bundled open fonts. */
export type WriterFamily =
  "Arimo" | "Tinos" | "Carlito" | "Caladea" | "Cousine";
export const WRITER_FAMILIES: WriterFamily[] = [
  "Arimo",
  "Tinos",
  "Carlito",
  "Caladea",
  "Cousine",
];
export const DEFAULT_FAMILY: WriterFamily = "Arimo";

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48];
export const BODY_SIZE = 11;
/** Line spacing choices, as Word and Google Docs name them. */
export const SPACINGS = [1, 1.15, 1.5, 2];
export const DEFAULT_SPACING = 1.15;

/** Size and spacing of each paragraph style, in points. */
export const BLOCK_STYLES = {
  paragraph: { size: BODY_SIZE, bold: false, before: 0, after: 6 },
  1: { size: 20, bold: true, before: 16, after: 6 },
  2: { size: 16, bold: true, before: 14, after: 4 },
  3: { size: 13, bold: true, before: 12, after: 4 },
} as const;
export type HeadingLevel = 1 | 2 | 3;
/** Space after a paragraph inside a list item. */
export const LIST_ITEM_AFTER = 3;
/** Indent of each list level. */
export const LIST_INDENT = 24;

const FAMILY_ALIASES: [RegExp, WriterFamily][] = [
  [/arimo|arial|helvetica|liberation sans|sans-serif|roboto|inter/i, "Arimo"],
  [/tinos|times|liberation serif|georgia|serif/i, "Tinos"],
  [/carlito|calibri/i, "Carlito"],
  [/caladea|cambria/i, "Caladea"],
  [/cousine|courier|monospace|consolas|liberation mono/i, "Cousine"],
];

/** Our family for a CSS font-family list (pasted text), or null. */
export function familyFromCss(value: string): WriterFamily | null {
  // The first family that has an equivalent wins: "Calibri, sans-serif".
  for (const name of value.split(",")) {
    for (const [pattern, family] of FAMILY_ALIASES)
      if (pattern.test(name)) return family;
  }
  return null;
}

/** Points for a CSS font size ("12pt", "16px"), or null. */
export function sizeFromCss(value: string): number | null {
  const match = /^([\d.]+)(pt|px)$/.exec(value.trim());
  if (!match) return null;
  const n = parseFloat(match[1]!) * (match[2] === "px" ? 0.75 : 1);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(96, Math.max(6, Math.round(n * 2) / 2));
}

/** "#rrggbb" for a CSS color, or null for transparent and unknown values. */
export function hexFromCss(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v))
    return `#${[...v.slice(1)].map((c) => c + c).join("")}`;
  const rgb =
    /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(
      v,
    );
  if (!rgb) return null;
  if (rgb[4] !== undefined && parseFloat(rgb[4]) === 0) return null;
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((c) => Math.min(255, Number(c)).toString(16).padStart(2, "0"))
    .join("")}`;
}

const alignOf = (dom: HTMLElement): Align => {
  const value = dom.style.textAlign || dom.getAttribute("align") || "";
  return (ALIGNS as string[]).includes(value) ? (value as Align) : "left";
};

const spacingOf = (dom: HTMLElement): number => {
  const raw = Number(dom.getAttribute("data-spacing"));
  return SPACINGS.includes(raw) ? raw : DEFAULT_SPACING;
};

const blockAttrs = {
  align: { default: "left" },
  spacing: { default: DEFAULT_SPACING },
};

const blockStyle = (align: string) =>
  align === "left" ? undefined : `text-align: ${align}`;

const nodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },
  paragraph: {
    content: "inline*",
    group: "block",
    attrs: blockAttrs,
    parseDOM: [
      {
        tag: "p",
        getAttrs: (dom) => ({
          align: alignOf(dom),
          spacing: spacingOf(dom),
        }),
      },
    ],
    toDOM: (node) => [
      "p",
      {
        style: blockStyle(node.attrs.align as string),
        "data-spacing": String(node.attrs.spacing),
      },
      0,
    ],
  },
  heading: {
    content: "inline*",
    group: "block",
    defining: true,
    attrs: { ...blockAttrs, level: { default: 1 } },
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      getAttrs: (dom: HTMLElement) => ({
        level: Math.min(level, 3),
        align: alignOf(dom),
        spacing: spacingOf(dom),
      }),
    })),
    toDOM: (node) => [
      `h${node.attrs.level as number}`,
      {
        style: blockStyle(node.attrs.align as string),
        "data-spacing": String(node.attrs.spacing),
      },
      0,
    ],
  },
  bullet_list: {
    content: "list_item+",
    group: "block",
    parseDOM: [{ tag: "ul" }],
    toDOM: () => ["ul", 0],
  },
  ordered_list: {
    content: "list_item+",
    group: "block",
    attrs: { order: { default: 1 } },
    parseDOM: [
      {
        tag: "ol",
        getAttrs: (dom) => ({
          order: dom.hasAttribute("start")
            ? Number(dom.getAttribute("start")) || 1
            : 1,
        }),
      },
    ],
    toDOM: (node) =>
      node.attrs.order === 1
        ? ["ol", 0]
        : ["ol", { start: node.attrs.order as number }, 0],
  },
  list_item: {
    content: "paragraph (paragraph | bullet_list | ordered_list)*",
    defining: true,
    parseDOM: [{ tag: "li" }],
    toDOM: () => ["li", 0],
  },
  image: {
    group: "block",
    atom: true,
    draggable: true,
    attrs: {
      src: {},
      /** Fraction of the text width. */
      width: { default: 1 },
      /** Pixels of the image, for its proportions. */
      naturalWidth: { default: 1 },
      naturalHeight: { default: 1 },
    },
    parseDOM: [
      {
        tag: "figure.writer-image",
        getAttrs: (dom) => {
          const img = dom.querySelector("img");
          if (!img?.getAttribute("src")?.startsWith("data:image/"))
            return false;
          return {
            src: img.getAttribute("src"),
            width: Number(dom.getAttribute("data-width")) || 1,
            naturalWidth: Number(img.getAttribute("width")) || 1,
            naturalHeight: Number(img.getAttribute("height")) || 1,
          };
        },
      },
    ],
    toDOM: (node) => [
      "figure",
      {
        class: "writer-image",
        "data-width": String(node.attrs.width),
        style: `width: ${(node.attrs.width as number) * 100}%`,
      },
      [
        "img",
        {
          src: node.attrs.src as string,
          width: String(node.attrs.naturalWidth),
          height: String(node.attrs.naturalHeight),
          alt: "",
        },
      ],
    ],
  },
  horizontal_rule: {
    group: "block",
    parseDOM: [{ tag: "hr" }],
    toDOM: () => ["hr"],
  },
  page_break: {
    group: "block",
    atom: true,
    selectable: true,
    parseDOM: [{ tag: "div.writer-page-break" }],
    toDOM: () => [
      "div",
      { class: "writer-page-break", contenteditable: "false" },
      ["span"],
    ],
  },
  text: { group: "inline" },
  hard_break: {
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM: () => ["br"],
  },
};

const marks: Record<string, MarkSpec> = {
  strong: {
    parseDOM: [
      { tag: "strong" },
      // Google Docs wraps pasted text in <b style="font-weight:normal">.
      {
        tag: "b",
        getAttrs: (dom) => dom.style.fontWeight !== "normal" && null,
      },
      {
        style: "font-weight",
        getAttrs: (value) => /^(bold(er)?|[6-9]\d\d)$/.test(value) && null,
      },
    ],
    toDOM: () => ["strong", 0],
  },
  em: {
    parseDOM: [{ tag: "i" }, { tag: "em" }, { style: "font-style=italic" }],
    toDOM: () => ["em", 0],
  },
  underline: {
    parseDOM: [
      { tag: "u" },
      {
        style: "text-decoration",
        getAttrs: (value) => value.includes("underline") && null,
      },
      {
        style: "text-decoration-line",
        getAttrs: (value) => value.includes("underline") && null,
      },
    ],
    toDOM: () => ["u", 0],
  },
  strike: {
    parseDOM: [
      { tag: "s" },
      { tag: "del" },
      { tag: "strike" },
      {
        style: "text-decoration",
        getAttrs: (value) => value.includes("line-through") && null,
      },
      {
        style: "text-decoration-line",
        getAttrs: (value) => value.includes("line-through") && null,
      },
    ],
    toDOM: () => ["s", 0],
  },
  color: {
    attrs: { color: {} },
    parseDOM: [
      {
        // i18n-ignore: CSS property
        style: "color",
        getAttrs: (value) => {
          const color = hexFromCss(value);
          return color && color !== "#000000" ? { color } : false;
        },
      },
    ],
    toDOM: (mark) => [
      "span",
      // i18n-ignore: CSS
      { style: `color: ${mark.attrs.color as string}` },
      0,
    ],
  },
  highlight: {
    attrs: { color: {} },
    parseDOM: [
      { tag: "mark", getAttrs: () => ({ color: "#fff176" }) },
      {
        // i18n-ignore: CSS property
        style: "background-color",
        getAttrs: (value) => {
          const color = hexFromCss(value);
          return color && color !== "#ffffff" ? { color } : false;
        },
      },
    ],
    toDOM: (mark) => [
      "span",
      {
        class: "writer-highlight",
        // i18n-ignore: CSS
        style: `background-color: ${mark.attrs.color as string}`,
      },
      0,
    ],
  },
  font: {
    attrs: { family: {} },
    parseDOM: [
      {
        style: "font-family",
        getAttrs: (value) => {
          const family = familyFromCss(value);
          return family ? { family } : false;
        },
      },
    ],
    toDOM: (mark) => [
      "span",
      { style: `font-family: ${mark.attrs.family as string}` },
      0,
    ],
  },
  size: {
    attrs: { size: {} },
    parseDOM: [
      {
        style: "font-size",
        getAttrs: (value) => {
          const size = sizeFromCss(value);
          return size ? { size } : false;
        },
      },
    ],
    toDOM: (mark) => [
      "span",
      {
        class: "writer-size",
        style: `--size: ${mark.attrs.size as number}`,
      },
      0,
    ],
  },
};

export const schema = new Schema({ nodes, marks });
