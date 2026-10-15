import { describe, expect, it } from "vitest";
import type { AnnotationItem, TextItem } from "../model/document";
import {
  DEFAULT_TEXT_STYLE,
  mergeLineRects,
  moveItem,
  resizableRect,
  visualRotation,
  withRect,
} from "./itemOps";

describe("moveItem", () => {
  it("moves text by its baseline origin", () => {
    const t: TextItem = {
      kind: "text",
      id: "t",
      pageId: "p0",
      at: { x: 10, y: 20 },
      text: "a",
      style: DEFAULT_TEXT_STYLE,
      rotate: 0,
    };
    expect((moveItem(t, { x: 5, y: -3 }) as TextItem).at).toEqual({
      x: 15,
      y: 17,
    });
  });

  it("moves every point of annotations", () => {
    const a: AnnotationItem = {
      kind: "annotation",
      id: "a",
      pageId: "p0",
      shape: "ink",
      color: "#000",
      width: 1,
      paths: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      ],
    };
    expect((moveItem(a, { x: 1, y: 2 }) as AnnotationItem).paths).toEqual([
      [
        { x: 1, y: 2 },
        { x: 2, y: 3 },
      ],
    ]);
  });
});

describe("resizable rects", () => {
  it("applies only to images, whiteouts, squares and circles", () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    const w = { kind: "whiteout" as const, id: "w", pageId: "p", rect };
    expect(resizableRect(w)).toEqual(rect);
    expect(resizableRect(withRect(w, { ...rect, width: 20 }))!.width).toBe(20);
    const ink: AnnotationItem = {
      kind: "annotation",
      id: "i",
      pageId: "p",
      shape: "ink",
      color: "#000",
      width: 1,
      paths: [],
    };
    expect(resizableRect(ink)).toBeNull();
  });
});

describe("mergeLineRects", () => {
  it("merges runs on the same line and keeps lines apart", () => {
    const merged = mergeLineRects([
      { x: 0, y: 0, width: 50, height: 12 },
      { x: 55, y: 1, width: 40, height: 11 },
      { x: 0, y: 20, width: 30, height: 12 },
      { x: 0, y: 40, width: 0, height: 12 }, // empty run
    ]);
    expect(merged).toEqual([
      { x: 0, y: 0, width: 95, height: 12 },
      { x: 0, y: 20, width: 30, height: 12 },
    ]);
  });
});

describe("visualRotation", () => {
  it("is zero when the item was created on the page as shown", () => {
    expect(visualRotation(90, 90)).toBe(0);
    expect(visualRotation(180, 90)).toBe(90);
    expect(visualRotation(0, 90)).toBe(270);
  });
});
