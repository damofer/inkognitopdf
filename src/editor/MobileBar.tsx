// Phone layout (spec 007): a bottom bar with the tool categories. Each
// category opens a sheet with its tools; "Sign" opens the signing panel.
// Spec 025: the same tasks as the desktop tabs; «More» holds review,
// protection and forms.
import { useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { Icon, type IconName } from "../icons";
import { TOOLS, type Tool } from "./tools";

type Category = "edit" | "annotate" | "sign" | "pages" | "more";

export const CATEGORY_TOOLS: Record<"edit" | "annotate" | "forms", Tool[]> = {
  edit: ["select", "text", "editText", "image", "whiteout", "redact"],
  annotate: [
    "highlight",
    "underline",
    "strikeout",
    "note",
    "freeText",
    "ink",
    "line",
    "arrow",
    "square",
    "circle",
  ],
  forms: ["formField"],
};

const ICONS: Record<Category, IconName> = {
  edit: "edit",
  annotate: "annotate",
  sign: "sign",
  pages: "pages",
  more: "moreHorizontal",
};

interface MobileBarProps {
  tool: Tool;
  onTool: (tool: Tool) => void;
  signOpen: boolean;
  onToggleSign: () => void;
  ocrOpen: boolean;
  onToggleOcr: () => void;
  /** Opens the scanner to add pages; null when it cannot. */
  onScan: (() => void) | null;
  thumbsOpen: boolean;
  onToggleThumbs: () => void;
  /** Form options shown in the forms sheet (the flatten checkbox). */
  formOptions?: ReactNode;
  /** Chooses PDFs to add at the end (spec 013); null when it cannot. */
  onInsertPdf?: (() => void) | null;
  splitOpen?: boolean;
  onToggleSplit?: () => void;
  /** Privacy x-ray (spec 015). */
  xrayOpen?: boolean;
  onToggleXray?: () => void;
  /** Spec 018: choose another version to compare with. */
  onCompare?: () => void;
  /** Page numbers, headers and footers (spec 022). */
  numbersOpen?: boolean;
  onToggleNumbers?: () => void;
  /** Compress and password panels (spec 014). */
  compressOpen?: boolean;
  onToggleCompress?: () => void;
  protectOpen?: boolean;
  /** The document will be saved with a password. */
  protectActive?: boolean;
  onToggleProtect?: () => void;
}

export function MobileBar({
  tool,
  onTool,
  signOpen,
  onToggleSign,
  ocrOpen,
  onToggleOcr,
  onScan,
  thumbsOpen,
  onToggleThumbs,
  formOptions,
  onInsertPdf = null,
  splitOpen = false,
  onToggleSplit,
  numbersOpen = false,
  onToggleNumbers,
  xrayOpen = false,
  onToggleXray,
  onCompare,
  compressOpen = false,
  onToggleCompress,
  protectOpen = false,
  protectActive = false,
  onToggleProtect,
}: MobileBarProps) {
  const t = useT();
  const [sheet, setSheet] = useState<Category | null>(null);

  const label: Record<Category, string> = {
    edit: t("mobile.edit"),
    annotate: t("mobile.annotate"),
    sign: t("mobile.sign"),
    pages: t("mobile.pages"),
    more: t("mobile.more"),
  };
  const active: Category | null = signOpen
    ? "sign"
    : ocrOpen || xrayOpen || compressOpen || protectOpen || tool === "formField"
      ? "more"
      : splitOpen || numbersOpen || thumbsOpen
        ? "pages"
        : CATEGORY_TOOLS.annotate.includes(tool)
          ? "annotate"
          : tool === "select" || tool === "place"
            ? null
            : "edit";

  const open = (category: Category) => {
    if (category === "sign") {
      setSheet(null);
      onToggleSign();
      return;
    }
    setSheet((s) => (s === category ? null : category));
  };

  /** A button of a sheet: closes the sheet, then acts. */
  const item = (
    key: string,
    icon: IconName,
    text: string,
    act: () => void,
    pressed?: boolean,
    className = "sheet-item",
  ) => (
    <button
      key={key}
      type="button"
      className={className}
      aria-pressed={pressed}
      onClick={() => {
        setSheet(null);
        act();
      }}
    >
      <span className="sheet-icon">
        <Icon name={icon} size={24} />
      </span>
      <span>{text}</span>
    </button>
  );

  const toolButton = (id: Tool) => {
    const entry = TOOLS.find((b) => b.tool === id)!;
    return item(id, entry.icon, entry.label, () => onTool(id), tool === id);
  };

  const section = (title: string, items: ReactNode[]) =>
    items.some(Boolean) && (
      <section className="sheet-section" key={title}>
        <h3>{title}</h3>
        <div className="sheet-grid">{items}</div>
      </section>
    );

  return (
    <>
      {sheet && (
        <>
          <div
            className="sheet-backdrop"
            aria-hidden="true"
            onClick={() => setSheet(null)}
          />
          <div className="mobile-sheet" role="dialog" aria-label={label[sheet]}>
            <header>
              <h2>{label[sheet]}</h2>
              <button
                type="button"
                aria-label={t("mobile.close")}
                onClick={() => setSheet(null)}
              >
                <Icon name="close" />
              </button>
            </header>
            {sheet === "edit" && (
              <div className="sheet-grid">
                {CATEGORY_TOOLS.edit.map(toolButton)}
              </div>
            )}
            {sheet === "annotate" && (
              <div className="sheet-grid">
                {CATEGORY_TOOLS.annotate.map(toolButton)}
              </div>
            )}
            {sheet === "pages" && (
              <div className="sheet-grid">
                {item(
                  "thumbs",
                  "thumbnails",
                  t("mobile.thumbnails"),
                  onToggleThumbs,
                  thumbsOpen,
                )}
                {onInsertPdf &&
                  item("insert", "insert", t("organize.insert"), onInsertPdf)}
                {onScan && item("scan", "scan", t("mobile.scanPages"), onScan)}
                {onToggleSplit &&
                  item(
                    "split",
                    "split",
                    t("organize.split"),
                    onToggleSplit,
                    splitOpen,
                  )}
                {onToggleNumbers &&
                  item(
                    "numbers",
                    "numbers",
                    t("numbering.button"),
                    onToggleNumbers,
                    numbersOpen,
                  )}
              </div>
            )}
            {sheet === "more" && (
              <>
                {section(t("mobile.review"), [
                  onToggleXray &&
                    item(
                      "xray",
                      "xray",
                      t("xray.button"),
                      onToggleXray,
                      xrayOpen,
                    ),
                  onCompare &&
                    item("compare", "compare", t("compare.button"), onCompare),
                  item(
                    "ocr",
                    "ocr",
                    t("mobile.recognizeText"),
                    onToggleOcr,
                    ocrOpen,
                  ),
                ])}
                {section(t("mobile.protect"), [
                  onToggleProtect &&
                    item(
                      "protect",
                      "protect",
                      t("protect.button"),
                      onToggleProtect,
                      protectOpen,
                      `sheet-item${protectActive ? " protected" : ""}`,
                    ),
                  onToggleCompress &&
                    item(
                      "compress",
                      "compress",
                      t("compress.button"),
                      onToggleCompress,
                      compressOpen,
                    ),
                ])}
                {section(
                  t("mobile.forms"),
                  CATEGORY_TOOLS.forms.map(toolButton),
                )}
                {formOptions && (
                  <div className="sheet-options">{formOptions}</div>
                )}
              </>
            )}
          </div>
        </>
      )}
      <nav className="mobile-bar" aria-label={t("mobile.categories")}>
        {(Object.keys(label) as Category[]).map((category) => (
          <button
            key={category}
            type="button"
            aria-expanded={category === "sign" ? undefined : sheet === category}
            aria-pressed={category === "sign" ? signOpen : undefined}
            className={active === category ? "active" : undefined}
            onClick={() => open(category)}
          >
            <Icon name={ICONS[category]} size={24} />
            <span>{label[category]}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
