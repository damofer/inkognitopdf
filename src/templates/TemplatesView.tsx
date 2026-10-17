// Reusable templates (spec 021): the gallery, and the screen where a template
// is filled in with a live preview. Everything happens on the device.
import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "../analytics/analytics";
import { downloadPdf } from "../editor/save";
import { useLang, useT } from "../i18n";
import { useMobile } from "../useMobile";
import { useNearViewport } from "../viewer/useNearViewport";
import { CATEGORY_NAMES, TEMPLATES, templateById } from "./content";
import { effectiveValues, emptyDraft, generate, type Draft } from "./engine";
import {
  ACCENTS,
  CATEGORIES,
  FONT_PAIRS,
  type Category,
  type Photo,
  type Row,
  type Style,
  type Template,
} from "./types";
import { cachedFont, defaultStyle, renderPages, thumbnail } from "./ui/preview";
import { loadPhoto } from "./ui/photo";
import { TemplateForm } from "./ui/TemplateForm";

interface Props {
  onClose: () => void;
  /** Opens the generated PDF in the editor, as if the user opened a file. */
  onOpen: (file: File) => void;
}

/** Lowercase, without accents: "Constancia" finds "constancia laboral". */
const fold = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const matches = (template: Template, query: string) => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const haystack = fold(
    [
      template.name.es,
      template.name.en,
      template.description.es,
      template.description.en,
    ].join(" "),
  );
  return words.every((w) => haystack.includes(w));
};

export function TemplatesView({ onClose, onOpen }: Props) {
  const t = useT();
  const [selected, setSelected] = useState<string | null>(null);
  // Style and photo stay while the user goes from one template to another.
  const [style, setStyle] = useState<Style>(defaultStyle);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const template = selected ? templateById(selected) : undefined;

  const choose = (id: string) => {
    track("template_open", { template: id });
    setSelected(id);
  };

  return (
    <div
      className="scan-view tpl-view"
      role="dialog"
      aria-label={t("templates.title")}
    >
      {template ? (
        <Filler
          key={template.id}
          template={template}
          style={style}
          onStyle={setStyle}
          photo={photo}
          onPhoto={setPhoto}
          onBack={() => setSelected(null)}
          onClose={onClose}
          onOpen={onOpen}
        />
      ) : (
        <Gallery onChoose={choose} onClose={onClose} />
      )}
    </div>
  );
}

