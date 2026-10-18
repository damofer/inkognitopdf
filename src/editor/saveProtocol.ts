/** Messages between the editor and the save worker (spec 038). */
import type { SaveOptions, SaveResult } from "../engine/applyEdits";
import type { Lang } from "../i18n/core";
import type { EditorState } from "../model/document";

export interface SaveRequest {
  seq: number;
  /** The caller's own copy of the file; transferred, not copied. */
  original: Uint8Array;
  state: EditorState;
  options: SaveOptions;
  /** Warnings come back in the interface language. */
  lang: Lang;
}

export type SaveResponse =
  /** Sent once the worker listens: requests wait for it, none get lost. */
  | { ready: true }
  | { seq: number; ok: true; result: SaveResult }
  | {
      seq: number;
      ok: false;
      /** The worker cannot save here: the editor saves on the main thread. */
      unavailable?: boolean;
      error: { name: string; message: string };
    };
