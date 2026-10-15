import { describe, expect, it } from "vitest";
import { A4, initialState, isPristine, type TextItem } from "./document";
import { OperationError, applyOperation, newId } from "./operations";

const threePages = () =>
  initialState([
    { box: A4, rotation: 0 },
    { box: A4, rotation: 90 },
    { box: A4, rotation: 0 },
  ]);

const text = (pageId: string, id = "t1"): TextItem => ({
  kind: "text",
  id,
  pageId,
  at: { x: 50, y: 700 },
  text: "Hola",
  style: {
    font: "Helvetica",
    size: 12,
    color: "#000000",
    bold: false,
    italic: false,
    lineHeight: 1.2,
  },
  rotate: 0,
});

describe("applyOperation", () => {
  it("starts pristine", () => {
    expect(isPristine(threePages(), 3)).toBe(true);
  });

  it("adds, updates and removes items without mutating the previous state", () => {
    const s0 = threePages();
    const s1 = applyOperation(s0, { kind: "addItem", item: text("p0") });
    expect(s0.items).toHaveLength(0);
    expect(s1.items).toHaveLength(1);
    const s2 = applyOperation(s1, {
      kind: "updateItem",
      item: { ...text("p0"), text: "Adiós" },
    });
    expect((s2.items[0] as TextItem).text).toBe("Adiós");
    expect(
      applyOperation(s2, { kind: "removeItem", itemId: "t1" }).items,
    ).toHaveLength(0);
  });

  it("rejects items on unknown pages and duplicate ids", () => {
    expect(() =>
      applyOperation(threePages(), { kind: "addItem", item: text("nope") }),
    ).toThrow(OperationError);
    const s1 = applyOperation(threePages(), {
      kind: "addItem",
      item: text("p0"),
    });
    expect(() =>
      applyOperation(s1, { kind: "addItem", item: text("p0") }),
    ).toThrow(OperationError);
  });

  it("rotates pages cumulatively, keeping the base rotation", () => {
    let s = applyOperation(threePages(), {
      kind: "rotatePage",
      pageId: "p1",
      degrees: 90,
    });
    s = applyOperation(s, { kind: "rotatePage", pageId: "p1", degrees: 270 });
    expect(s.pages[1]!.extraRotation).toBe(0);
    s = applyOperation(s, { kind: "rotatePage", pageId: "p1", degrees: -90 });
    expect(s.pages[1]!.extraRotation).toBe(270);
    expect(s.pages[1]!.baseRotation).toBe(90);
  });

  it("deletes a page and its items, but never the last page", () => {
    let s = applyOperation(threePages(), { kind: "addItem", item: text("p1") });
    s = applyOperation(s, { kind: "deletePage", pageId: "p1" });
    expect(s.pages.map((p) => p.id)).toEqual(["p0", "p2"]);
    expect(s.items).toHaveLength(0);
    expect(isPristine(s, 3)).toBe(false);
    s = applyOperation(s, { kind: "deletePage", pageId: "p0" });
    expect(() =>
      applyOperation(s, { kind: "deletePage", pageId: "p2" }),
    ).toThrow(OperationError);
  });

  it("moves pages and keeps items attached by id", () => {
    let s = applyOperation(threePages(), { kind: "addItem", item: text("p0") });
    s = applyOperation(s, { kind: "movePage", pageId: "p0", toIndex: 2 });
    expect(s.pages.map((p) => p.id)).toEqual(["p1", "p2", "p0"]);
    expect(s.items[0]!.pageId).toBe("p0");
    const last = applyOperation(s, {
      kind: "movePage",
      pageId: "p2",
      toIndex: 99,
    }).pages.at(-1);
    expect(last!.id).toBe("p2");
  });

  it("inserts blank pages", () => {
    const s = applyOperation(threePages(), {
      kind: "insertBlankPage",
      atIndex: 1,
      pageId: "b1",
      box: A4,
    });
    expect(s.pages.map((p) => p.id)).toEqual(["p0", "b1", "p1", "p2"]);
    expect(s.pages[1]!.source.kind).toBe("blank");
  });

  it("generates unique ids", () => {
    expect(newId("x")).not.toBe(newId("x"));
  });
});
