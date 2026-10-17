// Spec 022: page numbers, headers and footers.
import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/engine/applyEdits";
import {
  A4,
  isPristine,
  type EditorState,
  type PageEntry,
} from "../src/model/document";
import { PageGeometry, type Box, type Rotation } from "../src/model/geometry";
import {
  batesNumber,
  defaultNumbering,
  numberedPages,
  numberingDate,
  resolveText,
  type Numbering,
} from "../src/model/numbering";
import { applyOperation } from "../src/model/operations";
import { fixture, pageText, stateFor, testDeps, textRuns } from "./helpers";

const numbering = (extra: Partial<Numbering> = {}): Numbering => ({
  ...defaultNumbering("Contrato"),
  ...extra,
});

function blankPages(rotations: Rotation[], box: Box = A4): EditorState {
  return {
    pages: rotations.map((extraRotation, i): PageEntry => ({
      id: `b${i}`,
      source: { kind: "blank" },
      box,
      baseRotation: 0,
      extraRotation,
    })),
    items: [],
  };
}

async function save(
  state: EditorState,
  original: Uint8Array = new Uint8Array(),
) {
  return (await applyEdits(original, state, testDeps)).bytes;
}

describe("numbered pages", () => {
  it("counts only the numbered pages, from the first number", () => {
    const { numbers, total } = numberedPages(
      numbering({ from: 2, startAt: 2 }),
      5,
    );
    expect([...numbers]).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
    ]);
    expect(total).toBe(5);
  });

  it("keeps the range inside the document", () => {
    const { numbers, total } = numberedPages(
      numbering({ from: 0, to: 9, startAt: 10 }),
      3,
    );
    expect([...numbers.values()]).toEqual([10, 11, 12]);
    expect(total).toBe(12);
    expect(numberedPages(numbering({ from: 4 }), 3).numbers.size).toBe(0);
  });

  it("replaces the fields, in Spanish or English", () => {
    const n = numbering({ bates: { prefix: "EXP-", digits: 6 } });
    const ctx = { n: 7, total: 12, date: "17/10/2026" };
    expect(resolveText("Página {n} de {total}", n, ctx)).toBe("Página 7 de 12");
    expect(resolveText("{archivo} · {fecha}", n, ctx)).toBe(
      "Contrato · 17/10/2026",
    );
    expect(resolveText("{file} {date} {bates}", n, ctx)).toBe(
      "Contrato 17/10/2026 EXP-000007",
    );
    expect(resolveText("{otro}", n, ctx)).toBe("{otro}");
    expect(batesNumber({ prefix: "", digits: 3 }, 1234)).toBe("1234");
    expect(numberingDate(new Date(2026, 9, 7), "es-ES")).toBe("07/10/2026");
  });
});

describe("the operation", () => {
  it("is one undoable setting that survives page changes", () => {
    const state = blankPages([0, 0]);
    const set = applyOperation(state, {
      kind: "setNumbering",
      numbering: numbering(),
    });
    expect(set.numbering?.texts.bc).toBe("{n}");
    const deleted = applyOperation(set, { kind: "deletePage", pageId: "b0" });
    expect(deleted.numbering).toEqual(set.numbering);
    const removed = applyOperation(set, {
      kind: "setNumbering",
      numbering: null,
    });
    expect("numbering" in removed).toBe(false);
  });

  it("makes an original document not pristine", async () => {
    const state = await stateFor(await fixture("two-pages.pdf"));
    expect(
      isPristine(
        applyOperation(state, {
          kind: "setNumbering",
          numbering: numbering(),
        }),
        2,
      ),
    ).toBe(false);
  });
});

