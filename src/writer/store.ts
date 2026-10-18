// Spec 032 (RF-032-12): what is being written, kept on this device while the
// writer is open, so closing the app loses nothing. One document at a time,
// in IndexedDB; never sent anywhere.
import type { WriterSettings } from "./render";

const DB = "inkognito-writer";
const STORE = "doc";
const KEY = "current";
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

export function writeWriterDraft(draft: WriterDraft): Promise<void> {
  return transact("readwrite", (s) => void s.put(draft, KEY)).then(
    () => undefined,
  );
}

export function clearWriterDraft(): Promise<void> {
  return transact("readwrite", (s) => void s.delete(KEY)).then(() => undefined);
}

/** The unfinished document, or null; an expired one is removed. */
export async function readWriterDraft(
  now = Date.now(),
): Promise<WriterDraft | null> {
  const draft = (await transact<WriterDraft>("readonly", (s) => s.get(KEY))) as
    WriterDraft | undefined;
  if (!draft) return null;
  if (now - draft.savedAt > WRITER_MAX_AGE) {
    await clearWriterDraft();
    return null;
  }
  return draft;
}
