// Spec 032 (RF-032-12): what is being written, kept on this device while the
// writer is open, so closing the app loses nothing. One document at a time,
// in IndexedDB; never sent anywhere. Text written again from the editor
// (spec 033) is kept under its own key, apart from the unfinished document.
import type { WriterSettings } from "./render";

const DB = "inkognito-writer";
const STORE = "doc";
/** The unfinished document of the writer opened on its own. */
export const WRITER_KEY = "current";
/** Unfinished documents older than this are not offered again. */
export const WRITER_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

export interface WriterDraft {
  /** Milliseconds since the epoch. */
  savedAt: number;
  settings: WriterSettings;
  /** ProseMirror document as JSON. */
  doc: unknown;
  title: string;
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

export function writeWriterDraft(
  draft: WriterDraft,
  key = WRITER_KEY,
): Promise<void> {
  return transact("readwrite", (s) => void s.put(draft, key)).then(
    () => undefined,
  );
}

export function clearWriterDraft(key = WRITER_KEY): Promise<void> {
  return transact("readwrite", (s) => void s.delete(key)).then(() => undefined);
}

/** The unfinished document, or null; an expired one is removed. */
export async function readWriterDraft(
  now = Date.now(),
  key = WRITER_KEY,
): Promise<WriterDraft | null> {
  const draft = (await transact<WriterDraft>("readonly", (s) => s.get(key))) as
    WriterDraft | undefined;
  if (!draft) return null;
  if (now - draft.savedAt > WRITER_MAX_AGE) {
    await clearWriterDraft(key);
    return null;
  }
  return draft;
}
