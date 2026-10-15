// Spec 001, CA3 (regression): a "label ........ value" row as web-to-PDF
// producers write it. A gray dot leader is drawn across the whole row, one
// dot per operator; the value and the label are drawn over it, each on a
// white box that hides the dots under it. Clicking the label used to open the
// dot leader (it comes first in the content) and editing it removed the label
// and the value too, all but the value's last glyph.
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import {
  boxAt,
  textBoxes,
  textEditFor,
  type TextBox,
} from "../src/editor/textBoxes";
import { applyEdits } from "../src/engine/applyEdits";
import { SubstituteFont } from "../src/engine/substituteFont";
import { pageTextShows } from "../src/engine/textEdit";
import { applyOperation } from "../src/model/operations";
import {
  bundledFontPath,
  openPdf,
  qpdfCheck,
  qpdfPath,
  stateFor,
  testDeps,
} from "./helpers";
import { inkShare, renderPage } from "./renderHelpers";

const HEIGHT = 841.89;
const SIZE = 8.25;
const BASELINE = 556.9;
const LABEL = "ID de cuenta de pagos";
const VALUE = "8580-5705-1376-2930";
const DOTS = 62;
const VALUE_X = 158.3;

async function buildRow(): Promise<Uint8Array> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([595.28, HEIGHT]);
  const font = new SubstituteFont(
    doc,
    "Arimo",
    "Regular",
    await readFile(bundledFontPath("Arimo", "Regular")),
  );
  const hex = (text: string) => font.encode(text).toString();
  page.node.set(
    PDFName.of("Resources"),
    doc.context.obj({ Font: { F1: font.ref } }),
  );
  const width = (text: string) => font.widthOf(text) * SIZE;
  const dots = Array.from(
    { length: DOTS },
    (_, i) =>
      `BT /F1 ${SIZE} Tf 1 0 0 1 ${(48 + i * 3.05).toFixed(2)} ${BASELINE} Tm ${hex(".")} Tj ET`,
  );
  const whiteBox = (x: number, text: string) =>
    `1 g ${x} ${BASELINE - 3} ${width(text).toFixed(2)} 12 re f`;
  const content = [
    "0.5 g",
    ...dots,
    whiteBox(VALUE_X, VALUE),
    `0 g BT /F1 ${SIZE} Tf 1 0 0 1 ${VALUE_X} ${BASELINE} Tm ${hex(VALUE)} Tj ET`,
    whiteBox(48, LABEL),
    `0 g BT /F1 ${SIZE} Tf 1 0 0 1 48 ${BASELINE} Tm ${hex(LABEL)} Tj ET`,
  ].join("\n");
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(doc.context.flateStream(content)),
  );
  font.embed(doc);
  return doc.save({ useObjectStreams: false });
}

let original: Uint8Array;
let boxes: TextBox[];

beforeAll(async () => {
  original = await buildRow();
  const doc = await openPdf(original);
  boxes = textBoxes(await (await doc.getPage(1)).getTextContent());
  await doc.loadingTask.destroy();
});

const clickAt = (x: number) => ({ x, y: BASELINE + SIZE * 0.3 });

async function edit(box: TextBox, text: string) {
  const state = applyOperation(await stateFor(original), {
    kind: "addItem",
    item: textEditFor(box, "p0", "e1", text),
  });
  const { bytes } = await applyEdits(original, state, testDeps);
  if (qpdfPath) await qpdfCheck(bytes);
  const doc = await PDFDocument.load(bytes);
  const shows = pageTextShows(doc, doc.getPage(0));
  return { bytes, shows };
}

/** Glyph text left on the row, by color. */
function rowText(shows: ReturnType<typeof pageTextShows>, color: string) {
  return shows
    .filter((s) => s.color === color)
    .map((s) => s.text)
    .join("");
}

/** The value's area in user space, for rendering checks. */
const VALUE_AREA = {
  x: VALUE_X,
  y: BASELINE - SIZE * 0.2,
  width: 80,
  height: SIZE * 1.1,
};

describe("dot leader under a label and its value", () => {
  it("the dot leader overlaps the label in the extracted text", () => {
    const dots = boxes.find((b) => /^\.+$/.test(b.text));
    expect(dots, boxes.map((b) => b.text).join(" | ")).toBeDefined();
    expect(dots!.width).toBeGreaterThan(150);
  });

  it("a click on the label opens the label, not the dots", () => {
    expect(boxAt(boxes, clickAt(70))?.text).toBe(LABEL);
    expect(boxAt(boxes, clickAt(170))?.text).toBe(VALUE);
    // Between them only the dots are visible.
    expect(boxAt(boxes, clickAt(145))?.text).toMatch(/^\.+$/);
  });

  it("editing the label keeps the value and redraws the label in black", async () => {
    const before = await renderPage(original);
    const { bytes, shows } = await edit(
      boxAt(boxes, clickAt(70))!,
      "ID de cuenta nueva",
    );
    expect(rowText(shows, "#000000")).toContain(VALUE);
    expect(rowText(shows, "#000000")).toContain("ID de cuenta nueva");
    expect(rowText(shows, "#000000")).not.toContain(LABEL);
    // The dots under the label are left alone (hidden by its white box).
    expect(rowText(shows, "#808080")).toBe(".".repeat(DOTS));
    const after = await renderPage(bytes);
    expect(inkShare(after, VALUE_AREA)).toBeCloseTo(
      inkShare(before, VALUE_AREA),
      2,
    );
  });

  it("editing the dots removes only dots", async () => {
    const dots = boxes.find((b) => /^\.+$/.test(b.text))!;
    const { shows } = await edit(dots, `${dots.text}s`);
    expect(rowText(shows, "#000000")).toBe(VALUE + LABEL);
    const gray = rowText(shows, "#808080");
    expect(gray.replace(/\./g, "")).toBe("s");
  });
});
