// Spec 019: initials on every page, upright and at the bottom right.
import { describe, expect, it } from "vitest";
import type { EditorState, PageEntry } from "../src/model/document";
import { PageGeometry } from "../src/model/geometry";
import { initialsOnEveryPage } from "../src/model/initials";
import type { SignatureAsset } from "../src/model/signature";

const asset = {
  kind: "typed",
  text: "AP",
  font: "caveat",
} as unknown as SignatureAsset;
const page = (id: string, rotation: 0 | 90 = 0): PageEntry => ({
  id,
  source: { kind: "blank" },
  box: [0, 0, 595, 842],
  baseRotation: rotation,
  extraRotation: 0,
});

describe("initialsOnEveryPage", () => {
  it("puts them at the bottom right of each page as seen", () => {
    const state: EditorState = { pages: [page("a"), page("b", 90)], items: [] };
    let n = 0;
    const items = initialsOnEveryPage(state, asset, 2, () => `i${++n}`);
    expect(items.map((i) => [i.id, i.pageId, i.rotate])).toEqual([
      ["i1", "a", 0],
      ["i2", "b", 90],
    ]);
    // Upright page: 36 pt from the right and bottom edges, 56 × 28.
    expect(items[0]!.rect).toEqual({
      x: 595 - 36 - 56,
      y: 36,
      width: 56,
      height: 28,
    });
    // Rotated page: the same corner of the page as it is seen.
    const seen = new PageGeometry([0, 0, 595, 842], 90, 1).rectToView(
      items[1]!.rect,
    );
    expect(seen.x + seen.width).toBeCloseTo(842 - 36);
    expect(seen.y + seen.height).toBeCloseTo(595 - 36);
    expect(seen.width).toBeCloseTo(56);
  });

  it("skips pages that already have initials", () => {
    const state: EditorState = {
      pages: [page("a"), page("b")],
      items: [
        {
          kind: "signature",
          id: "x",
          pageId: "a",
          role: "initials",
          asset,
          rect: { x: 0, y: 0, width: 10, height: 10 },
          rotate: 0,
        },
      ],
    };
    expect(
      initialsOnEveryPage(state, asset, 1, () => "n").map((i) => i.pageId),
    ).toEqual(["b"]);
  });

  it("keeps wide initials within a third of the page", () => {
    const state: EditorState = { pages: [page("a")], items: [] };
    const [item] = initialsOnEveryPage(state, asset, 20, () => "n");
    expect(item!.rect.width).toBeCloseTo(595 * 0.3);
    expect(item!.rect.height).toBeCloseTo((595 * 0.3) / 20);
  });
});
