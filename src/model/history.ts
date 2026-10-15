/**
 * Undo/redo over immutable states (spec 001, HU8 / CA8). Each committed
 * operation produces a new state; undo and redo move between them.
 */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/** CA8 asks for at least 50 steps. */
export const DEFAULT_HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function commit<T>(
  history: History<T>,
  next: T,
  limit = DEFAULT_HISTORY_LIMIT,
): History<T> {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  return {
    past: past.slice(Math.max(0, past.length - limit)),
    present: next,
    future: [],
  };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  const [next, ...future] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present], present: next, future };
}

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;
