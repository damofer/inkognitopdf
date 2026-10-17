// Spec 018: words, the diff between two versions and changed pixels.
import { describe, expect, it } from "vitest";
import {
  compareWords,
  diffPixels,
  diffSequences,
  wordsOf,
  type Word,
} from "../src/model/compare";

const split = (s: string) => s.split(" ").filter(Boolean);

/** Applies a diff to `a` and checks it gives `b`. */
function apply(a: string[], b: string[]) {
  const ops = diffSequences(a, b)!;
  const out: string[] = [];
  for (const op of ops)
    if (op.kind === "equal") out.push(...a.slice(op.a, op.a + op.length));
    else out.push(...b.slice(op.b, op.b + op.bLength));
  return { ops, out };
}

describe("diffSequences", () => {
  it.each([
    ["el perro come pan", "el gato come pan"],
    ["uno dos tres", "uno dos tres cuatro"],
    ["uno dos tres", "cero uno dos tres"],
    ["a b c d e f", "a c d x f"],
    ["", "nuevo texto"],
    ["texto viejo", ""],
    ["a a a b", "a b b"],
  ])("«%s» → «%s»", (x, y) => {
    const a = split(x);
    const b = split(y);
    expect(apply(a, b).out).toEqual(b);
  });

  it("finds the smallest change", () => {
    const ops = diffSequences(
      split("el perro come pan"),
      split("el gato come pan"),
    );
    expect(ops).toEqual([
      { kind: "equal", a: 0, b: 0, length: 1 },
      { kind: "change", a: 1, aLength: 1, b: 1, bLength: 1 },
      { kind: "equal", a: 2, b: 2, length: 2 },
    ]);
  });

  it("gives up past the limit", () => {
    const a = Array.from({ length: 50 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 50 }, (_, i) => `b${i}`);
    expect(diffSequences(a, b, 20)).toBeNull();
  });

  it("is quick on long documents with few changes", () => {
    const a = Array.from({ length: 200_000 }, (_, i) => `w${i % 977}`);
    const b = [...a];
    b[1000] = "cambio";
    b.splice(150_000, 3);
    const started = performance.now();
    const ops = diffSequences(a, b)!;
    expect(performance.now() - started).toBeLessThan(2000);
    expect(ops.filter((o) => o.kind === "change")).toHaveLength(2);
  });
});

describe("wordsOf", () => {
  it("splits a run into words with boxes from the top left", () => {
    // A 842 pt high page: the viewport flips y.
    const viewport = [1, 0, 0, -1, 0, 842];
    const words = wordsOf(
      [{ str: "Hola mundo", transform: [10, 0, 0, 10, 100, 700], width: 50 }],
      viewport,
      2,
    );
    expect(words.map((w) => w.text)).toEqual(["Hola", "mundo"]);
    expect(words[0]).toMatchObject({ page: 2, x: 100, width: 20 });
    expect(words[1]!.x).toBeCloseTo(125);
    expect(words[0]!.y).toBeCloseTo(142 - 8.5);
  });

  it("folds ligatures", () => {
    const words = wordsOf(
      [{ str: "ﬁnal", transform: [10, 0, 0, 10, 0, 0], width: 20 }],
      [1, 0, 0, -1, 0, 100],
      0,
    );
    expect(words[0]!.text).toBe("final");
  });
});

describe("compareWords", () => {
  const page = (text: string, n: number): Word[] =>
    split(text).map((t, i) => ({
      text: t,
      page: n,
      x: i,
      y: 0,
      width: 1,
      height: 1,
    }));

  it("lists the changes and pairs moved pages", () => {
    const before = [
      ...page("uno dos tres", 0),
      ...page("cuatro cinco seis", 1),
    ];
    const after = [
      ...page("portada nueva", 0),
      ...page("uno dos tres", 1),
      ...page("cuatro CINCO seis", 2),
    ];
    const result = compareWords(before, after, 3);
    expect(result.tooMany).toBe(false);
    expect(
      result.changes.map((c) => [
        c.removed.map((w) => w.text).join(" "),
        c.added.map((w) => w.text).join(" "),
      ]),
    ).toEqual([
      ["", "portada nueva"],
      ["cinco", "CINCO"],
    ]);
    expect(result.pairs).toEqual([-1, 0, 1]);
  });

  it("pages without text follow the previous pair", () => {
    const before = [...page("a b", 0), ...page("c d", 2)];
    const after = [...page("a b", 0), ...page("c d", 2)];
    expect(compareWords(before, after, 3).pairs).toEqual([0, 1, 2]);
  });
});

describe("diffPixels", () => {
  it("counts the pixels that differ beyond the threshold", () => {
    const a = new Uint8ClampedArray([
      255, 255, 255, 255, 0, 0, 0, 255, 250, 250, 250, 255,
    ]);
    const b = new Uint8ClampedArray([
      255, 255, 255, 255, 255, 0, 0, 255, 255, 255, 255, 255,
    ]);
    const { mask, changed } = diffPixels(a, b);
    expect(changed).toBe(1);
    expect([...mask]).toEqual([0, 1, 0]);
  });
});