function Gallery({
  onChoose,
  onClose,
}: {
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const found = TEMPLATES.filter(
    (tpl) =>
      (category === "all" || tpl.category === category) && matches(tpl, query),
  );
  return (
    <>
      <header className="scan-toolbar tpl-toolbar">
        <h2>{t("templates.title")}</h2>
        <input
          type="search"
          className="tpl-search"
          placeholder={t("templates.search")}
          aria-label={t("templates.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="scan-spacer" />
        <button type="button" onClick={onClose}>
          {t("templates.close")}
        </button>
      </header>
      <div className="tpl-gallery">
        <p className="tpl-lead">{t("templates.lead")}</p>
        <div
          className="tpl-chips"
          role="group"
          aria-label={t("templates.categories")}
        >
          {(["all", ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {c === "all" ? t("templates.all") : CATEGORY_NAMES[c][lang]}
            </button>
          ))}
        </div>
        {found.length === 0 && (
          <p className="hint">{t("templates.noResults", query)}</p>
        )}
        {CATEGORIES.map((c) => {
          const list = found.filter((tpl) => tpl.category === c);
          if (!list.length) return null;
          return (
            <section key={c} className="tpl-category">
              <h3>{CATEGORY_NAMES[c][lang]}</h3>
              <ul className="tpl-cards">
                {list.map((tpl) => (
                  <li key={tpl.id}>
                    <button
                      type="button"
                      className="tpl-card"
                      data-template={tpl.id}
                      onClick={() => onChoose(tpl.id)}
                    >
                      <Thumb template={tpl} />
                      <strong>{tpl.name[lang]}</strong>
                      <span>{tpl.description[lang]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Thumb({ template }: { template: Template }) {
  const lang = useLang();
  const ref = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(ref, "400px");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    thumbnail(template, lang).then(
      (u) => !cancelled && setUrl(u),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [near, template, lang]);
  return (
    <span ref={ref} className="tpl-thumb" aria-hidden="true">
      {url && <img src={url} alt="" />}
    </span>
  );
}

interface FillerProps {
  template: Template;
  style: Style;
  onStyle: (style: Style) => void;
  photo: Photo | null;
  onPhoto: (photo: Photo | null) => void;
  onBack: () => void;
  onClose: () => void;
  onOpen: (file: File) => void;
}

type Ask = { kind: "leave"; then: () => void } | { kind: "reset" };

function Filler({
  template,
  style,
  onStyle,
  photo,
  onPhoto,
  onBack,
  onClose,
  onOpen,
}: FillerProps) {
  const t = useT();
  const lang = useLang();
  const mobile = useMobile();
  const [tab, setTab] = useState<"form" | "preview">("form");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const values = useMemo(
    () => effectiveValues(template, draft, lang),
    [template, draft, lang],
  );
  const usedPhoto = template.photo ? photo : null;
  const dirty =
    Object.keys(draft.fields).length > 0 || Object.keys(draft.lists).length > 0;

  // Live preview: regenerated a moment after the last change (CA4). It is
  // up to date when it was made from the current inputs.
  const job = useMemo(
    () => ({ template, values, lang, style, photo: usedPhoto }),
    [template, values, lang, style, usedPhoto],
  );
  const [shown, setShown] = useState<{
    job: typeof job;
    pages: string[];
    failed: boolean;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { bytes } = await generate(
          job.template,
          job.values,
          job.lang,
          job.style,
          job.photo,
          cachedFont,
        );
        if (cancelled) return;
        const urls = await renderPages(bytes, 1000);
        if (cancelled) urls.forEach((u) => URL.revokeObjectURL(u));
        else setShown({ job, pages: urls, failed: false });
      } catch {
        if (!cancelled)
          setShown((s) => ({ job, pages: s?.pages ?? [], failed: true }));
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [job]);
  const pages = shown?.pages;
  useEffect(() => () => pages?.forEach((u) => URL.revokeObjectURL(u)), [pages]);
  const state = shown?.job !== job ? "busy" : shown.failed ? "failed" : "ready";

  const [working, setWorking] = useState(false);
  const produce = async () => {
    setWorking(true);
    try {
      return await generate(
        template,
        values,
        lang,
        style,
        usedPhoto,
        cachedFont,
      );
    } catch {
      setShown((s) => ({ job, pages: s?.pages ?? [], failed: true }));
      return null;
    } finally {
      setWorking(false);
    }
  };
  const download = async () => {
    const out = await produce();
    if (!out) return;
    track("template_download", { template: template.id });
    downloadPdf(out.bytes, out.fileName);
  };
  const openInEditor = async () => {
    const out = await produce();
    if (!out) return;
    track("template_to_editor", { template: template.id });
    onOpen(
      new File([out.bytes as Uint8Array<ArrayBuffer>], out.fileName, {
        type: "application/pdf",
      }),
    );
  };

  const leave = (then: () => void) =>
    dirty ? setAsk({ kind: "leave", then }) : then();
  const setField = (key: string, value: string) =>
    setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: value } }));
  const setList = (key: string, rows: Row[]) =>
    setDraft((d) => ({ ...d, lists: { ...d.lists, [key]: rows } }));

  const choosePhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoFailed(false);
    try {
      onPhoto(await loadPhoto(file));
    } catch {
      setPhotoFailed(true);
    }
  };

  const form = (
    <div className="tpl-form">
      {template.notice && (
        <p className="tpl-notice" role="note">
          {template.notice[lang]}
        </p>
      )}
      <section className="tpl-style">
        <h3>{t("templates.style")}</h3>
        <div
          className="tpl-swatches"
          role="radiogroup"
          aria-label={t("templates.color")}
        >
          {ACCENTS.map((color, i) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={style.accent === color}
              aria-label={t(`templates.accent.${i}` as "templates.accent.0")}
              title={t(`templates.accent.${i}` as "templates.accent.0")}
              style={{ background: color }}
              onClick={() => onStyle({ ...style, accent: color })}
            />
          ))}
        </div>
        <label className="tpl-inline">
          {t("templates.fonts")}
          <select
            value={style.fonts}
            onChange={(e) =>
              onStyle({ ...style, fonts: e.target.value as Style["fonts"] })
            }
          >
            {FONT_PAIRS.map((f) => (
              <option key={f} value={f}>
                {t(`templates.fonts.${f}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="tpl-inline">
          {t("templates.paper")}
          <select
            value={style.paper}
            onChange={(e) =>
              onStyle({ ...style, paper: e.target.value as Style["paper"] })
            }
          >
            <option value="a4">{t("templates.paper.a4")}</option>
            <option value="letter">{t("templates.paper.letter")}</option>
          </select>
        </label>
        {template.photo && (
          <div className="tpl-photo">
            <span>{t("templates.photo")}</span>
            <label className="open-button">
              {photo ? t("templates.photoChange") : t("templates.photoAdd")}
              <input
                type="file"
                accept="image/*"
                data-testid="template-photo"
                onChange={(e) => {
                  void choosePhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {photo && (
              <button type="button" onClick={() => onPhoto(null)}>
                {t("templates.photoRemove")}
              </button>
            )}
            {photoFailed && (
              <span className="dialog-warning" role="alert">
                {t("templates.photoFailed")}
              </span>
            )}
          </div>
        )}
      </section>
      <TemplateForm
        template={template}
        lang={lang}
        values={values}
        onField={setField}
        onList={setList}
      />
      {dirty && (
        <button
          type="button"
          className="tpl-reset"
          onClick={() => setAsk({ kind: "reset" })}
        >
          {t("templates.reset")}
        </button>
      )}
    </div>
  );

  const preview = (
    <div className="tpl-preview" aria-busy={state === "busy"}>
      <p className="tpl-preview-status" role="status">
        {state === "failed"
          ? t("templates.previewFailed")
          : state === "busy"
            ? t("templates.generating")
            : t("templates.pages", pages?.length ?? 0)}
      </p>
      {pages?.map((url, i) => (
        <img
          key={url}
          src={url}
          alt={`${template.name[lang]} ${i + 1}`}
          className="tpl-page"
        />
      ))}
    </div>
  );

  const actions = (
    <>
      <button
        type="button"
        disabled={working}
        onClick={() => void openInEditor()}
      >
        {t("templates.openInEditor")}
      </button>
      <button
        type="button"
        className="primary"
        disabled={working}
        onClick={() => void download()}
      >
        {t("templates.download")}
      </button>
    </>
  );

  return (
    <>
      <header className="scan-toolbar tpl-toolbar">
        <button
          type="button"
          title={t("templates.backHint")}
          onClick={() => leave(onBack)}
        >
          ← {t("templates.back")}
        </button>
        <h2>{template.name[lang]}</h2>
        <span className="scan-spacer" />
        {!mobile && actions}
        <button
          type="button"
          aria-label={t("templates.close")}
          title={t("templates.close")}
          onClick={() => leave(onClose)}
        >
          ✕
        </button>
      </header>
      {mobile && (
        <div className="tpl-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "form"}
            onClick={() => setTab("form")}
          >
            {t("templates.formTab")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "preview"}
            onClick={() => setTab("preview")}
          >
            {t("templates.previewTab")}
          </button>
        </div>
      )}
      <div className="tpl-body">
        {(!mobile || tab === "form") && form}
        {(!mobile || tab === "preview") && preview}
      </div>
      {mobile && <div className="tpl-bottom">{actions}</div>}
      {ask && (
        <div className="dialog-backdrop">
          <div className="dialog" role="alertdialog" aria-modal="true">
            <p>
              {ask.kind === "leave"
                ? t("templates.leaveConfirm")
                : t("templates.resetConfirm")}
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={() => setAsk(null)}>
                {ask.kind === "leave"
                  ? t("templates.stay")
                  : t("templates.cancel")}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setAsk(null);
                  if (ask.kind === "leave") ask.then();
                  else setDraft(emptyDraft());
                }}
              >
                {ask.kind === "leave"
                  ? t("templates.leave")
                  : t("templates.reset")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
