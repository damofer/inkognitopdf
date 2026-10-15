// Spec 001, phase 6 (T032–T034): changed-text edits on a statement-like page.
// The edited line must look like its untouched sibling (font, weight, color,
// size), keep the background under it, and leave no glyph of the old text.
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { textBoxes, textEditFor, type TextBox } from "../src/editor/textBoxes";
import { applyEdits } from "../src/engine/applyEdits";
import { pageTextShows } from "../src/engine/textEdit";
import type { TextShow } from "../src/engine/textShows";
import type { Rect } from "../src/model/geometry";
import { applyOperation } from "../src/model/operations";
import { openPdf, qpdfCheck, qpdfPath, stateFor, testDeps } from "./helpers";
import {
  diffShare,
  inkShare,
  offColorShare,
  renderPage,
} from "./renderHelpers";
import { BAND, LINES, NAVY, buildStatement } from "./statementFixture";

let original: Uint8Array;
let boxes: TextBox[];

beforeAll(async () => {
  original = await buildStatement();
  const doc = await openPdf(original);
  boxes = textBoxes(await (await doc.getPage(1)).getTextContent());
  await doc.loadingTask.destroy();
});

const boxOf = (text: string) => {
  const box = boxes.find((b) => b.text === text);
  if (!box)
    throw new Error(
      `no box «${text}»: ${boxes.map((b) => b.text).join(" | ")}`,
    );
  return box;
};

async function edit(box: TextBox, text: string) {
  const state = applyOperation(await stateFor(original), {
    kind: "addItem",
    item: textEditFor(box, "p0", "e1", text),
  });
  const result = await applyEdits(original, state, testDeps);
  if (qpdfPath) await qpdfCheck(result.bytes);
  const doc = await PDFDocument.load(result.bytes);
  return { ...result, shows: pageTextShows(doc, doc.getPage(0)) };
}

const inside = (p: { x: number; y: number }, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

/** Glyph text of the operations whose glyphs are centred in `area`. */
function textIn(shows: TextShow[], area: Rect): string {
  let out = "";
  for (const show of shows)
    for (const part of show.parts)
      if (part.kind === "glyph" && inside(part.center, area))
        out += part.unicode;
  return out;
}

const showWith = (shows: TextShow[], text: string) =>
  shows.find((s) =>
    s.text.replace(/\s/g, "").includes(text.replace(/\s/g, "")),
  );

describe("statement-like page (T032–T034)", () => {
  it("opens with the expected lines", () => {
    for (const line of [LINES.activity, LINES.fees, LINES.payments])
      expect(boxOf(line).text).toBe(line);
  });

  for (const next of [
    "Saldo inicial a fecha de 1 abr 2026 (actualizado)",
    "Saldo",
  ])
    it(`a changed line looks like its untouched sibling: «${next}»`, async () => {
      const box = boxOf(LINES.opening);
      const { shows, warnings } = await edit(box, next);
      // «(», «)», «z»… are not in the subsets: they come from Arimo Bold.
      expect(warnings.join(" ")).not.toContain("No se encontró");
      const sibling = showWith(shows, "tal de actividades nuevas")!;
      const edited = shows.filter((s) =>
        s.parts.some(
          (p) =>
            p.kind === "glyph" &&
            inside(p.center, { ...box.area, width: 540 - box.area.x }),
        ),
      );
      expect(edited.length).toBeGreaterThan(0);
      for (const show of edited) {
        expect(show.color).toBe(NAVY);
        expect(show.color).toBe(sibling.color);
        expect(show.font?.bold).toBe(true);
        expect(show.font?.baseFont.replace(/^[A-Z]{6}\+/, "")).toBe(
          sibling.font?.baseFont.replace(/^[A-Z]{6}\+/, ""),
        );
        expect(show.size).toBeCloseTo(sibling.size, 3);
        expect(show.origin.y).toBeCloseTo(box.at.y, 2);
      }
      expect(edited[0]!.origin.x).toBeCloseTo(box.at.x, 1);
      // No glyph of the old text is left in the line.
      // (The line is alone on the page width: look up to the right margin.)
      const line = { ...box.area, width: 540 - box.area.x };
      expect(textIn(shows, line).replace(/\s/g, "")).toBe(
        next.replace(/\s/g, ""),
      );
    });

  it("uses another subset of the same font before an open substitute", async () => {
    const box = boxOf(LINES.opening);
    // Q, U, I and Z are only in the second subset of the bold font.
    const { shows, warnings } = await edit(box, "Saldo QUIZ");
    expect(warnings).toEqual([]);
    const fromB = shows.find((s) => s.text.includes("QUIZ"));
    expect(fromB?.font?.baseFont).toBe(
      showWith(shows, "Comisiones")?.font?.baseFont,
    );
    expect(fromB?.color).toBe(NAVY);
  });

  it("keeps the colored band under edited text (no white box)", async () => {
    const box = boxOf(LINES.activity);
    const { bytes } = await edit(box, "Total");
    const after = await renderPage(bytes);
    // Right of the new, shorter text the band shows, as before the text.
    const freed: Rect = {
      x: box.at.x + 40,
      y: box.area.y,
      width: box.area.width - 40,
      height: box.area.height,
    };
    expect(offColorShare(after, freed, BAND)).toBeLessThan(0.01);
    // And the new text is drawn.
    expect(inkShare(after, { ...box.area, width: 30 })).toBeGreaterThan(0.05);
  });

  it("keeps the image under edited text", async () => {
    const box = boxOf(LINES.payments);
    const { bytes } = await edit(box, "Pagos");
    const after = await renderPage(bytes);
    const reference = await renderPage(
      await buildStatement({ withoutImageText: true }),
    );
    const freed: Rect = {
      x: box.at.x + 32,
      y: box.area.y,
      width: box.area.width - 32,
      height: box.area.height,
    };
    expect(diffShare(after, reference, freed)).toBeLessThan(0.01);
  });

  it("draws characters taken from the open substitute font", async () => {
    const box = boxOf(LINES.activity);
    const { bytes, warnings } = await edit(box, "Ŵŵ Ŵŵ Ŵŵ");
    expect(warnings.join(" ")).toContain("Arimo Bold");
    const after = await renderPage(bytes);
    // The glyphs are visible, not only extractable.
    expect(inkShare(after, { ...box.area, width: 40 })).toBeGreaterThan(0.08);
  });
});
