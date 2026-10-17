// Spec 028: the work not saved yet, kept on this device so it can be resumed
// after the app is closed. One draft at a time: the PDF it starts from and its
// edit state, under separate keys so each change rewrites only the state.
import type { EditorState } from "../model/document";
import type { PlanMode, PlanSigner } from "../sign/multi";

const DB = "inkognito-draft";
const STORE = "draft";
/** Drafts older than this are removed and not offered (RNF-028-02). */
export const DRAFT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export interface DraftFile {
  id: string;
  name: string;
  bytes: Uint8Array;
}

export interface DraftState {
  /** The DraftFile the edits apply to; null for blank and scanned documents. */
  fileId: string | null;
  /** Milliseconds since the epoch. */
  savedAt: number;
  state: EditorState;
  /** The file only restricted permissions (spec 014). */
  restricted: boolean;
  signers: PlanSigner[];
  planMode: PlanMode;
}

export interface Draft extends DraftState {
  file: DraftFile | null;
}

let opened: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opened = null;
      reject(request.error ?? new Error("IndexedDB")); // i18n-ignore: never shown
    };
  });
  return opened;
}

/** Runs `action` in one transaction and resolves when it is committed. */
async function transact<T>(
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Writes the edit state, and the file in the same transaction when given. */
export function writeDraft(state: DraftState, file?: DraftFile): Promise<void> {
  return transact("readwrite", (s) => {
    if (file) s.put(file, "file");
    else if (state.fileId === null) s.delete("file");
    s.put(state, "state");
  }).then(() => undefined);
}

export function clearDraft(): Promise<void> {
  return transact("readwrite", (s) => s.clear()).then(() => undefined);
}

/** The draft to offer, or null; an expired or broken one is removed. */
export async function readDraft(now = Date.now()): Promise<Draft | null> {
  const [state, file] = await Promise.all([
    transact<DraftState | undefined>("readonly", (s) => s.get("state")),
    transact<DraftFile | undefined>("readonly", (s) => s.get("file")),
  ]);
  if (!state) return null;
  const usable =
    now - state.savedAt <= DRAFT_MAX_AGE &&
    (state.fileId === null || file?.id === state.fileId);
  if (!usable) {
    await clearDraft();
    return null;
  }
  return { ...state, file: state.fileId === null ? null : file! };
}
