// Phone layout (spec 007): a bottom bar with the tool categories. Each
// category opens a sheet with its tools; "Sign" opens the signing panel.
import { useState, type ReactNode } from "react";
import { useT } from "../i18n";
import { TOOLS, type Tool } from "./tools";

type Category = "edit" | "annotate" | "forms" | "sign" | "scan";

const CATEGORY_TOOLS: Record<"edit" | "annotate" | "forms", Tool[]> = {
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

const ICONS: Record<Category, ReactNode> = {
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  annotate: (
    <>
      <path d="M4 20h16" />
      <path d="M6 16 15.5 6.5l3 3L9 19H6z" />
    </>
  ),
  forms: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  sign: <path d="M3 17c3-6 5-8 5-4s-1 6 2 2 4-6 4-2 2 3 4 0M3 21h18" />,
  scan: (
    <>
      <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path d="M8 12h8" />
    </>
  ),
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
    forms: t("mobile.forms"),
    sign: t("mobile.sign"),
    scan: t("mobile.scanOcr"),
  };
  const active: Category | null = signOpen
    ? "sign"
    : ocrOpen
      ? "scan"
      : ((Object.keys(CATEGORY_TOOLS) as (keyof typeof CATEGORY_TOOLS)[]).find(
          (c) => c !== "edit" && CATEGORY_TOOLS[c].includes(tool),
        ) ?? (tool === "select" || tool === "place" ? null : "edit"));

  const open = (category: Category) => {
    if (category === "sign") {
      setSheet(null);
      onToggleSign();
      return;
    }
    setSheet((s) => (s === category ? null : category));
  };

  const toolButton = (id: Tool) => {
    const entry = TOOLS.find((b) => b.tool === id)!;
    return (
      <button
        key={id}
        type="button"
        className="sheet-item"
        aria-pressed={tool === id}
        onClick={() => {
          onTool(id);
          setSheet(null);
        }}
      >
        <span className="sheet-icon" aria-hidden="true">
          {entry.icon}
        </span>
        <span>{entry.label}</span>
      </button>
    );
  };

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
                ×
              </button>
            </header>
            <div className="sheet-grid">
              {sheet === "edit" && (
                <>
                  {CATEGORY_TOOLS.edit.map(toolButton)}
                  <button
                    type="button"
                    className="sheet-item"
                    aria-pressed={thumbsOpen}
                    onClick={() => {
                      onToggleThumbs();
                      setSheet(null);
                    }}
                  >
                    <span className="sheet-icon" aria-hidden="true">
                      ▤
                    </span>
                    <span>{t("mobile.pages")}</span>
                  </button>
                  {onInsertPdf && (
                    <button
                      type="button"
                      className="sheet-item"
                      onClick={() => {
                        setSheet(null);
                        onInsertPdf();
                      }}
                    >
                      <span className="sheet-icon" aria-hidden="true">
                        ⊕
                      </span>
                      <span>{t("organize.insert")}</span>
                    </button>
                  )}
                  {onToggleSplit && (
                    <button
                      type="button"
                      className="sheet-item"
                      aria-pressed={splitOpen}
                      onClick={() => {
                        setSheet(null);
                        onToggleSplit();
                      }}
                    >
                      <span className="sheet-icon" aria-hidden="true">
                        ✂
                      </span>
                      <span>{t("organize.split")}</span>
                    </button>
                  )}
                  {onToggleXray && (
                    <button
                      type="button"
                      className="sheet-item"
                      aria-pressed={xrayOpen}
                      onClick={() => {
                        setSheet(null);
                        onToggleXray();
                      }}
                    >
                      <span className="sheet-icon" aria-hidden="true">
                        ◎
                      </span>
                      <span>{t("xray.button")}</span>
                    </button>
                  )}
                  {onToggleNumbers && (
                    <button
                      type="button"
                      className="sheet-item"
                      aria-pressed={numbersOpen}
                      onClick={() => {
                        setSheet(null);
                        onToggleNumbers();
                      }}
                    >
                      <span className="sheet-icon" aria-hidden="true">
                        #
                      </span>
                      <span>{t("numbering.button")}</span>
                    </button>
                  )}
                  {onToggleCompress && (
                    <button
                      type="button"
                      className="sheet-item"
                      aria-pressed={compressOpen}
                      onClick={() => {
                        setSheet(null);
                        onToggleCompress();
                      }}
                    >
                      <span className="sheet-icon" aria-hidden="true">
                        ⇲
                      </span>
                      <span>{t("compress.button")}</span>
                    </button>
                  )}
                  {onToggleProtect && (
                    <button
                      type="button"
                      className={`sheet-item${protectActive ? " protected" : ""}`}
                      aria-pressed={protectOpen}
                      onClick={() => {
                        setSheet(null);
                        onToggleProtect();
                      }}
                    >
                      <span className="sheet-icon" aria-hidden="true">
                        ⚿
                      </span>
                      <span>{t("protect.button")}</span>
                    </button>
                  )}
                </>
              )}
              {sheet === "annotate" && CATEGORY_TOOLS.annotate.map(toolButton)}
              {sheet === "forms" && CATEGORY_TOOLS.forms.map(toolButton)}
              {sheet === "scan" && (
                <>
                  {onScan && (
                    <button
                      type="button"
                      className="sheet-item"
                      onClick={() => {
                        setSheet(null);
                        onScan();
                      }}
                    >
                      <span className="sheet-icon" aria-hidden="true">
                        ⎚
                      </span>
                      <span>{t("mobile.scanPages")}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="sheet-item"
                    aria-pressed={ocrOpen}
                    onClick={() => {
                      setSheet(null);
                      onToggleOcr();
                    }}
                  >
                    <span className="sheet-icon" aria-hidden="true">
                      {/* i18n-ignore: icon, hidden from screen readers */}
                      Aa
                    </span>
                    <span>{t("mobile.recognizeText")}</span>
                  </button>
                </>
              )}
            </div>
            {sheet === "forms" && formOptions && (
              <div className="sheet-options">{formOptions}</div>
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
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {ICONS[category]}
            </svg>
            <span>{label[category]}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
