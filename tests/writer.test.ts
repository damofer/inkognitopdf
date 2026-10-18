// Spec 032: writing documents from scratch. The document model, its layout on
// pages and the PDF with real text.
import { readFile } from "node:fs/promises";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import type { Node } from "prosemirror-model";
import { describe, expect, test } from "vitest";
import {
  flowOf,
  orderedMarker,
  titleOf,
  type RunStyle,
} from "../src/writer/flow";
import {
  breakLines,
  layoutWriter,
  LINE_FACTOR,
  type FaceOf,
  type WriterOp,
} from "../src/writer/layout";
import { renderWriter } from "../src/writer/render";
import {
  familyFromCss,
  hexFromCss,
  schema,
  sizeFromCss,
} from "../src/writer/schema";
import { bundledFontPath, pageText, qpdfCheck, qpdfPath } from "./helpers";

const loadFont = async (family: string, variant: string) =>
  new Uint8Array(await readFile(bundledFontPath(family, variant)));

/** Every character 0.5 em wide; ascent 0.8, descent 0.2. */
const fake: FaceOf = () => ({
  width: (text) => text.length * 0.5,
  ascent: 0.8,
  descent: 0.2,
});

const { nodes: n, marks: m } = schema;
const p = (...content: (Node | string)[]) =>
  n.paragraph!.create(
    null,
    content
      .filter((c) => c !== "")
      .map((c) => (typeof c === "string" ? schema.text(c) : c)),
  );
const doc = (...blocks: Node[]) => n.doc!.create(null, blocks);
const texts = (ops: WriterOp[]) =>
  ops.flatMap((o) => (o.kind === "text" ? [o.text] : []));

const style: RunStyle = {
  family: "Arimo",
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: "#000000",
  highlight: null,
  size: 10,
};

describe("lines (spec 032)", () => {
  test("words wrap at spaces; spaces at the end of a line do not count", () => {
    const lines = breakLines(
      [{ text: "uno dos tres cuatro", style, pos: 1 }],
      // "uno dos" is 7 characters: 35 points at size 10.
      35,
      fake,
    );
    expect(lines.map((l) => l.pieces.map((p) => p.text).join(""))).toEqual([
      "uno dos ",
      "tres ",
      "cuatro",
    ]);
    expect(lines[0]!.width).toBe(35);
    // Each line knows where it starts in the document.
    expect(lines.map((l) => l.pieces[0]!.pos)).toEqual([1, 9, 14]);
  });

  test("a word in several styles stays together; hyphens allow a break", () => {
    const bold = { ...style, bold: true };
    const lines = breakLines(
      [
        { text: "aa pa", style, pos: 1 },
        { text: "la", style: bold, pos: 6 },
        { text: "bra auto-escuela", style, pos: 8 },
      ],
      40,
      fake,
    );
    expect(lines.map((l) => l.pieces.map((p) => p.text).join(""))).toEqual([
      "aa ",
      "palabra ",
      "auto-",
      "escuela",
    ]);
  });

  test("line breaks and long words", () => {
    const lines = breakLines(
      [
        { text: "a", style, pos: 1 },
        { text: "\n", style, pos: 2 },
        { text: "abcdefghij", style, pos: 3 },
      ],
      20,
      fake,
    );
    expect(lines.map((l) => l.pieces.map((p) => p.text).join(""))).toEqual([
      "a",
      "abcd",
      "efgh",
      "ij",
    ]);
    expect(lines.map((l) => l.last)).toEqual([true, false, false, true]);
    expect(lines.map((l) => l.pieces[0]!.pos)).toEqual([1, 3, 7, 11]);
  });
});

