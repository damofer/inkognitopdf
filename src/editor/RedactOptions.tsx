import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import type { EditorState, RedactionItem } from "../model/document";
import type { Rect } from "../model/geometry";
import { newId, type Operation } from "../model/operations";
import type { PdfFile } from "../storage/pdfFile";

const same = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) < 0.5 &&
  Math.abs(a.y - b.y) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5;

/**
 * Options of the secure redaction tool (spec 012): search and mark, and the
 * single step that applies every marked area, after a clear warning.
 */
export function RedactOptions({
  file,
  state,
  dispatch,
}: {
  file: PdfFile | null;
  state: EditorState;
  dispatch: (ops: Operation | Operation[]) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pending = state.items.filter(
    (i): i is RedactionItem => i.kind === "redaction" && !i.applied,
  );

  const search = async () => {
    if (!query.trim() || busy) return;
    setBusy(true);
    setStatus(t("redact.searching"));
    try {
      const m = await import("./redactSearch");
      let matches;
      try {
        matches = await m.searchDocument(file, state, query, regex);
      } catch (cause) {
        if (cause instanceof m.BadPatternError) {
          setStatus(t("redact.badRegex"));
          return;
        }
        throw cause;
      }
      const marks = state.items.filter((i) => i.kind === "redaction");
      const fresh = matches.filter(
        (match) =>
          !marks.some(
            (r) => r.pageId === match.pageId && same(r.rect, match.rect),
          ),
      );
      if (fresh.length > 0)
        dispatch(
          fresh.map((match) => ({
            kind: "addItem" as const,
            item: {
              kind: "redaction" as const,
              id: newId("redaction"),
              pageId: match.pageId,
              rect: match.rect,
              applied: false,
            },
          })),
        );
      setStatus(
        matches.length > 0
          ? t("redact.found", matches.length)
          : t("redact.notFound"),
      );
    } finally {
      setBusy(false);
    }
  };

  const apply = (clearMetadata: boolean) => {
    dispatch(
      pending.map((item) => ({
        kind: "updateItem" as const,
        item: {
          ...item,
          applied: true,
          ...(clearMetadata ? { clearMetadata: true } : {}),
        },
      })),
    );
    setConfirming(false);
  };

  return (
    <span
      className="toolbar-group redact-options"
      role="group"
      aria-label={t("redact.label")}
    >
      <form
        className="redact-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          type="search"
          aria-label={t("redact.search")}
          placeholder={t("redact.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={regex}
            onChange={(e) => setRegex(e.currentTarget.checked)}
          />
          {t("redact.regex")}
        </label>
        <button type="submit" disabled={busy || !query.trim()}>
          {t("redact.markMatches")}
        </button>
      </form>
      {status && (
        <span className="redact-status" role="status">
          {status}
        </span>
      )}
      <button
        type="button"
        className="primary redact-apply"
        disabled={pending.length === 0}
        onClick={() => setConfirming(true)}
      >
        {t("redact.apply", pending.length)}
      </button>
      {confirming &&
        createPortal(
          <ConfirmRedaction
            count={pending.length}
            onConfirm={apply}
            onCancel={() => setConfirming(false)}
          />,
          document.body,
        )}
    </span>
  );
}

function ConfirmRedaction({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: (clearMetadata: boolean) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [clearMetadata, setClearMetadata] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  });
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog redact-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="redact-confirm-title"
        aria-describedby="redact-confirm-body"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="redact-confirm-title">{t("redact.confirmTitle")}</h2>
        <div id="redact-confirm-body">
          <p>{t("redact.confirmBody", count)}</p>
          <p className="dialog-warning">{t("redact.confirmWarning")}</p>
        </div>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={clearMetadata}
            onChange={(e) => setClearMetadata(e.currentTarget.checked)}
          />
          {t("redact.clearMetadata")}
        </label>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            {t("redact.cancel")}
          </button>
          <button
            type="button"
            className="danger"
            onClick={() => onConfirm(clearMetadata)}
          >
            {t("redact.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
