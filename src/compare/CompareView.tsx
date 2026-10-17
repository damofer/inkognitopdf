// Spec 018: two versions of a PDF side by side, with the text that changed
// and the pixels that differ, and a report.
import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "../analytics/analytics";
import { pagesBucket } from "../analytics/events";
import { useT } from "../i18n";
import {
  compareWords,
  diffPixels,
  type Change,
  type Word,
} from "../model/compare";
import { loadDocumentBytes, type PDFDocumentProxy } from "../viewer/pdfjs";
import { documentWords, renderPage, type PageSize } from "./pages";

export interface CompareInput {
  name: string;
  bytes: Uint8Array;
}

interface Side {
  name: string;
  doc: PDFDocumentProxy;
  words: Word[];
  sizes: PageSize[];
}

/** Render scale: sharp enough on a wide screen, scaled down by CSS. */
const SCALE = 1.5;
/** Changes listed on screen; the report has all of them. */
const LISTED = 300;

const joined = (words: Word[]) => words.map((w) => w.text).join(" ");
const short = (text: string) =>
  text.length > 80 ? `${text.slice(0, 77)}…` : text;
const percent = (share: number) =>
  (share * 100).toLocaleString(undefined, { maximumFractionDigits: 1 });

export function CompareView({
  before: beforeInput,
  after: afterInput,
  onDownload,
  onClose,
}: {
  before: CompareInput;
  after: CompareInput;
  /** Saves the report. */
  onDownload: (bytes: Uint8Array, name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [sides, setSides] = useState<[Side, Side] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [at, setAt] = useState(0);
  const [showVisual, setShowVisual] = useState(true);
  const [visual, setVisual] = useState(new Map<number, number | "size">());
  const [reporting, setReporting] = useState(false);

  useEffect(() => {
    let live = true;
    const docs: PDFDocumentProxy[] = [];
    void (async () => {
      try {
        const load = async (input: CompareInput): Promise<Side> => {
          const doc = await loadDocumentBytes(input.bytes.slice());
          docs.push(doc);
          return { name: input.name, doc, ...(await documentWords(doc)) };
        };
        const loaded: [Side, Side] = [
          await load(beforeInput),
          await load(afterInput),
        ];
        if (!live) return;
        setSides(loaded);
        track("compare_pdf", {
          pages: pagesBucket(loaded[1].doc.numPages),
        });
      } catch (cause) {
        if (live)
          setFailed(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      live = false;
      for (const doc of docs) void doc.loadingTask.destroy();
    };
  }, [beforeInput, afterInput]);

  const ordered = useMemo<[Side, Side] | null>(
    () => (sides ? (swapped ? [sides[1], sides[0]] : sides) : null),
    [sides, swapped],
  );
  const result = useMemo(
    () =>
      ordered
        ? compareWords(
            ordered[0].words,
            ordered[1].words,
            ordered[1].doc.numPages,
          )
        : null,
    [ordered],
  );
  /** The page of the later version where each change shows. */
  const changePages = useMemo(() => {
    if (!result) return [];
    return result.changes.map((change) => {
      const word = change.added[0];
      if (word) return word.page;
      const page = change.removed[0]!.page;
      const later = result.pairs.findIndex((p) => p >= page);
      return later === -1 ? result.pairs.length - 1 : later;
    });
  }, [result]);

  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navRef = useRef<HTMLDivElement>(null);
  /** Shows the pages of a change from the list. */
  const goTo = (page: number) => {
    setAt(page);
    navRef.current?.scrollIntoView({ block: "start" });
  };
  const beforeBox = useRef<HTMLDivElement>(null);
  const afterBox = useRef<HTMLDivElement>(null);
  const maskBox = useRef<HTMLDivElement>(null);
  const pair = result?.pairs[at] ?? -1;
  const beforePage =
    ordered && pair >= 0 && pair < ordered[0].doc.numPages ? pair : -1;

  // The two pages of `at`, and their visual difference.
  useEffect(() => {
    if (!ordered) return;
    let live = true;
    void (async () => {
      const after = await renderPage(ordered[1].doc, at, SCALE);
      const before =
        beforePage >= 0
          ? await renderPage(ordered[0].doc, beforePage, SCALE)
          : null;
      if (!live) return;
      afterBox.current?.replaceChildren(after.canvas);
      beforeBox.current?.replaceChildren(...(before ? [before.canvas] : []));
      maskBox.current?.replaceChildren();
      if (!before) return;
      const sameSize =
        before.pixels.width === after.pixels.width &&
        before.pixels.height === after.pixels.height;
      if (!sameSize) {
        setVisual((v) => new Map(v).set(at, "size"));
        return;
      }
      const { mask, changed } = diffPixels(
        before.pixels.data,
        after.pixels.data,
      );
      setVisual((v) => new Map(v).set(at, changed / mask.length));
      if (changed === 0) return;
      const canvas = document.createElement("canvas");
      canvas.width = after.pixels.width;
      canvas.height = after.pixels.height;
      const ctx = canvas.getContext("2d")!;
      const image = ctx.createImageData(canvas.width, canvas.height);
      for (let p = 0; p < mask.length; p++)
        if (mask[p]) {
          image.data[p * 4] = 230;
          image.data[p * 4 + 1] = 0;
          image.data[p * 4 + 2] = 120;
          image.data[p * 4 + 3] = 150;
        }
      ctx.putImageData(image, 0, 0);
      maskBox.current?.replaceChildren(canvas);
    })();
    return () => {
      live = false;
    };
  }, [ordered, at, beforePage]);

  const download = async () => {
    if (!ordered || !result) return;
    setReporting(true);
    try {
      // Every page's visual difference, for the report.
      const shares: { page: number; share: number }[] = [];
      for (let page = 0; page < ordered[1].doc.numPages; page++) {
        const other = result.pairs[page] ?? -1;
        if (other < 0 || other >= ordered[0].doc.numPages) continue;
        let share = visual.get(page);
        if (share === undefined) {
          const [a, b] = await Promise.all([
            renderPage(ordered[0].doc, other, 1),
            renderPage(ordered[1].doc, page, 1),
          ]);
          share =
            a.pixels.width === b.pixels.width &&
            a.pixels.height === b.pixels.height
              ? diffPixels(a.pixels.data, b.pixels.data).changed /
                (b.pixels.width * b.pixels.height)
              : "size";
        }
        if (share === "size" || share > 0)
          shares.push({ page, share: share === "size" ? 1 : share });
      }
      const { comparisonReport } = await import("./report");
      const bytes = await comparisonReport({
        before: ordered[0].name,
        after: ordered[1].name,
        date: new Date(),
        changes: result.changes,
        changePages,
        tooMany: result.tooMany,
        visual: shares,
      });
      const base = ordered[1].name.replace(/\.pdf$/i, "");
      onDownload(bytes, `${base} (${t("compare.reportSuffix")}).pdf`);
      track("compare_report");
    } finally {
      setReporting(false);
    }
  };

  const describe = (change: Change) => {
    const removed = short(joined(change.removed));
    const added = short(joined(change.added));
    return removed && added
      ? t("compare.replaced", removed, added)
      : added
        ? t("compare.addedText", added)
        : t("compare.removedText", removed);
  };

  let body;
  if (failed)
    body = (
      <p role="status" className="split-error">
        {t("compare.failed", failed)}
      </p>
    );
  else if (!ordered || !result)
    body = <p role="status">{t("compare.loading")}</p>;
  else {
    const [before, after] = ordered;
    const pages = after.doc.numPages;
    const gone = Array.from(
      { length: before.doc.numPages },
      (_, p) => p,
    ).filter((p) => !result.pairs.includes(p)).length;
    const changedPages = new Set(changePages).size;
    const removedHere = result.changes.flatMap((c) =>
      c.removed.filter((w) => w.page === beforePage),
    );
    const addedHere = result.changes.flatMap((c) =>
      c.added.filter((w) => w.page === at),
    );
    const share = visual.get(at);
    const box = (
      w: Word,
      size: PageSize,
      kind: "removed" | "added",
      i: number,
    ) => (
      <span
        key={i}
        className={`compare-mark ${kind}`}
        style={{
          left: `${(w.x / size.width) * 100}%`,
          top: `${(w.y / size.height) * 100}%`,
          width: `${(w.width / size.width) * 100}%`,
          height: `${(w.height / size.height) * 100}%`,
        }}
      />
    );
    body = (
      <>
        <p role="status" className="compare-summary">
          {result.tooMany
            ? t("compare.tooMany")
            : result.changes.length === 0
              ? t("compare.same")
              : t("compare.summary", result.changes.length, changedPages)}
          {gone > 0 && ` ${t("compare.pagesGone", gone)}`}
        </p>
        <div className="compare-nav" ref={navRef}>
          <button
            type="button"
            aria-label={t("compare.prev")}
            disabled={at === 0}
            onClick={() => setAt((p) => p - 1)}
          >
            ‹
          </button>
          <span>{t("compare.page", at + 1, pages)}</span>
          <button
            type="button"
            aria-label={t("compare.next")}
            disabled={at >= pages - 1}
            onClick={() => setAt((p) => p + 1)}
          >
            ›
          </button>
          <label className="toolbar-check">
            <input
              type="checkbox"
              checked={showVisual}
              onChange={(e) => setShowVisual(e.currentTarget.checked)}
            />
            {t("compare.visual")}
          </label>
        </div>
        <div className="compare-sides">
          <figure>
            <figcaption>
              {beforePage >= 0
                ? t("compare.side", t("compare.before"), beforePage + 1)
                : t("compare.before")}
            </figcaption>
            {beforePage >= 0 ? (
              <div className="compare-page" data-side="before">
                <div ref={beforeBox} />
                {removedHere.map((w, i) =>
                  box(w, before.sizes[beforePage]!, "removed", i),
                )}
              </div>
            ) : (
              <p className="compare-nopage">{t("compare.noPage")}</p>
            )}
          </figure>
          <figure>
            <figcaption>
              {t("compare.side", t("compare.after"), at + 1)}
              {beforePage >= 0 && share !== undefined && (
                <small>
                  {" · "}
                  {share === "size"
                    ? t("compare.visualSize")
                    : share === 0
                      ? t("compare.visualSame")
                      : t("compare.visualShare", percent(share))}
                </small>
              )}
            </figcaption>
            <div className="compare-page" data-side="after">
              <div ref={afterBox} />
              <div
                ref={maskBox}
                className="compare-mask"
                hidden={!showVisual}
              />
              {addedHere.map((w, i) => box(w, after.sizes[at]!, "added", i))}
            </div>
          </figure>
        </div>
        {result.changes.length > 0 && (
          <section className="compare-changes">
            <h3>{t("compare.changes")}</h3>
            <ol>
              {result.changes.slice(0, LISTED).map((change, i) => (
                <li key={i}>
                  <button
                    type="button"
                    aria-current={changePages[i] === at ? "page" : undefined}
                    onClick={() => goTo(changePages[i]!)}
                  >
                    <strong>
                      {t("compare.changePage", changePages[i]! + 1)}
                    </strong>{" "}
                    {describe(change)}
                  </button>
                </li>
              ))}
            </ol>
            {result.changes.length > LISTED && (
              <p>{t("compare.more", result.changes.length - LISTED)}</p>
            )}
          </section>
        )}
        <small className="protect-note">{t("compare.local")}</small>
      </>
    );
  }

  return (
    <section
      className="compare-view"
      role="dialog"
      aria-modal="true"
      aria-labelledby="compare-title"
    >
      <header>
        <h2 id="compare-title">{t("compare.title")}</h2>
        {ordered && (
          <p className="compare-files">
            <span className="compare-legend removed">
              {t("compare.before")}: <b>{ordered[0].name}</b>
            </span>
            <span className="compare-legend added">
              {t("compare.after")}: <b>{ordered[1].name}</b>
            </span>
          </p>
        )}
        <div className="compare-actions">
          <button
            type="button"
            title={t("compare.swapHint")}
            disabled={!ordered}
            onClick={() => {
              // Other pages, other renders.
              setSwapped((s) => !s);
              setAt(0);
              setVisual(new Map());
            }}
          >
            {t("compare.swap")}
          </button>
          <button
            type="button"
            className="primary"
            disabled={!result || reporting}
            onClick={() => void download()}
          >
            {t("compare.report")}
          </button>
          <button
            type="button"
            className="compare-close"
            aria-label={t("compare.close")}
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </header>
      <div className="compare-body">{body}</div>
    </section>
  );
}
