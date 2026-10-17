// Layout engine for templates (spec 021): blocks of text, rules, rows, boxes,
// images and tables flow down the page and on to the next ones. Pure: it gets
// font metrics from outside and returns drawing operations per page, with the
// origin at the top-left corner and y growing downwards.

export type Role = "heading" | "body";
export type Variant = "Regular" | "Bold" | "Italic" | "BoldItalic";
export type Align = "left" | "center" | "right";

interface Spacing {
  /** Space above, dropped at the top of a page. */
  before?: number;
  /** Space below. */
  after?: number;
}

export interface TextBlock extends Spacing {
  type: "text";
  text: string;
  /** Font size in points (default 10). */
  size?: number;
  role?: Role;
  variant?: Variant;
  color?: string;
  align?: Align;
  /** Line height as a multiple of the size (default 1.35). */
  leading?: number;
  /** Never the last thing on a page: headings stay with what follows. */
  keepWithNext?: boolean;
}

export interface RuleBlock extends Spacing {
  type: "rule";
  color?: string;
  thickness?: number;
  /** Fraction of the available width (default 1). */
  width?: number;
}

export interface SpaceBlock {
  type: "space";
  height: number;
}

export interface Cell {
  /** Fraction of the row's width; cells without one share what is left. */
  width?: number;
  blocks: Block[];
  /** Bottom-aligned cells (signatures, totals). */
  valign?: "top" | "bottom";
}

/** Cells side by side; the row is never split across pages. */
export interface RowBlock extends Spacing {
  type: "row";
  cells: Cell[];
  gap?: number;
}

/** Kept on one page when it fits on one (a job, an item of a list). */
export interface GroupBlock extends Spacing {
  type: "group";
  blocks: Block[];
  keepWithNext?: boolean;
}

/** Blocks on a colored background or inside a frame; never split. */
export interface BoxBlock extends Spacing {
  type: "box";
  blocks: Block[];
  fill?: string;
  stroke?: string;
  padding?: number;
}

export interface ImageBlock extends Spacing {
  type: "image";
  /** Key of the image in the document's images (e.g. "photo"). */
  image: string;
  width: number;
  height: number;
  align?: Align;
  /** Frame color. */
  frame?: string;
}

export interface Column {
  /** Fraction of the table's width. */
  width: number;
  align?: Align;
}

/** Rows of text; the header repeats on every page the table spans. */
export interface TableBlock extends Spacing {
  type: "table";
  columns: Column[];
  header: string[];
  rows: string[][];
  size?: number;
  headerFill?: string;
  headerColor?: string;
  lineColor?: string;
  /** Background of every other row. */
  stripe?: string;
}

export type Block =
  | TextBlock
  | RuleBlock
  | SpaceBlock
  | RowBlock
  | GroupBlock
  | BoxBlock
  | ImageBlock
  | TableBlock;

export interface Sidebar {
  /** Width in points, from the left edge of the page. */
  width: number;
  fill: string;
  blocks: Block[];
}

export interface DocSpec {
  title: string;
  blocks: Block[];
  sidebar?: Sidebar;
  /** Page margin in points (default 54, ¾ inch). */
  margin?: number;
}

export type Op =
  | {
      kind: "text";
      x: number;
      /** Baseline. */
      y: number;
      text: string;
      size: number;
      role: Role;
      variant: Variant;
      color: string;
    }
  | {
      kind: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
      fill?: string;
      stroke?: string;
    }
  | {
      kind: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      width: number;
    }
  | {
      kind: "image";
      image: string;
      x: number;
      y: number;
      w: number;
      h: number;
    };

export interface Metrics {
  /** Width in points of a text at a size. */
  width(text: string, role: Role, variant: Variant, size: number): number;
  /** Height above the baseline, as a fraction of the size. */
  ascent(role: Role, variant: Variant): number;
}

