import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { BRAND, SOURCE_URL } from "./brand";
import { ConsentNotice } from "./analytics/ConsentNotice";
import { track, watchConsent } from "./analytics/analytics";
import { filesBucket, pagesBucket, sizeBucket } from "./analytics/events";
import { reopenConsent } from "./analytics/consent";
import { EditorView, type Resumed } from "./editor/EditorView";
import { locale, useT } from "./i18n";
import { LangSwitch } from "./LangSwitch";
import { ThemeSwitch } from "./ThemeSwitch";
import { Icon } from "./icons";
import { useDark } from "./theme";
import { useMobile } from "./useMobile";
import type { Item, PageEntry } from "./model/document";
import { ScanView } from "./scan/ScanView";
import { A4, initialState, type EditorState } from "./model/document";
import { normalizeRotation } from "./model/geometry";
import { createPdfFile, openPdfFile, type PdfFile } from "./storage/pdfFile";
import { loadDocument, type PDFDocumentProxy } from "./viewer/pdfjs";
import { SupportPanel } from "./support/SupportPanel";
import { PasswordPrompt } from "./protect/PasswordPrompt";
import { unlock, type AskPassword } from "./storage/unlock";
import { onLaunch, takeShared, wasShared } from "./storage/incoming";
import { clearDraft, readDraft, type Draft } from "./storage/draft";

// Templates (spec 021) load only when opened: their catalog is code.
const TemplatesView = lazy(() =>
  import("./templates/TemplatesView").then((m) => ({
    default: m.TemplatesView,
  })),
);

type State =
  | { status: "empty" }
  | { status: "loading"; label: string }
  | {
      status: "ready";
      file: PdfFile | null;
      doc: PDFDocumentProxy | null;
      initial: EditorState;
      openId: number;
      /** Password the file was opened with (spec 014), kept to save it. */
      password: string | null;
      /** The file only restricted permissions and opened without them. */
      restricted: boolean;
      /** Resumed from the work kept on this device (spec 028). */
      resumed?: Resumed;
    }
  | { status: "error"; message: string };

let nextOpenId = 1;

