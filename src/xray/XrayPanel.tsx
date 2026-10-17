// Spec 015: what the PDF hides, as a traffic light, and a clean copy of it.
import { useEffect, useRef, useState } from "react";
import { useT, type MessageKey } from "../i18n";
import type {
  PrivacyDetail,
  PrivacyFinding,
  PrivacyKind,
  PrivacyReport,
} from "../engine/privacy";
import { formatSize } from "../protect/CompressPanel";

interface XrayPanelProps {
  /** Analyzes the opened file. */
  scan: () => Promise<PrivacyReport>;
  /**
   * Cleans the open document (not saved yet) and returns its new report;
   * null when there is no file to clean (a document started from scratch).
   */
  clean: ((kinds: Set<PrivacyKind>) => Promise<PrivacyReport>) | null;
  /** Downloads the earlier version that ends at `end`. */
  downloadVersion: (end: number, n: number) => void;
  onClose: () => void;
}

/** The engine's lists, repeated so the panel does not load pdf-lib. */
const CLEANABLE = new Set<PrivacyKind>([
  "hiddenText",
  "attachments",
  "javascript",
  "metadata",
  "whiteText",
  "authors",
  "hiddenLayers",
  "thumbnails",
  "pieceInfo",
  "links",
  "ocrText",
]);
const OFF_BY_DEFAULT = new Set<PrivacyKind>(["links", "ocrText"]);

type State =
  | { step: "scanning" }
  | { step: "failed" }
  | { step: "report"; report: PrivacyReport; cleaned?: boolean }
  | { step: "cleaning"; report: PrivacyReport };