describe("blocks (spec 032)", () => {
  test("lists become indented paragraphs with their markers", () => {
    const item = (text: string, ...more: Node[]) =>
      n.list_item!.create(null, [p(text), ...more]);
    const content = doc(
      n.heading!.create({ level: 1 }, schema.text("Acta")),
      n.ordered_list!.create(null, [
        item("uno", n.bullet_list!.create(null, [item("sub")])),
        item("dos"),
      ]),
    );
    const blocks = flowOf(content, "Tinos");
    const text = blocks.filter((b) => b.kind === "text");
    expect(text.map((b) => b.marker?.text ?? null)).toEqual([
      null,
      "1.",
      "◦",
      "2.",
    ]);
    expect(text.map((b) => b.indent)).toEqual([0, 24, 48, 24]);
    expect(text[0]!.base).toMatchObject({ size: 20, bold: true });
    expect(text[1]!.base.family).toBe("Tinos");
    // Positions point at the text in the document.
    for (const b of text)
      expect(content.textBetween(b.runs[0]!.pos, b.runs[0]!.pos + 1)).toBe(
        b.runs[0]!.text[0],
      );
    expect(orderedMarker(28, 1)).toBe("ab.");
    expect(orderedMarker(4, 2)).toBe("iv.");
  });

  test("marks become run styles", () => {
    const content = doc(
      p(
        "a ",
        schema.text("b", [
          m.strong!.create(),
          m.highlight!.create({ color: "#ffff00" }),
          m.size!.create({ size: 14 }),
          m.font!.create({ family: "Carlito" }),
        ]),
      ),
    );
    const [block] = flowOf(content, "Arimo");
    expect(block!.kind === "text" && block!.runs[1]!.style).toMatchObject({
      bold: true,
      highlight: "#ffff00",
      size: 14,
      family: "Carlito",
    });
  });

  test("the title is the first heading, else the first line", () => {
    expect(
      titleOf(doc(p(""), p("Hola"), n.heading!.create(null, schema.text("T")))),
    ).toBe("T");
    expect(titleOf(doc(p(""), p("Hola"), p("x")))).toBe("Hola");
  });

  test("pasted CSS values", () => {
    expect(familyFromCss('"Calibri", sans-serif')).toBe("Carlito");
    expect(familyFromCss("Comic Sans MS")).toBeNull();
    expect(sizeFromCss("16px")).toBe(12);
    expect(sizeFromCss("11pt")).toBe(11);
    expect(hexFromCss("rgb(255, 0, 0)")).toBe("#ff0000");
    expect(hexFromCss("rgba(0, 0, 0, 0)")).toBeNull();
    expect(hexFromCss("#abc")).toBe("#aabbcc");
  });
});

