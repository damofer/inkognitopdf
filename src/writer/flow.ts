// Spec 032: the writer's document as a flat list of blocks for the layout
// (src/writer/layout.ts). Lists become indented paragraphs with their marker,
// each piece of text keeps its style and its position in the document, so the
// editor can show where every page of the PDF starts.
import type { Node } from "prosemirror-model";
import {
  BLOCK_STYLES,
  DEFAULT_SPACING,
  LIST_INDENT,
  LIST_ITEM_AFTER,
  type Align,
  type HeadingLevel,
  type WriterFamily,
} from "./schema";

export interface RunStyle {
  family: WriterFamily;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  /** "#rrggbb". */
  color: string;
  highlight: string | null;
  /** Points. */
  size: number;
}

/** Text with one style. "\n" is a line break. */
export interface Run {
  text: string;
  style: RunStyle;
  /** Document position of the first character. */
  pos: number;
}

export interface TextFlow {
  kind: "text";
  runs: Run[];
  align: Align;
  /** Line spacing: 1, 1.15, 1.5, 2. */
  spacing: number;
  /** Style of the paragraph itself: sets the minimum line height. */
  base: RunStyle;
  before: number;
  after: number;
  /** Left indent in points (lists). */
  indent: number;
  marker: { text: string; style: RunStyle } | null;
  /** Headings stay on the page of the line that follows them. */
  keepWithNext: boolean;
  /** Position of the block: an empty paragraph has no runs. */
  pos: number;
}

export interface ImageFlow {
  kind: "image";
  src: string;
  /** Fraction of the text width. */
  width: number;
  /** Height / width of the image. */
  ratio: number;
  before: number;
  after: number;
  pos: number;
}

export interface RuleFlow {
  kind: "rule";
  before: number;
  after: number;
  pos: number;
}

export interface BreakFlow {
  kind: "pageBreak";
  pos: number;
}

export type FlowBlock = TextFlow | ImageFlow | RuleFlow | BreakFlow;

export const TEXT_COLOR = "#000000";

/** Bullets of each list level, repeating: •, ◦, ▪. */
const BULLETS = ["•", "◦", "▪"];

const alpha = (n: number) => {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26))
    s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
  return s;
};

const roman = (n: number) => {
  const table: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let s = "";
  let k = n;
  for (const [value, digits] of table)
    while (k >= value) {
      s += digits;
      k -= value;
    }
  return s;
};

/** "3.", "c.", "iii." for the n-th item at a nesting level of ordered lists. */
export function orderedMarker(n: number, level: number): string {
  const kind = level % 3;
  return `${kind === 0 ? n : kind === 1 ? alpha(n) : roman(n)}.`;
}

export const bulletMarker = (level: number) => BULLETS[level % BULLETS.length]!;

function baseStyle(node: Node, family: WriterFamily): RunStyle {
  const heading =
    node.type.name === "heading"
      ? BLOCK_STYLES[node.attrs.level as HeadingLevel]
      : BLOCK_STYLES.paragraph;
  return {
    family,
    bold: heading.bold,
    italic: false,
    underline: false,
    strike: false,
    color: TEXT_COLOR,
    highlight: null,
    size: heading.size,
  };
}

function runsOf(block: Node, pos: number, base: RunStyle): Run[] {
  const runs: Run[] = [];
  block.forEach((child, offset) => {
    // Content starts one position after the opening of the block.
    const at = pos + 1 + offset;
    if (child.type.name === "hard_break") {
      runs.push({ text: "\n", style: base, pos: at });
      return;
    }
    if (!child.isText || !child.text) return;
    const style = { ...base };
    for (const mark of child.marks) {
      switch (mark.type.name) {
        case "strong":
          style.bold = true;
          break;
        case "em":
          style.italic = true;
          break;
        case "underline":
          style.underline = true;
          break;
        case "strike":
          style.strike = true;
          break;
        // i18n-ignore: mark name
        case "color":
          style.color = mark.attrs.color as string;
          break;
        case "highlight":
          style.highlight = mark.attrs.color as string;
          break;
        case "font":
          style.family = mark.attrs.family as WriterFamily;
          break;
        case "size":
          style.size = mark.attrs.size as number;
          break;
      }
    }
    runs.push({ text: child.text, style, pos: at });
  });
  return runs;
}

