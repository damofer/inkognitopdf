/**
 * Data kept on this device for signing (spec 004): adopted signatures (only
 * with the user's consent), signing identities and trusted roots. IndexedDB
 * stores private keys as non-extractable CryptoKey objects.
 */
const DB = "pdfcraft-sign";
const STORES = ["signatures", "identities", "roots"] as const;
export type Store = (typeof STORES)[number];

let opened: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      for (const store of STORES)
        if (!request.result.objectStoreNames.contains(store))
          request.result.createObjectStore(store);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opened = null;
      reject(request.error ?? new Error(t("storage.noIndexedDb")));
    };
  });
  return opened;
}

function run<T>(
  store: Store,
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return db().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const request = action(
          database.transaction(store, mode).objectStore(store),
        );
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export const keystore = {
  get: <T>(store: Store, key: string) =>
    run<T | undefined>(store, "readonly", (s) => s.get(key)),
  put: <T>(store: Store, key: string, value: T) =>
    run(store, "readwrite", (s) => s.put(value, key)).then(() => undefined),
  delete: (store: Store, key: string) =>
    run(store, "readwrite", (s) => s.delete(key)).then(() => undefined),
  /** All values with their keys. */
  async all<T>(store: Store): Promise<{ key: string; value: T }[]> {
    const [keys, values] = await Promise.all([
      run<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()),
      run<T[]>(store, "readonly", (s) => s.getAll()),
    ]);
    return keys.map((key, i) => ({ key: String(key), value: values[i]! }));
  },
  clear: (store: Store) =>
    run(store, "readwrite", (s) => s.clear()).then(() => undefined),
};
import { t } from "../i18n";
