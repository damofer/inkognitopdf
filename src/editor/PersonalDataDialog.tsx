// Spec 016: the personal data found in the document, to choose which to mark
// for secure redaction (spec 012).
import { useEffect, useRef, useState } from "react";
import { useT, type MessageKey } from "../i18n";
import { PII_KINDS } from "../model/pii";
import type { EditorState } from "../model/document";
import type { Rect } from "../model/geometry";
import type { PdfFile } from "../storage/pdfFile";
import type { PersonalHit } from "./redactSearch";

interface PersonalDataDialogProps {
  file: PdfFile | null;
  state: EditorState;
  /** Whether a mark already covers `rect` on the page. */
  isMarked: (pageId: string, rect: Rect) => boolean;
  onMark: (hits: PersonalHit[]) => void;
  onCancel: () => void;
}

export function PersonalDataDialog({
  file,
  state,
  isMarked,
  onMark,
  onCancel,
}: PersonalDataDialogProps) {
  const t = useT();
  const [hits, setHits] = useState<PersonalHit[] | null>(null);
  const [checked, setChecked] = useState<Set<PersonalHit>>(new Set());
  const args = useRef({ file, state, isMarked });
  useEffect(() => {
    let live = true;
    void (async () => {
      const { file, state, isMarked } = args.current;
      const { searchPersonalData } = await import("./redactSearch");
      const found = await searchPersonalData(file, state);
      if (!live) return;
      const fresh = found.filter(
        (h) => !h.rects.every((r) => isMarked(h.pageId, r)),
      );
      setHits(found);
      setChecked(new Set(fresh));
    })();
    return () => {
      live = false;
    };
  }, []);

  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggle = (hit: PersonalHit) =>
    setChecked((set) => {
      const next = new Set(set);
      if (next.has(hit)) next.delete(hit);
      else next.add(hit);
      return next;
    });
  const marked = (h: PersonalHit) =>
    h.rects.every((r) => isMarked(h.pageId, r));
  const selectable = hits?.filter((h) => !marked(h)) ?? [];

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog pii-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pii-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="pii-title">{t("pii.title")}</h2>
        <p role="status">
          {!hits
            ? t("pii.searching")
            : hits.length === 0
              ? t("pii.none")
              : t("pii.found", hits.length)}
        </p>
        {hits && hits.length > 0 && (
          <>
            <div className="pii-tools">
              <button
                type="button"
                onClick={() => setChecked(new Set(selectable))}
              >
                {t("pii.all")}
              </button>
              <button type="button" onClick={() => setChecked(new Set())}>
                {t("pii.none2")}
              </button>
            </div>
            <div className="pii-list">
              {PII_KINDS.map((kind) => {
                const group = hits.filter((h) => h.kind === kind);
                if (group.length === 0) return null;
                return (
                  <fieldset key={kind} data-kind={kind}>
                    <legend>
                      {t(`pii.kind.${kind}` as MessageKey)} · {group.length}
                    </legend>
                    {group.map((hit, i) => (
                      <label key={i} className="toolbar-check">
                        <input
                          type="checkbox"
                          disabled={marked(hit)}
                          checked={marked(hit) || checked.has(hit)}
                          onChange={() => toggle(hit)}
                        />
                        <span className="pii-value">{hit.value}</span>
                        <small>
                          {t("pii.page", hit.page)}
                          {marked(hit) && ` · ${t("pii.marked")}`}
                        </small>
                      </label>
                    ))}
                  </fieldset>
                );
              })}
            </div>
            <small className="pii-note">{t("pii.note")}</small>
          </>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            {t("pii.cancel")}
          </button>
          <button
            type="button"
            className="primary"
            disabled={checked.size === 0}
            onClick={() => onMark([...checked])}
          >
            {t("pii.mark", checked.size)}
          </button>
        </div>
      </div>
    </div>
  );
}
