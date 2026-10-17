// Spec 022: page numbers, headers and footers. The panel edits a draft that
// the pages show at once (CA7); "Apply" makes it one undoable step.
import { useState } from "react";
import { useT, type MessageKey } from "../i18n";
import type { FontFamily } from "../model/document";
import {
  MM,
  NUMBERING_SLOTS,
  numberedPages,
  usedSlots,
  type Numbering,
  type NumberingSlot,
} from "../model/numbering";

interface NumberingPanelProps {
  draft: Numbering;
  /** The numbering already applied to the document, if any. */
  applied: boolean;
  pageCount: number;
  onChange: (draft: Numbering) => void;
  onApply: () => void;
  onRemove: () => void;
  onClose: () => void;
}

const FONTS: FontFamily[] = ["Helvetica", "Times", "Courier"];

const SLOT_LABEL: Record<NumberingSlot, MessageKey> = {
  tl: "numbering.slot.tl",
  tc: "numbering.slot.tc",
  tr: "numbering.slot.tr",
  bl: "numbering.slot.bl",
  bc: "numbering.slot.bc",
  br: "numbering.slot.br",
};

/**
 * Quick formats (CA3): the label of the button and the text it writes; null
 * for "Page 1 of N", which is written in the interface language.
 */
const FORMATS: { label: string; text: string | null }[] = [
  { label: "1", text: "{n}" },
  { label: "", text: null },
  { label: "1 / N", text: "{n} / {total}" },
  { label: "- 1 -", text: "- {n} -" },
  { label: "Bates", text: "{bates}" },
];

/** A number field that may be left empty while typing. */
function NumberField({
  label,
  value,
  min,
  max,
  step,
  placeholder,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max?: number;
  step?: number;
  placeholder?: string;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="split-field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          onChange(Number.isFinite(n) ? n : null);
        }}
      />
    </label>
  );
}

export function NumberingPanel({
  draft,
  applied,
  pageCount,
  onChange,
  onApply,
  onRemove,
  onClose,
}: NumberingPanelProps) {
  const t = useT();
  const [slot, setSlot] = useState<NumberingSlot>(
    () => usedSlots(draft)[0] ?? "bc",
  );
  const set = (patch: Partial<Numbering>) => onChange({ ...draft, ...patch });
  const setText = (text: string) =>
    set({ texts: { ...draft.texts, [slot]: text } });
  const slotName = (s: NumberingSlot) => t(SLOT_LABEL[s]);

  const used = usedSlots(draft);
  const { numbers, total } = numberedPages(draft, pageCount);
  const first = [...numbers.keys()][0];
  const usesBates = used.some((s) => draft.texts[s]!.includes("{bates}"));
  const problem =
    used.length === 0
      ? t("numbering.noText")
      : numbers.size === 0
        ? t("numbering.noPages")
        : null;

  return (
    <section
      className="split-panel numbering-panel"
      role="dialog"
      aria-labelledby="numbering-title"
    >
      <header>
        <h2 id="numbering-title">{t("numbering.title")}</h2>
        <button
          type="button"
          aria-label={t("numbering.close")}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <fieldset className="numbering-slots">
        <legend>{t("numbering.position")}</legend>
        {NUMBERING_SLOTS.map((s) => (
          <button
            key={s}
            type="button"
            data-slot={s}
            aria-pressed={slot === s}
            aria-label={slotName(s)}
            title={slotName(s)}
            className={used.includes(s) ? "used" : undefined}
            onClick={() => setSlot(s)}
          />
        ))}
      </fieldset>
      <div
        className="split-modes numbering-formats"
        role="group"
        aria-label={t("numbering.formats")}
      >
        {FORMATS.map((f, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setText(f.text ?? t("numbering.pageOfText"))}
          >
            {f.label || t("numbering.pageOfLabel")}
          </button>
        ))}
        <button type="button" onClick={() => setText("")}>
          {t("numbering.clearSlot")}
        </button>
      </div>
      <label className="split-field">
        <span>{t("numbering.text", slotName(slot).toLowerCase())}</span>
        <input
          type="text"
          value={draft.texts[slot] ?? ""}
          aria-describedby="numbering-fields"
          onChange={(e) => setText(e.target.value)}
        />
        <small id="numbering-fields">{t("numbering.fields")}</small>
      </label>
      {usesBates && (
        <div className="numbering-row">
          <label className="split-field">
            <span>{t("numbering.batesPrefix")}</span>
            <input
              type="text"
              value={draft.bates.prefix}
              onChange={(e) =>
                set({ bates: { ...draft.bates, prefix: e.target.value } })
              }
            />
          </label>
          <NumberField
            label={t("numbering.batesDigits")}
            value={draft.bates.digits}
            min={1}
            max={12}
            onChange={(digits) =>
              set({
                bates: {
                  ...draft.bates,
                  digits: Math.min(12, Math.max(1, digits ?? 1)),
                },
              })
            }
          />
        </div>
      )}
      <fieldset className="numbering-group">
        <legend>{t("numbering.pages")}</legend>
        <div className="numbering-row">
          <NumberField
            label={t("numbering.from")}
            value={draft.from}
            min={1}
            max={pageCount}
            onChange={(from) => set({ from: Math.max(1, from ?? 1) })}
          />
          <NumberField
            label={t("numbering.to")}
            value={draft.to}
            min={1}
            max={pageCount}
            placeholder={String(pageCount)}
            onChange={(to) =>
              set({ to: to === null || to >= pageCount ? null : to })
            }
          />
          <NumberField
            label={t("numbering.startAt")}
            value={draft.startAt}
            min={0}
            onChange={(startAt) =>
              set({ startAt: Math.max(0, Math.floor(startAt ?? 1)) })
            }
          />
        </div>
      </fieldset>
      <fieldset className="numbering-group">
        <legend>{t("numbering.style")}</legend>
        <div className="numbering-row">
          <label className="split-field">
            <span>{t("numbering.font")}</span>
            <select
              value={draft.font}
              onChange={(e) => set({ font: e.target.value as FontFamily })}
            >
              {FONTS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label={t("numbering.size")}
            value={draft.size}
            min={4}
            max={72}
            onChange={(size) =>
              set({ size: Math.min(72, Math.max(4, size ?? 10)) })
            }
          />
          <label className="split-field">
            <span>{t("numbering.color")}</span>
            <input
              type="color"
              value={draft.color}
              onChange={(e) => set({ color: e.target.value })}
            />
          </label>
          <NumberField
            label={t("numbering.margin")}
            value={Math.round((draft.margin / MM) * 10) / 10}
            min={0}
            max={100}
            step={0.5}
            onChange={(mm) =>
              set({ margin: Math.min(100, Math.max(0, mm ?? 0)) * MM })
            }
          />
        </div>
      </fieldset>
      <div className="split-preview" role="status">
        {problem ? (
          <p className="split-error">{problem}</p>
        ) : (
          <p>
            {t(
              "numbering.summary",
              first! + 1,
              first! + numbers.size,
              draft.startAt,
              total,
            )}
          </p>
        )}
      </div>
      <div className="numbering-actions">
        {applied && (
          <button type="button" onClick={onRemove}>
            {t("numbering.remove")}
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={problem !== null}
          onClick={onApply}
        >
          {t("numbering.apply")}
        </button>
      </div>
    </section>
  );
}
