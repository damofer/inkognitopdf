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
import { EditorView } from "./editor/EditorView";
import { useT } from "./i18n";
import { LangSwitch } from "./LangSwitch";
import type { Item, PageEntry } from "./model/document";
import { ScanView } from "./scan/ScanView";
import { A4, initialState, type EditorState } from "./model/document";
import { normalizeRotation } from "./model/geometry";
import { createPdfFile, openPdfFile, type PdfFile } from "./storage/pdfFile";
import { loadDocument, type PDFDocumentProxy } from "./viewer/pdfjs";
import { useMobile } from "./useMobile";
import { SupportPanel } from "./support/SupportPanel";
import { PasswordPrompt } from "./protect/PasswordPrompt";
import { unlock, type AskPassword } from "./storage/unlock";

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
    }
  | { status: "error"; message: string };

let nextOpenId = 1;

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
  const mobile = useMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
            <picture>
              <source
                media="(max-width: 760px) and (prefers-color-scheme: dark)"
                srcSet="/brand/mark-dark.svg"
              />
              <source
                media="(max-width: 760px)"
                srcSet="/brand/mark-light.svg"
              />
              <source
                media="(prefers-color-scheme: dark)"
                srcSet="/brand/logo-dark.svg"
              />
              <img src="/brand/logo-light.svg" alt={BRAND} height={32} />
            </picture>
          </a>
        </h1>
        {state.status === "ready" && (
          <span className="file-name">
            {state.file?.name ?? t("app.newDocument")}
          </span>
        )}
        <div
          id="app-menu"
          className={`header-actions${menuOpen ? " open" : ""}`}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button, input, a"))
              setMenuOpen(false);
          }}
        >
          <small className="build-id" title={t("app.version")}>
            {/* i18n-ignore: development build marker */}
            {import.meta.env.DEV ? "dev " : ""}
            {__BUILD_ID__}
          </small>
          <label className="open-button">
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
          {/* A short label where the header is tight: it also holds Templates. */}
          <button
            type="button"
            aria-label={t("app.blankDocument")}
            onClick={startBlank}
          >
            <span className="label-long">{t("app.blankDocument")}</span>
            <span className="label-short" aria-hidden="true">
              {t("app.blankShort")}
            </span>
          </button>
          <button type="button" onClick={() => setScanning(true)}>
            {t("app.scan")}
          </button>
          <button type="button" onClick={() => setTemplating(true)}>
            {t("templates.button")}
          </button>
          <LangSwitch />
          <button type="button" onClick={reopenConsent}>
            {t("privacy.menu")}
          </button>
          <button
            type="button"
            className="support-button"
            onClick={() => setSupportOpen(true)}
          >
            {t("support.button")}
          </button>
          <a
            className="source-link"
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            title={t("app.sourceCodeHint")}
          >
            {t("app.sourceCode")}
          </a>
        </div>
        <button
          type="button"
          className="menu-button"
          aria-label={t("mobile.menu")}
          aria-expanded={menuOpen}
          aria-controls="app-menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
          </svg>
        </button>
        {menuOpen && (
          <div
            className="menu-backdrop"
            aria-hidden="true"
            onClick={() => setMenuOpen(false)}
          />
        )}
      </header>
      <main className="app-main">
        {state.status === "empty" && (
          <div className="start">
            <p className="hint">{t("app.emptyHint")}</p>
            {!mobile && (
              <button
                type="button"
                className="start-templates"
                onClick={() => setTemplating(true)}
              >
                {t("templates.start")}
              </button>
            )}
            {mobile && (
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
            )}
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
