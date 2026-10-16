import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import type { EditorState, Needles, RedactionItem } from "../model/document";
import type { ElsewhereCounts, ElsewhereKind } from "../engine/redactElsewhere";
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
              query: { text: query, regex },
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

  const apply = (clearMetadata: boolean, elsewhere: Needles | null) => {
    dispatch(
      pending.map((item) => ({
        kind: "updateItem" as const,
        item: {
          ...item,
          applied: true,
          ...(clearMetadata ? { clearMetadata: true } : {}),
          ...(elsewhere ? { elsewhere } : {}),
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
            file={file}
            state={state}
            pending={pending}
            onConfirm={apply}
            onCancel={() => setConfirming(false)}
          />,
          document.body,
        )}
    </span>
  );
}

const PLACE = {
  annotations: "redact.elsewhereAnnotations",
  bookmarks: "redact.elsewhereBookmarks",
  attachments: "redact.elsewhereAttachments",
  fields: "redact.elsewhereFields",
  metadata: "redact.elsewhereMetadata",
} as const satisfies Record<ElsewhereKind, string>;
const KINDS = Object.keys(PLACE) as ElsewhereKind[];

/**
 * Where else in the file the data of the areas is (spec 012, CA13): the text
 * under them and the searches that marked them, in notes, bookmarks,
 * attachments, field values and metadata. Null while looking.
 */
function useElsewhere(
  file: PdfFile | null,
  state: EditorState,
  pending: RedactionItem[],
) {
  const [found, setFound] = useState<{
    needles: Needles;
    counts: ElsewhereCounts | null;
  } | null>(null);
  const args = useRef({ file, state, pending });
  useEffect(() => {
    let live = true;
    void (async () => {
      const { file, state, pending } = args.current;
      const { needlesOf } = await import("./redactSearch");
      const needles = await needlesOf(file, state, pending);
      let counts: ElsewhereCounts | null = null;
      if (needles.texts.length + needles.patterns.length > 0)
        try {
          const { buildPdf } = await import("./save");
          const ids = new Set(pending.map((p) => p.id));
          const preview = {
            ...state,
            items: state.items.map((i) =>
              ids.has(i.id) ? { ...i, applied: true } : i,
            ),
          };
          ({ elsewhere: counts = null } = await buildPdf(file, preview, {
            findElsewhere: needles,
          }));
        } catch {
          // Saving looks again and removes what it finds.
          counts = null;
        }
      if (live) setFound({ needles, counts });
    })();
    return () => {
      live = false;
    };
  }, []);
  return found;
}

function ConfirmRedaction({
  file,
  state,
  pending,
  onConfirm,
  onCancel,
}: {
  file: PdfFile | null;
  state: EditorState;
  pending: RedactionItem[];
  onConfirm: (clearMetadata: boolean, elsewhere: Needles | null) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const count = pending.length;
  const [clearMetadata, setClearMetadata] = useState(true);
  const [removeElsewhere, setRemoveElsewhere] = useState(true);
  const found = useElsewhere(file, state, pending);
  // With the metadata box checked all of it goes: not listed apart.
  const places = KINDS.filter(
    (k) =>
      (found?.counts?.[k] ?? 0) > 0 && !(k === "metadata" && clearMetadata),
  );
  const needles =
    found && found.needles.texts.length + found.needles.patterns.length > 0
      ? found.needles
      : null;
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
        <div className="redact-elsewhere" aria-live="polite">
          {!found ? (
            <p>{t("redact.elsewhereSearching")}</p>
          ) : places.length > 0 ? (
            <>
              <p>{t("redact.elsewhereTitle")}</p>
              <ul>
                {places.map((k) => (
                  <li key={k} data-kind={k}>
                    {t(PLACE[k], found.counts![k])}
                  </li>
                ))}
              </ul>
              <label className="toolbar-check">
                <input
                  type="checkbox"
                  checked={removeElsewhere}
                  onChange={(e) => setRemoveElsewhere(e.currentTarget.checked)}
                />
                {t("redact.elsewhereRemove")}
              </label>
              <p className="redact-elsewhere-note">
                {t("redact.elsewhereRemoveNote")}
              </p>
              {!removeElsewhere && (
                <p className="dialog-warning" role="alert">
                  {t("redact.elsewhereKept")}
                </p>
              )}
            </>
          ) : found.counts ? (
            <p>{t("redact.elsewhereNone")}</p>
          ) : null}
        </div>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" onClick={onCancel}>
            {t("redact.cancel")}
          </button>
          <button
            type="button"
            className="danger"
            disabled={!found}
            onClick={() =>
              onConfirm(clearMetadata, removeElsewhere ? needles : null)
            }
          >
            {t("redact.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