export const TEXT_COLOR = "#1F2328";
export const DEFAULT_SIZE = 10;
export const DEFAULT_LEADING = 1.35;
export const DEFAULT_MARGIN = 54;

/** An unbreakable piece of the flow, with the drawing it makes at (x, top). */
interface Item {
  height: number;
  draw(x: number, top: number): Op[];
  /** Vertical space: dropped at the top of a page. */
  space?: boolean;
  keepWithNext?: boolean;
  /** Header to repeat when this table row starts a page. */
  repeat?: Item;
}

const spaceItem = (height: number): Item[] =>
  height > 0 ? [{ height, space: true, draw: () => [] }] : [];

/** Splits a paragraph into lines that fit `width`; long words are cut. */
export function wrap(
  text: string,
  width: number,
  measure: (s: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/ +/).filter((w) => w !== "");
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (let word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // A word wider than the line is cut where it stops fitting.
      while (measure(word) > width && word.length > 1) {
        let cut = word.length - 1;
        while (cut > 1 && measure(word.slice(0, cut)) > width) cut--;
        lines.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      line = word;
    }
    lines.push(line);
  }
  return lines;
}

/** Turns blocks into flow items for a column `width` wide. */
function items(
  blocks: Block[],
  width: number,
  m: Metrics,
  pageHeight: number,
): Item[] {
  return blocks.flatMap((b) => blockItems(b, width, m, pageHeight));
}

const totalHeight = (list: Item[]) => list.reduce((h, i) => h + i.height, 0);

/** Several items drawn as one unbreakable item. */
function merge(list: Item[], keepWithNext = false): Item {
  // Spaces at the edges of a merged block still count inside it.
  return {
    height: totalHeight(list),
    keepWithNext,
    draw: (x, top) => {
      const ops: Op[] = [];
      let y = top;
      for (const item of list) {
        ops.push(...item.draw(x, y));
        y += item.height;
      }
      return ops;
    },
  };
}

function textItems(b: TextBlock, width: number, m: Metrics): Item[] {
  const size = b.size ?? DEFAULT_SIZE;
  const role = b.role ?? "body";
  const variant = b.variant ?? "Regular";
  const color = b.color ?? TEXT_COLOR;
  const lineHeight = size * (b.leading ?? DEFAULT_LEADING);
  const measure = (s: string) => m.width(s, role, variant, size);
  const lines = wrap(b.text, width, measure);
  const baseline = (lineHeight - size) / 2 + size * m.ascent(role, variant);
  const lineItems: Item[] = lines.map((line, i) => ({
    height: lineHeight,
    keepWithNext: b.keepWithNext || (i === 0 && lines.length > 1),
    draw: (x, top) => {
      if (!line) return [];
      const w = measure(line);
      const dx =
        b.align === "right"
          ? width - w
          : b.align === "center"
            ? (width - w) / 2
            : 0;
      return [
        {
          kind: "text",
          x: x + dx,
          y: top + baseline,
          text: line,
          size,
          role,
          variant,
          color,
        },
      ];
    },
  }));
  // A paragraph never leaves a single line alone at the bottom of a page.
  if (lineItems.length === 2) lineItems[0]!.keepWithNext = true;
  if (lineItems.length > 2)
    lineItems[lineItems.length - 2]!.keepWithNext = true;
  return [
    ...spaceItem(b.before ?? 0),
    ...lineItems,
    ...spaceItem(b.after ?? 0),
  ];
}

/** Widths of row cells: given fractions, the rest shared equally. */
function cellWidths(cells: Cell[], width: number, gap: number): number[] {
  const inner = width - gap * (cells.length - 1);
  const fixed = cells.reduce((s, c) => s + (c.width ?? 0), 0);
  const free = cells.filter((c) => c.width === undefined).length;
  const share = free ? Math.max(0, 1 - fixed) / free : 0;
  return cells.map((c) => inner * (c.width ?? share));
}

