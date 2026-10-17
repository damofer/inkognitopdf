// Spec 028: changes not saved yet are kept on this device (storage/draft.ts)
// so the work can be resumed after the app is closed.
import { useCallback, useEffect, useRef } from "react";
import type { EditorState } from "../model/document";
import type { PlanMode, PlanSigner } from "../sign/multi";
import { clearDraft, writeDraft } from "../storage/draft";
import type { PdfFile } from "../storage/pdfFile";

/** Wait after the last change before writing. */
const DELAY = 1000;

interface Options {
  file: PdfFile | null;
  state: EditorState;
  restricted: boolean;
  signers: PlanSigner[];
  planMode: PlanMode;
  /** False for files opened with a password (RF-028-09). */
  enabled: boolean;
  /** The document was resumed from the draft with this file id. */
  resumed: { fileId: string | null } | null;
}

export function useAutosave({
  file,
  state,
  restricted,
  signers,
  planMode,
  enabled,
  resumed,
}: Options): { markSaved: (saved: EditorState) => void } {
  // The state the file on disk has: the one opened, or the last saved. A
  // resumed document has none until it is saved.
  const baseline = useRef<EditorState | null>(resumed ? null : state);
  // The file the stored draft points to, so its bytes are written once.
  const stored = useRef<{ file: PdfFile | null; id: string | null } | null>(
    resumed ? { file, id: resumed.fileId } : null,
  );
  // Whether this editor wrote the draft (only then may it remove it).
  const wrote = useRef(resumed !== null);
  const timer = useRef<number | null>(null);
  const latest = useRef({ file, state, restricted, signers, planMode });
  useEffect(() => {
    latest.current = { file, state, restricted, signers, planMode };
  });

  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const { file, state, restricted, signers, planMode } = latest.current;
    if (state === baseline.current) return;
    const fresh = !stored.current || stored.current.file !== file;
    const id = fresh
      ? file
        ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
        : null
      : stored.current!.id;
    const previous = stored.current;
    stored.current = { file, id };
    wrote.current = true;
    writeDraft(
      { fileId: id, savedAt: Date.now(), state, restricted, signers, planMode },
      fresh && file
        ? { id: id!, name: file.name, bytes: file.copyBytes() }
        : undefined,
    ).catch(() => {
      // No storage (private mode, quota): the app works without it.
      if (stored.current?.id === id) stored.current = previous;
    });
  }, []);

  const forget = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (!wrote.current) return;
    wrote.current = false;
    stored.current = null;
    clearDraft().catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (state === baseline.current) {
      forget();
      return;
    }
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, DELAY);
  }, [enabled, file, state, signers, planMode, flush, forget]);

  // Leaving the app (another tab or app, closing it): write now.
  useEffect(() => {
    if (!enabled) return;
    const now = () => {
      if (timer.current !== null) flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") now();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", now);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", now);
      // Opening another document from the menu: keep what is pending.
      now();
    };
  }, [enabled, flush]);

  const markSaved = useCallback(
    (saved: EditorState) => {
      baseline.current = saved;
      if (latest.current.state === saved) forget();
    },
    [forget],
  );

  return { markSaved };
}
