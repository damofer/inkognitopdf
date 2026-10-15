/**
 * Tesseract.js, loaded on first use, with every file served by the app itself
 * (spec 003, CA9): worker, WebAssembly core and language data.
 */
import type { Worker } from "tesseract.js";

/** Recognition languages: Tesseract codes and the message key of their name. */
export const OCR_LANGUAGES = [
  { code: "spa", label: "ocr.langSpa" },
  { code: "eng", label: "ocr.langEng" },
  { code: "spa+eng", label: "ocr.langSpaEng" },
] as const;

export interface OcrProgress {
  status: string;
  /** 0–1 within the current step. */
  progress: number;
}

export class OcrEngine {
  private worker: Promise<Worker> | null = null;
  private lang = "";
  onProgress: ((p: OcrProgress) => void) | null = null;

  /** The Tesseract worker for `lang`, created or switched as needed. */
  async get(lang: string): Promise<Worker> {
    if (this.worker && this.lang === lang) return this.worker;
    if (this.worker) {
      const current = await this.worker;
      await current.reinitialize(lang);
      this.lang = lang;
      return current;
    }
    this.lang = lang;
    const base = `${import.meta.env.BASE_URL}tesseract/`;
    const created = import("tesseract.js").then(
      async ({ createWorker, OEM, PSM }) => {
        const worker = await createWorker(lang, OEM.LSTM_ONLY, {
          workerPath: `${base}worker.min.js`,
          corePath: base,
          langPath: base,
          gzip: true,
          workerBlobURL: false,
          // The service worker caches the files; no second copy in IndexedDB.
          cacheMethod: "none",
          logger: (m: { status: string; progress: number }) =>
            this.onProgress?.({ status: m.status, progress: m.progress }),
        });
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
        return worker;
      },
    );
    this.worker = created;
    created.catch(() => {
      if (this.worker === created) this.worker = null;
    });
    return created;
  }

  /** Stops any work at once; the next `get` starts a new worker. */
  async cancel(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.lang = "";
    if (worker) await (await worker).terminate();
  }
}