function rowItem(b: RowBlock, width: number, m: Metrics, ph: number): Item {
  const gap = b.gap ?? 12;
  const widths = cellWidths(b.cells, width, gap);
  const columns = b.cells.map((c, i) => items(c.blocks, widths[i]!, m, ph));
  const heights = columns.map(totalHeight);
  const height = Math.max(0, ...heights);
  return {
    height,
    draw: (x, top) => {
      const ops: Op[] = [];
      let cx = x;
      columns.forEach((column, i) => {
        let y =
          top + (b.cells[i]!.valign === "bottom" ? height - heights[i]! : 0);
        for (const item of column) {
          ops.push(...item.draw(cx, y));
          y += item.height;
        }
        cx += widths[i]! + gap;
      });
      return ops;
    },
  };
}

function boxItem(b: BoxBlock, width: number, m: Metrics, ph: number): Item {
  const pad = b.padding ?? 10;
  const inner = merge(items(b.blocks, width - 2 * pad, m, ph));
  const height = inner.height + 2 * pad;
  return {
    height,
    draw: (x, top) => [
      {
        kind: "rect",
        x,
        y: top,
        w: width,
        h: height,
        fill: b.fill,
        stroke: b.stroke,
      },
      ...inner.draw(x + pad, top + pad),
    ],
  };
}

function tableItems(b: TableBlock, width: number, m: Metrics): Item[] {
  const size = b.size ?? 9.5;
  const pad = 5;
  const widths = b.columns.map((c) => c.width * width);
  const line = b.lineColor ?? "#D0D5DB";

  const rowOf = (cells: string[], header: boolean, index: number): Item => {
    const variant: Variant = header ? "Bold" : "Regular";
    const color = header ? (b.headerColor ?? TEXT_COLOR) : TEXT_COLOR;
    const blocks = cells.map((text, i) =>
      textItems(
        {
          type: "text",
          text,
          size,
          variant,
          color,
          align: b.columns[i]?.align,
        },
        widths[i]! - 2 * pad,
        m,
      ),
    );
    const height = Math.max(...blocks.map(totalHeight)) + 2 * pad;
    const fill = header
      ? b.headerFill
      : b.stripe && index % 2 === 1
        ? b.stripe
        : undefined;
    return {
      height,
      draw: (x, top) => {
        const ops: Op[] = [];
        if (fill)
          ops.push({ kind: "rect", x, y: top, w: width, h: height, fill });
        let cx = x;
        blocks.forEach((cell, i) => {
          let y = top + pad;
          for (const item of cell) {
            ops.push(...item.draw(cx + pad, y));
            y += item.height;
          }
          cx += widths[i]!;
        });
        ops.push({
          kind: "line",
          x1: x,
          y1: top + height,
          x2: x + width,
          y2: top + height,
          color: line,
          width: 0.6,
        });
        return ops;
      },
    };
  };

  const header = rowOf(b.header, true, 0);
  header.keepWithNext = true;
  const rows = b.rows.map((r, i) => ({
    ...rowOf(r, false, i),
    repeat: header,
  }));
  return [
    ...spaceItem(b.before ?? 0),
    header,
    ...rows,
    ...spaceItem(b.after ?? 0),
  ];
}

