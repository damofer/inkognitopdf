/**
 * OCR panel (spec 003, HU2–HU6): which pages, language, progress, cancel and
 * export as plain text.
 */
import { useEffect, useRef, useState } from "react";
import { getLang, useT, type MessageKey } from "../i18n";
import type { Item, OcrItem, PageEntry } from "../model/document";
import { newId, type Operation } from "../model/operations";
import type { PDFDocumentProxy } from "../viewer/pdfjs";
import { OCR_LANGUAGES, OcrEngine } from "./ocrClient";
import { ocrText } from "./ocrText";
import { pageImage, recognizeImage, textRotation } from "./recognize";
import { isScannedPage } from "./scanned";

type Scope = "scanned" | "all" | "range";

interface OcrPanelProps {
  doc: PDFDocumentProxy | null;
  pages: PageEntry[];
  items: Item[];
  dispatch: (op: Operation) => void;
  onClose: () => void;
  fileName: string | null;
}

/** Page numbers (1-based) of a range such as "1-3, 5"; null if invalid. */
export function parseRange(text: string, count: number): number[] | null {
  const pages = new Set<number>();
  for (const part of text.split(",").map((p) => p.trim())) {
    if (!part) continue;
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > count || a > b) return null;
    for (let n = a; n <= b; n++) pages.add(n);
  }
  return pages.size > 0 ? [...pages].sort((x, y) => x - y) : null;
}

/** Whether a page is an image of text: scans, or scanned pages of the file. */
export async function pageIsScanned(
  doc: PDFDocumentProxy | null,
  entry: PageEntry,
): Promise<boolean> {
  if (entry.source.kind === "scan") return true;
  if (entry.source.kind !== "original" || !doc) return false;
  return isScannedPage(await doc.getPage(entry.source.index + 1));
}

/** Tesseract's progress steps and the message key that names them. */
const STATUS: Record<string, MessageKey> = {
  "loading tesseract core": "ocr.statusLoadingCore",
  "initializing tesseract": "ocr.statusInitializing",
  "loading language traineddata": "ocr.statusLoadingLang",
  "initializing api": "ocr.statusInitApi",
  "recognizing text": "ocr.statusRecognizing",
};

