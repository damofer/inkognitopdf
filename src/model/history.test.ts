import { describe, expect, it } from "vitest";
import { canRedo, canUndo, commit, createHistory, redo, undo } from "./history";

describe("history", () => {
  it("undoes and redoes", () => {
    let h = createHistory(0);
    h = commit(h, 1);
    h = commit(h, 2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(2);
  });

  it("drops the redo branch after a new commit", () => {
    let h = commit(commit(createHistory("a"), "b"), "c");
    h = commit(undo(h), "d");
    expect(h.present).toBe("d");
    expect(canRedo(h)).toBe(false);
  });

  it("is a no-op at the ends and for unchanged states", () => {
    const h = createHistory({ v: 1 });
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
    expect(commit(h, h.present)).toBe(h);
  });

  it("CA8: supports at least 50 undo steps", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 60; i++) h = commit(h, i);
    let steps = 0;
    while (canUndo(h)) {
      h = undo(h);
      steps++;
    }
    expect(steps).toBe(60);
    expect(h.present).toBe(0);
    for (let i = 0; i < 60; i++) h = redo(h);
    expect(h.present).toBe(60);
  });

  it("caps memory at the limit", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 10; i++) h = commit(h, i, 5);
    expect(h.past).toHaveLength(5);
    expect(h.past[0]).toBe(5);
  });
});
