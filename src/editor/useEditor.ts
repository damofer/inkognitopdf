import { useCallback, useEffect, useState } from "react";
import type { EditorState } from "../model/document";
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  undo,
  type History,
} from "../model/history";
import { applyOperation, type Operation } from "../model/operations";

export interface Editor {
  state: EditorState;
  /** Applies one or more operations as a single undo step. */
  dispatch: (ops: Operation | Operation[]) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Last operation error, in Spanish, for the UI. */
  error: string | null;
  clearError: () => void;
}

export function useEditor(initial: EditorState): Editor {
  const [history, setHistory] = useState<History<EditorState>>(() =>
    createHistory(initial),
  );
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback((ops: Operation | Operation[]) => {
    setHistory((h) => {
      try {
        const next = (Array.isArray(ops) ? ops : [ops]).reduce(
          applyOperation,
          h.present,
        );
        return commit(h, next);
      } catch (cause) {
        // Reported asynchronously so this updater stays pure.
        queueMicrotask(() =>
          setError(cause instanceof Error ? cause.message : String(cause)),
        );
        return h;
      }
    });
  }, []);

  const doUndo = useCallback(() => setHistory(undo), []);
  const doRedo = useCallback(() => setHistory(redo), []);

  // Ctrl/Cmd+Z, Ctrl+Y and Ctrl+Shift+Z, except while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        doUndo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  return {
    state: history.present,
    dispatch,
    undo: doUndo,
    redo: doRedo,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    error,
    clearError: () => setError(null),
  };
}
