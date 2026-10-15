// Spec 014: compress the document with one of three levels and see the size
// before and after.
import { useState } from "react";
import { locale, useT } from "../i18n";
import type { CompressLevel } from "../engine/compress";

export interface CompressOutcome {
  before: number;
  after: number;
}

interface CompressPanelProps {
  /** Size of the opened file, or null for a new document. */
  fileSize: number | null;
  busy: boolean;
  outcome: CompressOutcome | null;
  onRun: (level: CompressLevel) => void;
  onClose: () => void;
}

/** "1.2 MB", "340 KB": sizes as people read them. */
export function formatSize(bytes: number, lang = locale()): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString(lang, { maximumFractionDigits: digits })} ${units[unit]}`;
}

export function CompressPanel({
  fileSize,
  busy,
  outcome,
  onRun,
  onClose,
}: CompressPanelProps) {
  const t = useT();
  const [level, setLevel] = useState<CompressLevel>("balanced");
  const levels: [CompressLevel, string, string][] = [
    ["high", t("compress.high"), t("compress.highHelp")],
    ["balanced", t("compress.balanced"), t("compress.balancedHelp")],
    ["small", t("compress.small"), t("compress.smallHelp")],
  ];
  const size = (n: number) => formatSize(n);

  return (
    <section
      className="split-panel compress-panel"
      role="dialog"
      aria-labelledby="compress-title"
    >
      <header>
        <h2 id="compress-title">{t("compress.title")}</h2>
        <button
          type="button"
          aria-label={t("compress.close")}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <fieldset className="compress-levels">
        <legend>{t("compress.level")}</legend>
        {levels.map(([id, label, help]) => (
          <label key={id} className={level === id ? "checked" : undefined}>
            <input
              type="radio"
              name="compress-level"
              value={id}
              checked={level === id}
              onChange={() => setLevel(id)}
            />
            <span>
              <strong>{label}</strong>
              <small>{help}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {fileSize !== null && <p>{t("compress.current", size(fileSize))}</p>}
      <div className="split-preview" role="status">
        {outcome &&
          (outcome.after < outcome.before ? (
            <p className="compress-result">
              {t(
                "compress.result",
                size(outcome.before),
                size(outcome.after),
                Math.round((1 - outcome.after / outcome.before) * 100),
              )}
            </p>
          ) : (
            <p>{t("compress.noGain")}</p>
          ))}
      </div>
      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={() => onRun(level)}
      >
        {busy ? t("compress.working") : t("compress.run")}
      </button>
    </section>
  );
}
