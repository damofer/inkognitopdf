import { useRef, useState, type CSSProperties } from "react";
import type { DaStyle, FieldKind, FieldOption } from "../engine/formRead";
import type { PageGeometry, Rect } from "../model/geometry";
import { CSS_FONT } from "./itemOps";

/** A form widget on a page, with the current value of its field (spec 005). */
export interface PageWidget {
  key: string;
  /** Fully qualified field name. */
  name: string;
  kind: FieldKind;
  rect: Rect;
  /** "On" state of a check box or radio button widget. */
  onState?: string;
  value: string | string[];
  options: FieldOption[];
  readOnly: boolean;
  maxLength?: number;
  multiSelect: boolean;
  align: 0 | 1 | 2;
  style: DaStyle;
}

interface FormLayerProps {
  widgets: PageWidget[];
  geometry: PageGeometry;
  onValue: (name: string, value: string | string[]) => void;
}

/**
 * Controls over the form widgets, for filling them (spec 005, D1). Without
 * focus their text is transparent: the page shows the field as the engine
 * will save it. With focus they show the text in the field's family, size and
 * color.
 */
export function FormLayer({ widgets, geometry, onValue }: FormLayerProps) {
  return (
    <div className="form-layer">
      {widgets.map((w) => (
        <WidgetControl
          key={w.key}
          widget={w}
          geometry={geometry}
          onValue={onValue}
        />
      ))}
    </div>
  );
}

function WidgetControl({
  widget: w,
  geometry,
  onValue,
}: {
  widget: PageWidget;
  geometry: PageGeometry;
  onValue: FormLayerProps["onValue"];
}) {
  const v = geometry.rectToView(w.rect);
  const box: CSSProperties = {
    left: v.x,
    top: v.y,
    width: v.width,
    height: v.height,
  };
  const size =
    w.style.size > 0
      ? w.style.size * geometry.scale
      : Math.min(v.height * 0.7, 14 * geometry.scale);
  const text: CSSProperties = {
    ...box,
    fontFamily: CSS_FONT[w.style.font],
    fontWeight: w.style.bold ? "bold" : "normal",
    fontStyle: w.style.italic ? "italic" : "normal",
    fontSize: `${size}px`,
    "--field-color": w.style.color,
    textAlign: (["left", "center", "right"] as const)[w.align],
  } as CSSProperties;
  const common = {
    "aria-label": w.name,
    title: w.name,
    disabled: w.readOnly,
    "data-field": w.name,
    onPointerDown: (e: { stopPropagation(): void }) => e.stopPropagation(),
  };
  const one = Array.isArray(w.value) ? (w.value[0] ?? "") : w.value;

  switch (w.kind) {
    case "text":
    case "multiline":
      return (
        <TextControl
          widget={w}
          style={text}
          common={common}
          value={one}
          onValue={onValue}
        />
      );
    case "checkbox":
    case "radio": {
      const on = !!w.onState && one === w.onState;
      return (
        <button
          type="button"
          role={w.kind}
          aria-checked={on}
          className="form-control form-button"
          style={box}
          {...common}
          onClick={() =>
            onValue(
              w.name,
              w.kind === "checkbox" && on ? "Off" : (w.onState ?? "Off"),
            )
          }
        />
      );
    }
    case "dropdown":
      return (
        <select
          className="form-control form-choice"
          style={text}
          {...common}
          value={one}
          onChange={(e) => onValue(w.name, e.currentTarget.value)}
        >
          {!w.options.some((o) => o.value === one) && (
            <option value={one}>{one}</option>
          )}
          {w.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "list": {
      const values = Array.isArray(w.value)
        ? w.value
        : w.value
          ? [w.value]
          : [];
      return (
        <select
          className="form-control form-list"
          style={text}
          {...common}
          multiple={w.multiSelect}
          size={Math.max(2, w.options.length)}
          value={w.multiSelect ? values : (values[0] ?? "")}
          onChange={(e) =>
            onValue(
              w.name,
              [...e.currentTarget.selectedOptions].map((o) => o.value),
            )
          }
        >
          {w.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    default:
      return null;
  }
}

/** Text field: typed text is committed when the control loses focus. */
function TextControl({
  widget: w,
  style,
  common,
  value,
  onValue,
}: {
  widget: PageWidget;
  style: CSSProperties;
  common: Record<string, unknown>;
  value: string;
  onValue: FormLayerProps["onValue"];
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const props = {
    ...common,
    className: "form-control form-text",
    style,
    maxLength: w.maxLength,
    spellCheck: false,
    value: draft ?? value,
    onFocus: () => setDraft(value),
    onChange: (e: { currentTarget: { value: string } }) =>
      setDraft(e.currentTarget.value),
    onBlur: () => {
      if (!cancelled.current && draft !== null && draft !== value)
        onValue(w.name, draft);
      cancelled.current = false;
      setDraft(null);
    },
  };
  return w.kind === "multiline" ? (
    <textarea {...props} />
  ) : (
    <input
      type="text"
      {...props}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