describe("pages (spec 032)", () => {
  const setup = { width: 300, height: 300, margin: 50 };

  test("text flows on to new pages and each page knows where it starts", () => {
    const content = doc(
      ...Array.from({ length: 30 }, (_, i) => p(`línea ${i}`)),
    );
    const laid = layoutWriter(flowOf(content, "Arimo"), setup, fake);
    // 11 pt × 1.15 × 1.15 per line, 6 pt after each paragraph.
    const line = 11 * 1.15 * LINE_FACTOR;
    const perPage = Math.floor((200 + 6) / (line + 6));
    expect(laid.pages.length).toBe(Math.ceil(30 / perPage));
    expect(texts(laid.pages[0]!)).toHaveLength(perPage);
    // The second page starts at the text of its first line.
    const first = texts(laid.pages[1]!)[0]!;
    expect(
      content.textBetween(laid.starts[0]!, laid.starts[0]! + first.length),
    ).toBe(first);
  });

  test("page breaks, headings kept with the next line", () => {
    const content = doc(
      p("a"),
      n.page_break!.create(),
      p("b"),
      ...Array.from({ length: 7 }, () => p("relleno")),
      n.heading!.create({ level: 1 }, schema.text("TITULO")),
      p("cuerpo"),
    );
    const laid = layoutWriter(flowOf(content, "Arimo"), setup, fake);
    expect(texts(laid.pages[0]!)).toEqual(["a"]);
    expect(texts(laid.pages[1]![0] ? laid.pages[1]! : [])[0]).toBe("b");
    const last = texts(laid.pages[laid.pages.length - 1]!);
    expect(last).toEqual(["TITULO", "cuerpo"]);
  });

  test("alignment and justified lines", () => {
    const words = "uno dos tres cuatro cinco seis siete ocho";
    const at = (align: string) => {
      const content = doc(n.paragraph!.create({ align }, schema.text(words)));
      return layoutWriter(flowOf(content, "Arimo"), setup, fake).pages[0]!;
    };
    const right = at("right").filter((o) => o.kind === "text");
    // Right aligned: every line ends at the right margin.
    for (const op of right)
      expect(op.x + op.text.trimEnd().length * 5.5).toBeCloseTo(250, 5);
    const justified = at("justify").filter((o) => o.kind === "text");
    // Justified: words of full lines are drawn one by one up to the margin.
    const firstLine = justified.filter((o) => o.y === justified[0]!.y);
    const end = firstLine[firstLine.length - 1]!;
    expect(end.x + end.text.length * 5.5).toBeCloseTo(250, 5);
  });

  test("highlight, underline and images", () => {
    const content = doc(
      p(
        schema.text("hola", [
          m.highlight!.create({ color: "#ffff00" }),
          m.underline!.create(),
        ]),
      ),
      n.image!.create({
        src: "data:image/png;base64,",
        width: 0.5,
        naturalWidth: 200,
        naturalHeight: 100,
      }),
    );
    const ops = layoutWriter(flowOf(content, "Arimo"), setup, fake).pages[0]!;
    expect(ops.find((o) => o.kind === "rect")).toMatchObject({
      fill: "#ffff00",
      w: 22,
    });
    expect(ops.some((o) => o.kind === "line")).toBe(true);
    expect(ops.find((o) => o.kind === "image")).toMatchObject({
      x: 100,
      w: 100,
      h: 50,
    });
  });
});

describe("PDF (spec 032, RF-032-11)", () => {
  test("real, selectable text in the bundled fonts", async () => {
    const content = doc(
      n.heading!.create({ level: 1 }, schema.text("Acta de reunión")),
      p(
        "Asistieron ",
        schema.text("todos", [m.strong!.create()]),
        " los socios.",
      ),
      n.bullet_list!.create(null, [
        n.list_item!.create(null, [p("Presupuesto aprobado")]),
      ]),
      ...Array.from({ length: 60 }, (_, i) => p(`Párrafo número ${i + 1}.`)),
    );
    const { bytes, pages, title } = await renderWriter(
      content,
      { paper: "a4", family: "Arimo" },
      loadFont,
    );
    expect(title).toBe("Acta de reunión");
    expect(pages).toBe(2);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getTitle()).toBe("Acta de reunión");
    expect(pdf.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 });
    const first = await pageText(bytes, 1);
    expect(first).toContain("Acta de reunión");
    expect(first).toContain("Asistieron todos los socios.");
    expect(first).toContain("Presupuesto aprobado");
    expect(await pageText(bytes, 2)).toContain("Párrafo número 60.");
    const fonts = pdf
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of("Font"), PDFDict)
      .values()
      .map((ref) =>
        pdf.context.lookup(ref, PDFDict).get(PDFName.of("BaseFont")),
      )
      .map(String);
    expect(fonts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Arimo-Bold"),
        expect.stringContaining("Arimo-Regular"),
      ]),
    );
    if (qpdfPath) expect(await qpdfCheck(bytes)).toBe("");
  });
});

test("empty paragraphs at the end make no page of their own", () => {
  const content = doc(p("a"), n.page_break!.create(), p(""), p(""));
  const setup = { width: 300, height: 300, margin: 50 };
  // The page break still starts a page: the empty paragraph after it is kept.
  expect(
    layoutWriter(flowOf(content, "Arimo"), setup, fake).pages,
  ).toHaveLength(2);
  expect(flowOf(doc(p("a"), p(""), p("")), "Arimo")).toHaveLength(1);
});
