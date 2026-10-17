// Spec 017: PDFs that arrive from the system: «Open with» (File Handling API)
// and shared from other apps (Web Share Target, kept by the service worker in
// public/share-target.js).

/** The cache where the service worker leaves shared PDFs. */
const SHARED_CACHE = "inkognito-shared";

export function isPdf(file: { name: string; type: string }): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** Whether the app was opened to receive shared PDFs. */
export function wasShared(location: Location = window.location): boolean {
  return new URLSearchParams(location.search).has("shared");
}

/** The shared PDFs, in the order they came; they are removed from the cache. */
export async function takeShared(): Promise<File[]> {
  if (!("caches" in window)) return [];
  const cache = await caches.open(SHARED_CACHE);
  const requests = await cache.keys();
  const order = (r: Request) =>
    Number(new URL(r.url).pathname.split("/").pop());
  const files: File[] = [];
  for (const request of [...requests].sort((a, b) => order(a) - order(b))) {
    const response = await cache.match(request);
    if (!response) continue;
    const name = decodeURIComponent(
      response.headers.get("X-File-Name") ?? "shared.pdf",
    );
    files.push(
      new File([await response.blob()], name, { type: "application/pdf" }),
    );
  }
  await caches.delete(SHARED_CACHE);
  return files;
}

interface LaunchParams {
  files: readonly FileSystemFileHandle[];
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

/** Calls `open` with the PDFs the app is launched with («Open with»). */
export function onLaunch(open: (files: File[]) => void): void {
  const queue = (window as { launchQueue?: LaunchQueue }).launchQueue;
  queue?.setConsumer((params) => {
    if (params.files.length === 0) return;
    void Promise.all(params.files.map((handle) => handle.getFile())).then(
      (files) => {
        const pdfs = files.filter(isPdf);
        if (pdfs.length > 0) open(pdfs);
      },
    );
  });
}