export function XrayPanel({
  scan,
  clean,
  downloadVersion,
  onClose,
}: XrayPanelProps) {
  const t = useT();
  const [state, setState] = useState<State>({ step: "scanning" });
  const [checked, setChecked] = useState<Set<PrivacyKind>>(new Set());

  // The opened document is analyzed once; after cleaning, the report shown is
  // the one of the clean document.
  const scanOnce = useRef(scan);
  useEffect(() => {
    let live = true;
    scanOnce.current().then(
      (report) => {
        if (!live) return;
        setState({ step: "report", report });
        setChecked(
          new Set(
            report.findings
              .map((f) => f.kind)
              .filter((k) => CLEANABLE.has(k) && !OFF_BY_DEFAULT.has(k)),
          ),
        );
      },
      () => live && setState({ step: "failed" }),
    );
    return () => {
      live = false;
    };
  }, []);

  const detailText = (kind: PrivacyKind, d: PrivacyDetail): string => {
    const page = d.page ? `${t("xray.page", d.page)}: ` : "";
    const quoted = d.text ? `«${d.text}»` : "";
    switch (kind) {
      case "versions":
        return d.key === "loose"
          ? t("xray.loose", d.size ?? 0)
          : t("xray.version", d.text ?? "", formatSize(d.size ?? 0));
      case "metadata":
        if (d.key === "XMP") return t("xray.meta.XMP", formatSize(d.size ?? 0));
        if (d.key === "XMPParts") return t("xray.meta.XMPParts", d.size ?? 0);
        return `${metaLabel(d.key ?? "")}: ${d.text ?? ""}`;
      case "hiddenText":
        return `${page}${t(`xray.text.${d.key}` as MessageKey)} ${quoted}`;
      case "whiteText":
      case "ocrText":
        return `${page}${quoted}`;
      case "attachments":
        return `${page}${d.text || t("xray.noName")}${
          d.size !== undefined ? ` (${formatSize(d.size)})` : ""
        }`;
      case "javascript": {
        const where = t(`xray.js.${d.key}` as MessageKey);
        return `${page}${where}${d.text ? `: ${d.text}` : ""}`;
      }
      case "links":
        return `${d.text} (${t("xray.times", d.size ?? 1)})`;
      case "authors":
        return `${d.text} (${t("xray.comments", d.size ?? 1)})`;
      case "thumbnails":
        return t("xray.page", d.page ?? 1);
      default:
        return d.text || t("xray.noName");
    }
  };

  const metaLabel = (key: string) => {
    const known = [
      "Title",
      "Author",
      "Subject",
      "Keywords",
      "Creator",
      "Producer",
      "CreationDate",
      "ModDate",
    ];
    return known.includes(key) ? t(`xray.meta.${key}` as MessageKey) : key;
  };

  const toggle = (kind: PrivacyKind) =>
    setChecked((set) => {
      const next = new Set(set);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const doClean = async (report: PrivacyReport) => {
    if (!clean) return;
    setState({ step: "cleaning", report });
    try {
      const cleanReport = await clean(checked);
      setState({ step: "report", report: cleanReport, cleaned: true });
      setChecked(new Set());
    } catch {
      setState({ step: "failed" });
    }
  };

  const finding = (f: PrivacyFinding, report: PrivacyReport, busy: boolean) => (
    <li
      key={f.kind}
      className={`xray-finding level-${f.level}`}
      data-kind={f.kind}
    >
      <div className="xray-head">
        <span className="xray-dot" aria-hidden="true" />
        <strong>{t(`xray.kind.${f.kind}` as MessageKey)}</strong>
        <span className="xray-level">
          {t(`xray.level.${f.level}` as MessageKey)}
        </span>
        {clean && CLEANABLE.has(f.kind) && (
          <label className="toolbar-check">
            <input
              type="checkbox"
              checked={checked.has(f.kind)}
              disabled={busy}
              onChange={() => toggle(f.kind)}
            />
            {t("xray.remove")}
          </label>
        )}
      </div>
      <p className="xray-about">
        {t(`xray.about.${f.kind}` as MessageKey)}
        {f.kind === "versions" && ` ${t("xray.alwaysRemoved")}`}
      </p>
      <ul className="xray-details">
        {f.details.slice(0, 12).map((d, i) => (
          <li key={i}>
            {detailText(f.kind, d)}
            {f.kind === "versions" && d.key === "version" && (
              <button
                type="button"
                onClick={() =>
                  downloadVersion(
                    report.previousVersions[Number(d.text) - 1]!,
                    Number(d.text),
                  )
                }
              >
                {t("xray.downloadVersion")}
              </button>
            )}
          </li>
        ))}
        {f.details.length > 12 && <li>…</li>}
      </ul>
    </li>
  );

  let body;
  if (state.step === "scanning")
    body = <p role="status">{t("xray.scanning")}</p>;
  else if (state.step === "failed")
    body = (
      <p role="status" className="split-error">
        {t("xray.failed")}
      </p>
    );
  else {
    const { report } = state;
    const busy = state.step === "cleaning";
    const serious = report.findings.filter((f) => f.level !== "info").length;
    const canClean = report.findings.some(
      (f) => CLEANABLE.has(f.kind) || f.kind === "versions",
    );
    body = (
      <>
        <p role="status" className="xray-summary">
          {state.step === "report" && state.cleaned && (
            <>
              {t("xray.cleaned")}
              <br />
            </>
          )}
          {report.findings.length === 0
            ? t("xray.nothing")
            : serious === 0
              ? t("xray.onlyInfo")
              : t("xray.summary", serious)}
        </p>
        {report.findings.length > 0 && (
          <ul className="xray-findings">
            {report.findings.map((f) => finding(f, report, busy))}
          </ul>
        )}
        <small className="protect-note">{t("xray.local")}</small>
        {!(state.step === "report" && state.cleaned) && clean && canClean && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void doClean(report)}
          >
            {busy ? t("xray.cleaning") : t("xray.clean")}
          </button>
        )}
      </>
    );
  }

  return (
    <section
      className="split-panel xray-panel"
      role="dialog"
      aria-labelledby="xray-title"
    >
      <header>
        <h2 id="xray-title">{t("xray.title")}</h2>
        <button type="button" aria-label={t("xray.close")} onClick={onClose}>
          ×
        </button>
      </header>
      {body}
    </section>
  );
}
