/**
 * Spec 037: the installed app downloads the OCR files in the background, so
 * the first recognition also works offline. They are not part of the precache
 * (spec 003): a first visit should not download ~10 MB that may never be used.
 */
import { relaxedSimd, simd } from "wasm-feature-detect";
import { OCR_LANGUAGES } from "./ocrClient";

/** The service worker's cache for these files (runtimeCaching in vite.config.ts). */
export const OCR_CACHE = "pdfcraft-ocr";

/**
 * The files OCR will ask for in this browser: the worker, the engine build
 * tesseract.js picks for it (same feature checks) and every language.
 */
export async function ocrFiles(): Promise<string[]> {
  const base = `${import.meta.env.BASE_URL}tesseract/`;
  const build = (await relaxedSimd())
    ? "relaxedsimd-"
    : (await simd())
      ? "simd-"
      : "";
  const languages = OCR_LANGUAGES.map((l) => l.code).filter(
    (code) => !code.includes("+"),
  );
  return [
    `${base}worker.min.js`,
    `${base}tesseract-core-${build}lstm.wasm.js`,
    ...languages.map((code) => `${base}${code}.traineddata.gz`),
  ];
}

/** Opened as an installed app (or added to the home screen on iOS). */
export function isInstalled(): boolean {
  return (
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/**
 * Puts the OCR files in the service worker's cache, skipping those already
 * there. Nothing happens offline or when the user asked to save data.
 * Returns how many files were downloaded.
 */
export async function cacheOcrFiles(): Promise<number> {
  if (typeof caches === "undefined" || !navigator.onLine) return 0;
  const connection = (navigator as { connection?: { saveData?: boolean } })
    .connection;
  if (connection?.saveData) return 0;
  const cache = await caches.open(OCR_CACHE);
  let added = 0;
  for (const url of await ocrFiles()) {
    if (await cache.match(url)) continue;
    await cache.add(url);
    added++;
  }
  return added;
}

/** After the app has settled, when the browser is idle. */
export function cacheOcrFilesLater(delay = 3000): () => void {
  let idle = 0;
  const timer = window.setTimeout(() => {
    const run = () => void cacheOcrFiles().catch(() => undefined);
    if ("requestIdleCallback" in window) idle = requestIdleCallback(run);
    else run();
  }, delay);
  return () => {
    clearTimeout(timer);
    if (idle && "cancelIdleCallback" in window) cancelIdleCallback(idle);
  };
}
