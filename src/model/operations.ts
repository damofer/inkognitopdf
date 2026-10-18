import { t } from "../i18n";
import type { Box, Rotation } from "./geometry";
import { normalizeRotation } from "./geometry";
import type { EditorState, Item, PageEntry, WrittenSource } from "./document";
import type { Numbering } from "./numbering";

/**
 * Typed edit operations (spec 001, plan: modelo de datos). Each tool emits
 * operations; `applyOperation` is a pure reducer over EditorState.
 */
export type Operation =
  | { kind: "addItem"; item: Item }
  | { kind: "updateItem"; item: Item }
  | { kind: "removeItem"; itemId: string }
  | { kind: "rotatePage"; pageId: string; degrees: 90 | 180 | 270 | -90 }
  | { kind: "deletePage"; pageId: string }
  | { kind: "movePage"; pageId: string; toIndex: number }
  | { kind: "insertBlankPage"; atIndex: number; pageId: string; box: Box }
  | {
      kind: "insertPages";
      atIndex: number;
      pages: PageEntry[];
      /** Items of the new pages, e.g. their OCR text (spec 009). */
      items?: Item[];
      /** Spec 033: the text the new pages were written from. */
      written?: { id: string; source: WrittenSource };
    }
  /** Page numbers, headers and footers (spec 022); null removes them. */
  | { kind: "setNumbering"; numbering: Numbering | null };

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationError";
  }
}

function requirePage(state: EditorState, pageId: string): number {
  const index = state.pages.findIndex((p) => p.id === pageId);
  if (index < 0) throw new OperationError(t("operations.unknownPage", pageId));
  return index;
}

function replacePage(
  state: EditorState,
  index: number,
  page: PageEntry,
): PageEntry[] {
  return state.pages.map((p, i) => (i === index ? page : p));
}

export function applyOperation(state: EditorState, op: Operation): EditorState {
  switch (op.kind) {
    case "addItem": {
      requirePage(state, op.item.pageId);
      if (state.items.some((i) => i.id === op.item.id))
        throw new OperationError(t("operations.duplicateItem", op.item.id));
      return { ...state, items: [...state.items, op.item] };
    }
    case "updateItem": {
      if (!state.items.some((i) => i.id === op.item.id))
        throw new OperationError(t("operations.unknownItem", op.item.id));
      requirePage(state, op.item.pageId);
      return {
        ...state,
        items: state.items.map((i) => (i.id === op.item.id ? op.item : i)),
      };
    }
    case "removeItem":
      return { ...state, items: state.items.filter((i) => i.id !== op.itemId) };
    case "rotatePage": {
      const index = requirePage(state, op.pageId);
      const page = state.pages[index]!;
      const extraRotation: Rotation = normalizeRotation(
        page.extraRotation + op.degrees,
      );
      return {
        ...state,
        pages: replacePage(state, index, { ...page, extraRotation }),
      };
    }
    case "deletePage": {
      requirePage(state, op.pageId);
      if (state.pages.length === 1)
        throw new OperationError(t("operations.lastPage"));
      return {
        ...state,
        pages: state.pages.filter((p) => p.id !== op.pageId),
        items: state.items.filter((i) => i.pageId !== op.pageId),
      };
    }
    case "movePage": {
      const from = requirePage(state, op.pageId);
      const to = Math.max(0, Math.min(state.pages.length - 1, op.toIndex));
      if (from === to) return state;
      const pages = [...state.pages];
      const [page] = pages.splice(from, 1);
      pages.splice(to, 0, page!);
      return { ...state, pages };
    }
    case "insertBlankPage": {
      if (state.pages.some((p) => p.id === op.pageId))
        throw new OperationError(t("operations.duplicatePage", op.pageId));
      const at = Math.max(0, Math.min(state.pages.length, op.atIndex));
      const page: PageEntry = {
        id: op.pageId,
        source: { kind: "blank" },
        box: op.box,
        baseRotation: 0,
        extraRotation: 0,
      };
      const pages = [...state.pages];
      pages.splice(at, 0, page);
      return { ...state, pages };
    }
    case "insertPages": {
      for (const page of op.pages)
        if (state.pages.some((p) => p.id === page.id))
          throw new OperationError(t("operations.duplicatePage", page.id));
      const at = Math.max(0, Math.min(state.pages.length, op.atIndex));
      const pages = [...state.pages];
      pages.splice(at, 0, ...op.pages);
      const next = {
        ...state,
        pages,
        items: [...state.items, ...(op.items ?? [])],
      };
      if (op.written)
        next.written = { ...state.written, [op.written.id]: op.written.source };
      return next;
    }
    case "setNumbering": {
      const { numbering: _, ...rest } = state;
      return op.numbering ? { ...rest, numbering: op.numbering } : rest;
    }
  }
}

let counter = 0;
/** Unique id for new items and pages within this session. */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}