/** The blocks of a writer document, in reading order. */
export function flowOf(doc: Node, family: WriterFamily): FlowBlock[] {
  const blocks: FlowBlock[] = [];

  const textBlock = (
    node: Node,
    pos: number,
    indent: number,
    marker: string | null,
    inList: boolean,
  ) => {
    const base = baseStyle(node, family);
    const heading = node.type.name === "heading";
    const style = heading
      ? BLOCK_STYLES[node.attrs.level as HeadingLevel]
      : BLOCK_STYLES.paragraph;
    const runs = runsOf(node, pos, base);
    // The marker takes the look of the item's first letter, as in Word.
    const first = runs[0]?.style ?? base;
    blocks.push({
      kind: "text",
      runs,
      align: (node.attrs.align as Align | undefined) ?? "left",
      spacing: (node.attrs.spacing as number | undefined) ?? DEFAULT_SPACING,
      base,
      before: style.before,
      after: inList ? LIST_ITEM_AFTER : style.after,
      indent,
      marker: marker
        ? {
            text: marker,
            style: {
              ...first,
              family: "Arimo",
              underline: false,
              strike: false,
              highlight: null,
            },
          }
        : null,
      keepWithNext: heading,
      pos,
    });
  };

  const list = (node: Node, pos: number, level: number) => {
    const ordered = node.type.name === "ordered_list";
    const start = ordered ? (node.attrs.order as number) : 1;
    node.forEach((item, itemOffset, index) => {
      const itemPos = pos + 1 + itemOffset;
      const marker = ordered
        ? orderedMarker(start + index, level)
        : bulletMarker(level);
      item.forEach((child, childOffset, childIndex) => {
        const childPos = itemPos + 1 + childOffset;
        if (child.type.name === "paragraph")
          textBlock(
            child,
            childPos,
            (level + 1) * LIST_INDENT,
            childIndex === 0 ? marker : null,
            true,
          );
        else list(child, childPos, level + 1);
      });
    });
  };

  doc.forEach((node, offset) => {
    const pos = offset;
    switch (node.type.name) {
      case "paragraph":
      case "heading":
        textBlock(node, pos, 0, null, false);
        break;
      case "bullet_list":
      case "ordered_list":
        list(node, pos, 0);
        break;
      case "image":
        blocks.push({
          kind: "image",
          src: node.attrs.src as string,
          width: node.attrs.width as number,
          ratio:
            (node.attrs.naturalHeight as number) /
            Math.max(1, node.attrs.naturalWidth as number),
          before: 0,
          after: 6,
          pos,
        });
        break;
      case "horizontal_rule":
        blocks.push({ kind: "rule", before: 6, after: 6, pos });
        break;
      case "page_break":
        blocks.push({ kind: "pageBreak", pos });
        break;
    }
  });
  // Empty paragraphs at the very end never make a page of their own.
  while (blocks.length > 1) {
    const last = blocks[blocks.length - 1]!;
    if (last.kind !== "text" || last.runs.length > 0 || last.marker) break;
    blocks.pop();
  }
  return blocks;
}

/** The first heading, or else the first line of text: the PDF's title. */
export function titleOf(doc: Node): string {
  let heading = "";
  let line = "";
  doc.descendants((node) => {
    if (heading) return false;
    if (!node.isTextblock) return true;
    const text = node.textContent.trim();
    if (node.type.name === "heading" && text) heading = text;
    else if (!line && text) line = text;
    return false;
  });
  return (heading || line).slice(0, 120);
}
