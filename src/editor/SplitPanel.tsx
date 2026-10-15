// Spec 013: split the document by ranges or every N pages, or extract the
// chosen pages. The panel shows the files it will download before it does.
import { useState } from "react";
import { useT } from "../i18n";
import { describeGroup, everyN, parseRanges } from "../engine/pageRanges";

export type SplitMode = "ranges" | "every" | "selection";

interface SplitPanelProps {
  pageCount: number;
  /** File name without ".pdf", for the names of the parts. */
  baseName: string;
  busy: boolean;
  onSplit: (groups: number[][], mode: SplitMode) => void;
  onClose: () => void;
}

const SHOWN = 6;

export function SplitPanel({
  pageCount,
  baseName,
  busy,
  onSplit,
  onClose,
}: SplitPanelProps) {
  const t = useT();
  const [mode, setMode] = useState<SplitMode>("ranges");
  const [ranges, setRanges] = useState("");
  const [every, setEvery] = useState("1");
  const [picked, setPicked] = useState<Set<number>>(() => new Set());

  let groups: number[][] = [];
  let error: string | null = null;
  try {
    if (mode === "ranges") {
      if (ranges.trim()) groups = parseRanges(ranges, pageCount);
    } else if (mode === "every") groups = everyN(pageCount, Number(every));
    else {
      const pages = [...picked].filter((i) => i < pageCount);
      if (pages.length) groups = [pages.sort((a, b) => a - b)];
      else error = t("organize.pickNone");
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const names = groups.map(
    (g) => `${baseName} (${t("organize.pagesSuffix", describeGroup(g))}).pdf`,
  );

  const toggle = (index: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  const modes: [SplitMode, string][] = [
    ["ranges", t("organize.byRanges")],
    ["every", t("organize.byEvery")],
    ["selection", t("organize.bySelection")],
  ];

  return (
    <section
      className="split-panel"
      role="dialog"
      aria-labelledby="split-title"
    >
      <header>
        <h2 id="split-title">{t("organize.splitTitle")}</h2>
        <button
          type="button"
          aria-label={t("organize.close")}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div
        className="split-modes"
        role="radiogroup"
        aria-label={t("organize.mode")}
      >
        {modes.map(([id, label]) => (
          <label key={id} className={mode === id ? "checked" : undefined}>
            <input
              type="radio"
              name="split-mode"
              value={id}
              checked={mode === id}
              onChange={() => setMode(id)}
            />
            {label}
          </label>
        ))}
      </div>
      {mode === "ranges" && (
        <label className="split-field">
          <span>{t("organize.ranges")}</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="1-3, 5, 8-"
            value={ranges}
            aria-invalid={error ? true : undefined}
            aria-describedby="split-ranges-help"
            onChange={(e) => setRanges(e.target.value)}
          />
          <small id="split-ranges-help">{t("organize.rangesHelp")}</small>
        </label>
      )}
      {mode === "every" && (
        <label className="split-field">
          <span>{t("organize.every")}</span>
          <input
            type="number"
            min={1}
            max={pageCount}
            value={every}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setEvery(e.target.value)}
          />
        </label>
      )}
      {mode === "selection" && (
        <fieldset className="split-pick">
          <legend>{t("organize.pick")}</legend>
          <div className="split-pick-actions">
            <button
              type="button"
              onClick={() =>
                setPicked(
                  new Set(Array.from({ length: pageCount }, (_, i) => i)),
                )
              }
            >
              {t("organize.all")}
            </button>
            <button type="button" onClick={() => setPicked(new Set())}>
              {t("organize.none")}
            </button>
          </div>
          <div className="split-pages">
            {Array.from({ length: pageCount }, (_, i) => (
              <button
                key={i}
                type="button"
                aria-pressed={picked.has(i)}
                aria-label={t("organize.page", i + 1)}
                onClick={() => toggle(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="split-preview" role="status">
        {error ? (
          <p className="split-error">{error}</p>
        ) : names.length > 0 ? (
          <>
            <p>{t("organize.preview", names.length)}</p>
            <ul>
              {names.slice(0, SHOWN).map((name, i) => (
                <li key={i}>{name}</li>
              ))}
              {names.length > SHOWN && (
                <li>{t("organize.more", names.length - SHOWN)}</li>
              )}
            </ul>
          </>
        ) : null}
      </div>
      <button
        type="button"
        className="primary"
        disabled={busy || groups.length === 0}
        onClick={() => onSplit(groups, mode)}
      >
        {busy
          ? t("organize.working")
          : t("organize.download", groups.length || 1)}
      </button>
    </section>
  );
}