/** "hace 5 minutos", "ayer"…: how long ago, in the interface language. */
function ago(time: number, now = Date.now()): string {
  const format = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  const minutes = Math.round((time - now) / 60_000);
  if (minutes > -60) return format.format(Math.min(minutes, 0), "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
}
/** Shared PDFs are taken once, even when effects run twice (StrictMode). */
let sharedTaken = false;

async function initialStateFor(doc: PDFDocumentProxy): Promise<EditorState> {
  const pages = await Promise.all(
    Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
  );
  return initialState(
    pages.map((page) => {
      const [x0, y0, x1, y1] = page.view as [number, number, number, number];
      return {
        box: [x0, y0, x1, y1] as const,
        rotation: normalizeRotation(page.rotate),
      };
    }),
  );
}

export function App() {
  const t = useT();
  const [state, setState] = useState<State>({ status: "empty" });
  const [scanning, setScanning] = useState(false);
  const [templating, setTemplating] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const closeSupport = useCallback(() => setSupportOpen(false), []);
  // Phone layout (spec 007): the header actions live in an overflow menu.
  const [menuOpen, setMenuOpen] = useState(false);
  const mobile = useMobile();
  const dark = useDark();
  // Escape closes the menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Spec 028: work not saved when the app was closed, offered on the start
  // screen. Not when the app opens to receive shared PDFs.
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (wasShared()) return;
    let live = true;
    readDraft()
      .then((found) => {
        if (live) setDraft(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const discardDraft = () => {
    setDraft(null);
    void clearDraft().catch(() => {});
  };
  const resumeDraft = async (found: Draft) => {
    setDraft(null);
    setState({
      status: "loading",
      label: t("draft.resuming", found.file?.name ?? t("app.newDocument")),
    });
    try {
      performance.mark("pdfcraft:open-start");
      const file = found.file
        ? createPdfFile(found.file.name, found.file.bytes)
        : null;
      const doc = file ? await loadDocument(file) : null;
      setState({
        status: "ready",
        file,
        doc,
        initial: found.state,
        openId: nextOpenId++,
        password: null,
        restricted: found.restricted,
        resumed: {
          fileId: found.fileId,
          signers: found.signers,
          planMode: found.planMode,
        },
      });
    } catch (cause) {
      setState({
        status: "error",
        message: t(
          "draft.failed",
          cause instanceof Error ? cause.message : String(cause),
        ),
      });
    }
  };
  /** Scanned pages waiting to be added to the open document. */
  const [incoming, setIncoming] = useState<{
    seq: number;
    pages: PageEntry[];
    items: Item[];
  } | null>(null);

  // Spec 014: the password of an encrypted file, asked for while opening.
  const [asking, setAsking] = useState<{
    fileName: string;
    wrong: boolean;
    answer: (password: string | null) => void;
  } | null>(null);
  const askPassword: AskPassword = useCallback(
    (fileName, wrong) =>
      new Promise((resolve) =>
        setAsking({
          fileName,
          wrong,
          answer: (password) => {
            setAsking(null);
            resolve(password);
          },
        }),
      ),
    [],
  );

  /** Opens one file, or several merged into one in that order (spec 013). */
  const open = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setState({
        status: "loading",
        label:
          files.length > 1
            ? t("app.merging", files.length)
            : t("app.opening", file.name),
      });
      try {
        performance.mark("pdfcraft:open-start");
        const first = await unlock(await openPdfFile(file), askPassword);
        let pdf = first.file;
        if (first.password !== null) track("unlock_pdf");
        if (files.length > 1) {
          const others = [];
          for (const other of files.slice(1)) {
            const opened = await unlock(await openPdfFile(other), askPassword);
            if (opened.password !== null) track("unlock_pdf");
            others.push(opened.file);
          }
          const { appendPdfs } = await import("./engine/organize");
          const { bytes } = await appendPdfs(
            pdf.copyBytes(),
            others.map((o) => ({ name: o.name, bytes: o.copyBytes() })),
          );
          pdf = createPdfFile(file.name, bytes);
        }
        const doc = await loadDocument(pdf);
        const initial = await initialStateFor(doc);
        track("open_document", {
          pages: pagesBucket(doc.numPages),
          size: sizeBucket(pdf.size),
        });
        if (files.length > 1)
          track("merge_pdf", {
            files: filesBucket(files.length),
            pages: pagesBucket(doc.numPages),
          });
        setState({
          status: "ready",
          file: pdf,
          doc,
          initial,
          openId: nextOpenId++,
          password: first.password,
          restricted: first.restricted,
        });
      } catch (cause) {
        setState({
          status: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    },
    [t, askPassword],
  );

  /** The open document gets new bytes; its edits and history stay (spec 013). */
  const replaceBase = useCallback(async (pdf: PdfFile) => {
    const doc = await loadDocument(pdf);
    setState((s) => (s.status === "ready" ? { ...s, file: pdf, doc } : s));
    return doc;
  }, []);

  /** A new document made of scanned pages (spec 002). */
  const openScanned = (pages: PageEntry[], items: Item[]) => {
    performance.mark("pdfcraft:open-start");
    setState({
      status: "ready",
      file: null,
      doc: null,
      initial: { pages, items },
      openId: nextOpenId++,
      password: null,
      restricted: false,
    });
  };

  const startBlank = () => {
    performance.mark("pdfcraft:open-start");
    track("new_blank");
    setState({
      status: "ready",
      file: null,
      doc: null,
      initial: {
        pages: [
          {
            id: "blank-1",
            source: { kind: "blank" },
            box: A4,
            baseRotation: 0,
            extraRotation: 0,
          },
        ],
        items: [],
      },
      openId: nextOpenId++,
      password: null,
      restricted: false,
    });
  };

  // Spec 017: PDFs opened from the system («Open with») or shared from
  // another app.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useEffect(() => {
    onLaunch((files) => {
      track("open_external", { via: "launch" });
      void openRef.current(files);
    });
    if (!wasShared() || sharedTaken) return;
    sharedTaken = true;
    window.history.replaceState(null, "", window.location.pathname);
    void takeShared().then((files) => {
      if (files.length === 0) {
        setState({ status: "error", message: t("share.nothing") });
        return;
      }
      track("open_external", { via: "share" });
      void openRef.current(files);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on start
  }, []);

  // Spec 011: the visit, now or when the visitor accepts; installs.
  useEffect(() => {
    const view = () =>
      track("page_view", { page_path: "/app/", page_title: "app" });
    view();
    const stop = watchConsent(view);
    const installed = () => track("install_app");
    window.addEventListener("appinstalled", installed);
    return () => {
      stop();
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  // Release pdf.js resources when a document is replaced or the app unmounts.
  useEffect(() => {
    if (state.status !== "ready" || !state.doc) return;
    const { doc } = state;
    return () => void doc.loadingTask.destroy();
  }, [state]);

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    const files = [...event.dataTransfer.files];
    if (files.length) void open(files);
  };

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="app-header">
        <h1 className="brand">
          {/* A new tab, so going to the home page never closes the open document. */}
          <a href="/" target="_blank" rel="noopener" title={t("app.home")}>
            <img
              src={`/brand/${mobile ? "mark" : "logo"}-${dark ? "dark" : "light"}.svg`}
              alt={BRAND}
              height={32}
            />
          </a>
        </h1>
        {state.status === "ready" && (
          <span className="file-name">
            {state.file?.name ?? t("app.newDocument")}
          </span>
        )}
        <button
          type="button"
          className="menu-button"
          aria-label={t("mobile.menu")}
          title={t("menu.label")}
          aria-expanded={menuOpen}
          aria-controls="app-menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Icon name="more" size={22} />
        </button>
        {menuOpen && (
          <div
            className="menu-backdrop"
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
          />
        )}
        {/* Spec 025: everything but the document in one menu. It stays in the
            page while closed, so the file input keeps working. */}
        <div
          id="app-menu"
          className={`header-actions${menuOpen ? " open" : ""}`}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest(".lang-switch, .theme-switch")) return;
            if (target.closest("button, input, a")) setMenuOpen(false);
          }}
        >
          <p className="menu-title">{t("menu.new")}</p>
          <label className="open-button menu-item">
            <Icon name="open" />
            {t("app.openPdf")}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              data-testid="open-pdf"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                if (files.length) void open(files);
                e.target.value = "";
              }}
            />
          </label>
          <button type="button" className="menu-item" onClick={startBlank}>
            <Icon name="blank" />
            {t("app.blankDocument")}
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => setScanning(true)}
          >
            <Icon name="scan" />
            {t("app.scan")}
          </button>
          <button
            type="button"
            className="menu-item"
            onClick={() => setTemplating(true)}
          >
            <Icon name="templates" />
            {t("templates.button")}
          </button>
          <p className="menu-title">{t("menu.preferences")}</p>
          <div className="menu-row">
            <Icon name="language" />
            <span>{t("lang.label")}</span>
            <LangSwitch />
          </div>
          <div className="menu-row">
            <Icon name={dark ? "moon" : "sun"} />
            <span>{t("theme.label")}</span>
            <ThemeSwitch />
          </div>
          <p className="menu-title">{t("menu.about")}</p>
          <button type="button" className="menu-item" onClick={reopenConsent}>
            <Icon name="privacy" />
            {t("privacy.menu")}
          </button>
          <button
            type="button"
            className="menu-item support-button"
            onClick={() => setSupportOpen(true)}
          >
            <Icon name="support" />
            {t("support.button")}
          </button>
          <a
            className="menu-item source-link"
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={t("app.sourceCodeHint")}
          >
            <Icon name="code" />
            {t("app.sourceCode")}
          </a>
          <small className="build-id" title={t("app.version")}>
            {/* i18n-ignore: development build marker */}
            {import.meta.env.DEV ? "dev " : ""}
            {__BUILD_ID__}
          </small>
        </div>
      </header>
      <main className="app-main">
        {state.status === "empty" && (
          <div className="start">
            {draft && (
              <section
                className="draft-offer"
                role="region"
                aria-label={t("draft.title")}
              >
                <Icon name="undo" size={22} />
                <div className="draft-text">
                  <strong>{t("draft.title")}</strong>
                  <span>
                    {t(
                      "draft.detail",
                      draft.file?.name ?? t("app.newDocument"),
                      ago(draft.savedAt),
                    )}
                  </span>
                </div>
                <div className="draft-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void resumeDraft(draft)}
                  >
                    {t("draft.resume")}
                  </button>
                  <button type="button" onClick={discardDraft}>
                    {t("draft.discard")}
                  </button>
                </div>
              </section>
            )}
            <p className="hint">{t("app.emptyHint")}</p>
            {/* The main ways to start, on phones and desktops alike. */}
            <div className="start-actions">
              <button
                type="button"
                className="primary"
                onClick={() => fileInputRef.current?.click()}
              >
                {t("app.openPdf")}
              </button>
              <button type="button" onClick={() => setScanning(true)}>
                {t("app.scan")}
              </button>
              <button type="button" onClick={() => setTemplating(true)}>
                {t("templates.button")}
              </button>
              <button type="button" onClick={startBlank}>
                {t("app.blankDocument")}
              </button>
            </div>
          </div>
        )}
        {state.status === "loading" && <p className="hint">{state.label}</p>}
        {state.status === "error" && (
          <p className="error" role="alert">
            {state.message}
          </p>
        )}
        {state.status === "ready" && (
          <EditorView
            key={state.openId}
            file={state.file}
            doc={state.doc}
            initial={state.initial}
            incoming={incoming}
            onScan={() => setScanning(true)}
            onReplaceBase={replaceBase}
            password={state.password}
            restricted={state.restricted}
            askPassword={askPassword}
            resumed={state.resumed ?? null}
          />
        )}
        {scanning && (
          <ScanView
            onClose={() => setScanning(false)}
            onOpen={openScanned}
            onAdd={
              state.status === "ready"
                ? (pages, items) =>
                    setIncoming((prev) => ({
                      seq: (prev?.seq ?? 0) + 1,
                      pages,
                      items,
                    }))
                : null
            }
          />
        )}
        {templating && (
          <Suspense fallback={<div className="scan-view" />}>
            <TemplatesView
              onClose={() => setTemplating(false)}
              onOpen={(file) => {
                setTemplating(false);
                void open([file]);
              }}
            />
          </Suspense>
        )}
      </main>
      {supportOpen && <SupportPanel onClose={closeSupport} />}
      {asking && (
        <PasswordPrompt
          key={`${asking.fileName}:${asking.wrong}`}
          fileName={asking.fileName}
          wrong={asking.wrong}
          onAnswer={asking.answer}
        />
      )}
      <ConsentNotice />
    </div>
  );
}
