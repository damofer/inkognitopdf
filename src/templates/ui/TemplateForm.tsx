// The form of a template (spec 021, CA4): its fields and its repeatable lists.
import { useId } from "react";
import { useT, type Lang } from "../../i18n";
import { CURRENCIES, defaultCurrency } from "../format";
import type { FieldDef, ListDef, Row, Template, Values } from "../types";

interface FieldProps {
  def: FieldDef;
  lang: Lang;
  value: string;
  onChange: (value: string) => void;
}

const INPUT_TYPE: Partial<Record<FieldDef["kind"], string>> = {
  date: "date",
  email: "email",
  tel: "tel",
};

const INPUT_MODE: Partial<
  Record<FieldDef["kind"], "decimal" | "numeric" | "email" | "tel">
> = {
  money: "decimal",
  percent: "decimal",
  number: "decimal",
};

export function Field({ def, lang, value, onChange }: FieldProps) {
  const t = useT();
  const id = useId();
  const label = def.label[lang];
  let input;
  if (def.kind === "multiline")
    input = (
      <textarea
        id={id}
        rows={Math.min(8, Math.max(3, value.split("\n").length + 1))}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  else if (def.kind === "currency")
    input = (
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">
          {t("templates.currencyAuto", defaultCurrency())}
        </option>
        {CURRENCIES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    );
  else
    input = (
      <input
        id={id}
        type={INPUT_TYPE[def.kind] ?? "text"}
        inputMode={INPUT_MODE[def.kind]}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <div className={`tpl-field tpl-${def.kind}`}>
      <label htmlFor={id}>{label}</label>
      {input}
      {def.hint && <small>{def.hint[lang]}</small>}
    </div>
  );
}

interface ListProps {
  def: ListDef;
  lang: Lang;
  rows: Row[];
  onChange: (rows: Row[]) => void;
}

function ListEditor({ def, lang, rows, onChange }: ListProps) {
  const t = useT();
  const title = def.label[lang];
  const setCell = (index: number, key: string, value: string) =>
    onChange(
      rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  const move = (index: number, by: number) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row!);
    onChange(next);
  };
  const empty = (): Row =>
    Object.fromEntries(def.fields.map((f) => [f.key, ""]));
  return (
    <section className="tpl-list" data-list={def.key}>
      <h3>{title}</h3>
      {rows.map((row, index) => (
        <fieldset key={index} className="tpl-row">
          <legend>{t("templates.rowTitle", title, index + 1)}</legend>
          <div className="tpl-row-tools">
            <button
              type="button"
              disabled={index === 0}
              aria-label={`${t("templates.rowUp")}: ${t("templates.rowTitle", title, index + 1)}`}
              title={t("templates.rowUp")}
              onClick={() => move(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === rows.length - 1}
              aria-label={`${t("templates.rowDown")}: ${t("templates.rowTitle", title, index + 1)}`}
              title={t("templates.rowDown")}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`${t("templates.rowRemove")}: ${t("templates.rowTitle", title, index + 1)}`}
              title={t("templates.rowRemove")}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
          {def.fields.map((f) => (
            <Field
              key={f.key}
              def={f}
              lang={lang}
              value={row[f.key] ?? ""}
              onChange={(value) => setCell(index, f.key, value)}
            />
          ))}
        </fieldset>
      ))}
      <button
        type="button"
        className="tpl-add"
        onClick={() => onChange([...rows, empty()])}
      >
        + {def.addLabel[lang]}
      </button>
    </section>
  );
}

interface FormProps {
  template: Template;
  lang: Lang;
  values: Values;
  onField: (key: string, value: string) => void;
  onList: (key: string, rows: Row[]) => void;
}

export function TemplateForm({
  template,
  lang,
  values,
  onField,
  onList,
}: FormProps) {
  const t = useT();
  return (
    <>
      <section className="tpl-fields">
        <h3>{t("templates.fields")}</h3>
        {template.fields.map((def) => (
          <Field
            key={def.key}
            def={def}
            lang={lang}
            value={values.fields[def.key] ?? ""}
            onChange={(value) => onField(def.key, value)}
          />
        ))}
      </section>
      {template.lists?.map((def) => (
        <ListEditor
          key={def.key}
          def={def}
          lang={lang}
          rows={values.lists[def.key] ?? []}
          onChange={(rows) => onList(def.key, rows)}
        />
      ))}
    </>
  );
}