export function OcrPanel({
  doc,
  pages,
  items,
  dispatch,
  onClose,
  fileName,
}: OcrPanelProps) {
  const t = useT();
  const [scope, setScope] = useState<Scope>("scanned");
  const [range, setRange] = useState("1");
  const [withText, setWithText] = useState(false);
  // Recognition language: the interface language until the user picks one.
  const [lang, setLang] = useState<string>(() =>
    getLang() === "en" ? "eng" : "spa",
  );
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const engine = useRef<OcrEngine | null>(null);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      void engine.current?.cancel();
    },
    [],
  );

  const ocrItems = pages.map((p) =>
    items.find((i): i is OcrItem => i.kind === "ocr" && i.pageId === p.id),
  );
  const recognized = ocrItems.filter(Boolean).length;
  const rangePages = parseRange(range, pages.length);

  const run = async () => {
    const targets =
      scope === "range"
        ? (rangePages ?? []).map((n) => pages[n - 1]!)
        : pages.slice();
    cancelled.current = false;
    setRunning(true);
    setResult(null);
    const ocrEngine = (engine.current ??= new OcrEngine());
    let done = 0;
    let skipped = 0;
    try {
      for (const [i, entry] of targets.entries()) {
        if (cancelled.current) break;
        const label = t("ocr.pageOf", i + 1, targets.length);
        setProgress(t("ocr.checking", label));
        // Pages with real text are left alone unless asked (CA5).
        const scanned = await pageIsScanned(doc, entry);
        const redo = items.some(
          (it) => it.kind === "ocr" && it.pageId === entry.id,
        );
        if (
          entry.source.kind === "blank" ||
          (!scanned && !redo && (scope === "scanned" || !withText))
        ) {
          skipped++;
          continue;
        }
        ocrEngine.onProgress = (p) => {
          const step = STATUS[p.status];
          setProgress(
            t(
              "ocr.progress",
              label,
              step ? t(step) : p.status,
              Math.round(p.progress * 100),
            ),
          );
        };
        const worker = await ocrEngine.get(lang);
        if (cancelled.current) break;
        setProgress(t("ocr.preparing", label));
        const image = await pageImage(doc, entry);
        const lines = await recognizeImage(worker, image);
        if (cancelled.current) break;
        const previous = items.find(
          (it): it is OcrItem => it.kind === "ocr" && it.pageId === entry.id,
        );
        const item: OcrItem = {
          kind: "ocr",
          id: previous?.id ?? newId("ocr"),
          pageId: entry.id,
          lang,
          rotate: textRotation(image.geometry),
          lines,
        };
        dispatch(
          previous ? { kind: "updateItem", item } : { kind: "addItem", item },
        );
        done++;
      }
      setResult(
        cancelled.current ? t("ocr.cancelled") : t("ocr.done", done, skipped),
      );
    } catch (cause) {
      if (!cancelled.current)
        setResult(
          t(
            "ocr.error",
            cause instanceof Error ? cause.message : String(cause),
          ),
        );
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const cancel = () => {
    cancelled.current = true;
    const current = engine.current;
    engine.current = null;
    void current?.cancel();
  };

  const exportText = () => {
    const blob = new Blob([ocrText(ocrItems)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(fileName ?? t("ocr.defaultFileName")).replace(/\.pdf$/i, "")}.txt`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <section className="ocr-panel" role="dialog" aria-label={t("ocr.title")}>
      <header>
        <h2>{t("ocr.heading")}</h2>
        <button
          type="button"
          aria-label={t("ocr.close")}
          onClick={() => {
            cancel();
            onClose();
          }}
        >
          ×
        </button>
      </header>
      <fieldset disabled={running}>
        <legend>{t("ocr.pages")}</legend>
        <label>
          <input
            type="radio"
            name="ocr-scope"
            checked={scope === "scanned"}
            onChange={() => setScope("scanned")}
          />
          {t("ocr.scopeScanned")}
        </label>
        <label>
          <input
            type="radio"
            name="ocr-scope"
            checked={scope === "all"}
            onChange={() => setScope("all")}
          />
          {t("ocr.scopeAll")}
        </label>
        <label>
          <input
            type="radio"
            name="ocr-scope"
            checked={scope === "range"}
            onChange={() => setScope("range")}
          />
          {t("ocr.scopeRange")}
          <input
            type="text"
            aria-label={t("ocr.rangeLabel")}
            value={range}
            placeholder="1-3, 5"
            onFocus={() => setScope("range")}
            onChange={(e) => setRange(e.currentTarget.value)}
            aria-invalid={scope === "range" && !rangePages}
          />
        </label>
        {scope !== "scanned" && (
          <label>
            <input
              type="checkbox"
              checked={withText}
              onChange={(e) => setWithText(e.currentTarget.checked)}
            />
            {t("ocr.includeText")}
          </label>
        )}
      </fieldset>
      <label className="ocr-lang">
        {t("ocr.language")}
        <select
          value={lang}
          disabled={running}
          onChange={(e) => setLang(e.currentTarget.value)}
        >
          {OCR_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {t(l.label)}
            </option>
          ))}
        </select>
      </label>
      <div className="ocr-actions">
        {running ? (
          <button type="button" onClick={cancel}>
            {t("ocr.cancel")}
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={scope === "range" && !rangePages}
            onClick={() => void run()}
          >
            {t("ocr.recognize")}
          </button>
        )}
        <button
          type="button"
          disabled={running || recognized === 0}
          onClick={exportText}
        >
          {t("ocr.exportTxt")}
        </button>
      </div>
      <p className="ocr-status" role="status" data-testid="ocr-status">
        {progress ?? result ?? ""}
      </p>
      <p className="ocr-note">{t("ocr.note")}</p>
    </section>
  );
}