describe("drawn on the page", () => {
  it("writes real text at the bottom center of each page", async () => {
    const bytes = await save({
      ...blankPages([0, 0, 0]),
      numbering: numbering({ texts: { bc: "Página {n} de {total}" } }),
    });
    expect(await pageText(bytes, 2)).toBe("Página 2 de 3");
    const [run] = await textRuns(bytes, 3);
    expect(run!.str).toBe("Página 3 de 3");
    expect(run!.size).toBeCloseTo(10);
    // Centered: as far from the left edge as its end is from the right.
    expect(run!.x).toBeGreaterThan(595.28 / 2 - 40);
    expect(run!.x).toBeLessThan(595.28 / 2 - 20);
    const margin = 12 * (72 / 25.4);
    expect(run!.y).toBeGreaterThan(margin);
    expect(run!.y).toBeLessThan(margin + 4);
  });

  it("leaves out the pages before `from` and after `to`", async () => {
    const bytes = await save({
      ...blankPages([0, 0, 0, 0]),
      numbering: numbering({
        from: 2,
        to: 3,
        startAt: 2,
        texts: { tr: "{n}" },
      }),
    });
    expect(await pageText(bytes, 1)).toBe("");
    expect(await pageText(bytes, 2)).toBe("2");
    expect(await pageText(bytes, 3)).toBe("3");
    expect(await pageText(bytes, 4)).toBe("");
  });

  it("follows the page as shown on rotated pages, upright", async () => {
    const rotations: Rotation[] = [0, 90, 180, 270];
    const box: Box = [100, 200, 700, 1000];
    const state = blankPages(rotations, box);
    const bytes = await save({
      ...state,
      numbering: numbering({ texts: { bl: "Pie", tr: "Arriba" } }),
    });
    for (const [i, rotation] of rotations.entries()) {
      const geometry = new PageGeometry(box, rotation, 1);
      const runs = await textRuns(bytes, i + 1);
      const at = (text: string) => {
        const run = runs.find((r) => r.str === text)!;
        return geometry.toView(run);
      };
      const foot = at("Pie");
      const head = at("Arriba");
      const margin = 12 * (72 / 25.4);
      // The bottom-left text starts at the margin, near the bottom edge.
      expect(foot.x).toBeCloseTo(margin, 0);
      expect(geometry.viewHeight - foot.y).toBeGreaterThan(margin);
      expect(geometry.viewHeight - foot.y).toBeLessThan(margin + 4);
      // The top-right text ends at the margin, near the top edge.
      expect(head.x).toBeLessThan(geometry.viewWidth - margin - 20);
      expect(head.x).toBeGreaterThan(geometry.viewWidth - margin - 50);
      expect(head.y).toBeGreaterThan(margin);
      expect(head.y).toBeLessThan(margin + 10);
    }
  });

  it("draws over an original page without moving its content", async () => {
    const original = await fixture("simple-text.pdf");
    const before = await textRuns(original);
    const state = await stateFor(original);
    const bytes = await save(
      {
        ...state,
        numbering: numbering({
          texts: { tc: "Confidencial · {archivo}", bc: "{bates}" },
          bates: { prefix: "EXP-", digits: 6 },
          startAt: 123,
          color: "#cc0000",
        }),
      },
      original,
    );
    const after = await textRuns(bytes);
    for (const run of before)
      expect(after).toContainEqual(
        expect.objectContaining({ str: run.str, x: run.x, y: run.y }),
      );
    const text = await pageText(bytes);
    expect(text).toContain("Confidencial · Contrato");
    expect(text).toContain("EXP-000123");
  });

  it("uses a bundled font for characters the standard fonts lack", async () => {
    const result = await applyEdits(
      new Uint8Array(),
      {
        ...blankPages([0]),
        numbering: numbering({ texts: { bc: "Страница {n}" } }),
      },
      testDeps,
    );
    expect(await pageText(result.bytes)).toBe("Страница 1");
  });

  it("writes the date of saving", async () => {
    const bytes = await save({
      ...blankPages([0]),
      numbering: numbering({ texts: { br: "{fecha}" } }),
    });
    expect(await pageText(bytes)).toBe(numberingDate(testDeps.now!(), "es-ES"));
  });
});