function blockItems(
  b: Block,
  width: number,
  m: Metrics,
  pageHeight: number,
): Item[] {
  switch (b.type) {
    case "text":
      return textItems(b, width, m);
    case "space":
      return spaceItem(b.height);
    case "rule": {
      const thickness = b.thickness ?? 0.8;
      const w = width * (b.width ?? 1);
      return [
        ...spaceItem(b.before ?? 0),
        {
          height: thickness,
          draw: (x, top) => [
            {
              kind: "line",
              x1: x,
              y1: top + thickness / 2,
              x2: x + w,
              y2: top + thickness / 2,
              color: b.color ?? TEXT_COLOR,
              width: thickness,
            },
          ],
        },
        ...spaceItem(b.after ?? 0),
      ];
    }
    case "row":
      return [
        ...spaceItem(b.before ?? 0),
        rowItem(b, width, m, pageHeight),
        ...spaceItem(b.after ?? 0),
      ];
    case "box":
      return [
        ...spaceItem(b.before ?? 0),
        boxItem(b, width, m, pageHeight),
        ...spaceItem(b.after ?? 0),
      ];
    case "image": {
      const w = Math.min(b.width, width);
      const h = b.height * (w / b.width);
      const dx =
        b.align === "center"
          ? (width - w) / 2
          : b.align === "right"
            ? width - w
            : 0;
      return [
        ...spaceItem(b.before ?? 0),
        {
          height: h,
          draw: (x, top) => [
            { kind: "image", image: b.image, x: x + dx, y: top, w, h },
            ...(b.frame
              ? [
                  {
                    kind: "rect",
                    x: x + dx,
                    y: top,
                    w,
                    h,
                    stroke: b.frame,
                  } as Op,
                ]
              : []),
          ],
        },
        ...spaceItem(b.after ?? 0),
      ];
    }
    case "table":
      return tableItems(b, width, m);
    case "group": {
      const inner = items(b.blocks, width, m, pageHeight);
      // Too tall for any page: it flows like its contents.
      if (totalHeight(inner) > pageHeight) return inner;
      return [
        ...spaceItem(b.before ?? 0),
        merge(inner, b.keepWithNext),
        ...spaceItem(b.after ?? 0),
      ];
    }
  }
}

/** Places items on pages `height` tall; returns each page's (item, top) pairs. */
function paginate(list: Item[], height: number) {
  const pages: { item: Item; top: number }[][] = [[]];
  let y = 0;
  const newPage = () => {
    pages.push([]);
    y = 0;
  };
  for (let i = 0; i < list.length; i++) {
    const item = list[i]!;
    if (item.space && y === 0) continue;
    // What must go together with this item: it and the next ones it keeps.
    let need = item.height;
    for (let j = i; list[j]?.keepWithNext && list[j + 1]; j++) {
      const next = list[j + 1]!;
      need += next.height;
      if (!next.keepWithNext) break;
    }
    if (y > 0 && y + Math.min(need, height) > height) newPage();
    if (item.space && y === 0) continue;
    if (y === 0 && item.repeat && pages.length > 1) {
      pages[pages.length - 1]!.push({ item: item.repeat, top: 0 });
      y = item.repeat.height;
    }
    pages[pages.length - 1]!.push({ item, top: y });
    y += item.height;
  }
  return pages;
}

export interface Laid {
  pages: Op[][];
}

/** Lays out a document on pages of the given size, in points. */
export function layout(
  doc: DocSpec,
  [pageWidth, pageHeight]: readonly [number, number],
  m: Metrics,
): Laid {
  const margin = doc.margin ?? DEFAULT_MARGIN;
  const usable = pageHeight - 2 * margin;
  const side = doc.sidebar;
  const mainX = side ? side.width + margin * 0.75 : margin;
  const mainWidth = pageWidth - mainX - margin;
  const main = paginate(items(doc.blocks, mainWidth, m, usable), usable);
  const sidePad = margin * 0.5;
  const sidePages = side
    ? paginate(items(side.blocks, side.width - 2 * sidePad, m, usable), usable)
    : [];
  const count = Math.max(main.length, sidePages.length);
  const pages: Op[][] = [];
  for (let p = 0; p < count; p++) {
    const ops: Op[] = [];
    if (side) {
      ops.push({
        kind: "rect",
        x: 0,
        y: 0,
        w: side.width,
        h: pageHeight,
        fill: side.fill,
      });
      for (const { item, top } of sidePages[p] ?? [])
        ops.push(...item.draw(sidePad, margin + top));
    }
    for (const { item, top } of main[p] ?? [])
      ops.push(...item.draw(mainX, margin + top));
    pages.push(ops);
  }
  return { pages };
}
