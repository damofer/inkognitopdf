// Writing documents from scratch (spec 032): a rich text editor like Word or
// Google Docs, whose text becomes a PDF with real text. On wide screens it
// shows the page at scale, with the same lines as the PDF; on phones the text
// fits the screen at a readable size and the formatting bar sits above the
// keyboard. Everything happens on the device.
import { undoDepth, redoDepth } from "prosemirror-history";
import type { Node } from "prosemirror-model";
import type { Command } from "prosemirror-state";
import { EditorView as PMView } from "prosemirror-view";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { track } from "../analytics/analytics";
import type { WrittenSource } from "../model/document";
import { pagesBucket } from "../analytics/events";
import { downloadPdf, loadFont } from "../editor/save";
import { loadImageFile } from "../editor/imageInput";
import { locale, useT } from "../i18n";
import { Icon, type IconName } from "../icons";
import { safeFileName } from "../templates/engine";
import { defaultPaper } from "../templates/format";
import { renderPages } from "../templates/ui/preview";
import { PAPER, type PaperSize } from "../templates/types";
import { useMobile } from "../useMobile";
import {
  clearFormatting,
  createState,
  formatsOf,
  insertBlock,
  insertPageBreak,
  insertRule,
  isEmptyDoc,
  outdent,
  indent,
  redo,
  setAlign,
  setImageWidth,
  setMark,
  setSpacing,
  setStyle,
  toggleList,
  toggleMark,
  undo,
} from "./commands";
import { flowOf, titleOf } from "./flow";
import { layoutWriter } from "./layout";
import { measuringFaces } from "./metrics";
import {
  facesUsed,
  MARGIN,
  pageSetup,
  renderWriter,
  type WriterSettings,
} from "./render";
import {
  ALIGNS,
  BLOCK_STYLES,
  DEFAULT_FAMILY,
  FONT_SIZES,
  schema,
  SPACINGS,
  WRITER_FAMILIES,
  type Align,
  type WriterFamily,
} from "./schema";
import {
  clearWriterDraft,
  readWriterDraft,
  WRITER_KEY,
  writeWriterDraft,
  type WriterDraft,
} from "./store";
import "./writer.css";

/** The text to start from: the one being written again, or an empty one. */
function startDoc(source: WrittenSource | undefined): Node | undefined {
  if (!source) return undefined;
  try {
    return schema.nodeFromJSON(source.doc);
  } catch {
    return undefined;
  }
}

interface Props {
  onClose: () => void;
  /** Opens the PDF in the editor (from the start screen), with its text. */
  onOpen?: (file: File, source: WrittenSource) => void;
  /** Adds the pages to the open document (from the editor), with their text. */
  onInsert?: (
    bytes: Uint8Array,
    fileName: string,
    source: WrittenSource,
  ) => Promise<void>;
  /**
   * Spec 033: writing again the text of pages of the open document. Changes
   * not applied yet are kept on the device under `key`.
   */
  continuing?: { source: WrittenSource; key: string; notice: string | null };
}

const TEXT_COLORS = [
  "#000000",
  "#5f6368",
  "#d93025",
  "#e8710a",
  "#b06000",
  "#188038",
  "#12858a",
  "#1a73e8",
  "#174ea6",
  "#9334e6",
  "#d01884",
];
const HIGHLIGHTS = [
  "#fff176",
  "#b9f6ca",
  "#b3e5fc",
  "#f8bbd0",
  "#ffe0b2",
  "#e1bee7",
  "#e0e0e0",
];
const IMAGE_WIDTHS = [0.25, 0.5, 0.75, 1];
const ALIGN_ICONS: Record<Align, IconName> = {
  left: "alignLeft",
  center: "alignCenter",
  right: "alignRight",
  justify: "alignJustify",
};
/** Pixels per point at 100 % zoom. */
const PX_PER_PT = 4 / 3;
/** Large images are made smaller: the PDF does not need more. */
const MAX_IMAGE_SIDE = 2000;

type Popover =
  "textColor" | "highlight" | "align" | "insert" | "more" | "finish";

/** "hace 5 minutos", "ayer"… */
function ago(time: number, now = Date.now()): string {
  const format = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
  const minutes = Math.round((time - now) / 60_000);
  if (minutes > -60) return format.format(Math.min(minutes, 0), "minute");
  const hours = Math.round(minutes / 60);
  if (hours > -24) return format.format(hours, "hour");
  return format.format(Math.round(hours / 24), "day");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The image as a data URL, at most MAX_IMAGE_SIDE pixels on its longer side. */
async function imageNode(file: Blob): Promise<Node> {
  const image = await loadImageFile(file);
  let blob: Blob = new Blob([image.data as Uint8Array<ArrayBuffer>], {
    type: image.mime,
  });
  let { width, height } = image;
  const scale = MAX_IMAGE_SIDE / Math.max(width, height);
  if (scale < 1) {
    const bitmap = await createImageBitmap(blob);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const jpeg = image.mime === "image/jpeg";
    blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob"))), // i18n-ignore: replaced by writer.imageFailed
        jpeg ? "image/jpeg" : "image/png",
        0.9,
      ),
    );
  }
  // Small images keep about their size; the rest fill the line.
  const textWidth = PAPER.a4[0] - 2 * MARGIN;
  const natural = (width * 0.75) / textWidth;
  const fraction =
    IMAGE_WIDTHS.find((w) => w >= natural - 0.05) ?? IMAGE_WIDTHS[3]!;
  return schema.nodes.image!.create({
    src: await blobToDataUrl(blob),
    width: fraction,
    naturalWidth: width,
    naturalHeight: height,
  });
}

/** A toolbar button that keeps the text selected and the keyboard open. */
function ToolButton({
  icon,
  label,
  pressed,
  disabled,
  onRun,
  children,
  className,
}: {
  icon?: IconName;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onRun: (button: HTMLButtonElement) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`writer-tool${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onRun(e.currentTarget)}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function WriterView({ onClose, onOpen, onInsert, continuing }: Props) {
  const t = useT();
  const mobile = useMobile();
  const mountRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<PMView | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const draftKey = continuing?.key ?? WRITER_KEY;
  const [settings, setSettings] = useState<WriterSettings>(
    () =>
      continuing?.source.settings ?? {
        paper: defaultPaper(),
        family: DEFAULT_FAMILY,
      },
  );
  const settingsRef = useRef(settings);
  /** Counts editor updates: the toolbar re-reads the selection. */
  const [, setTick] = useState(0);
  const [docVersion, setDocVersion] = useState(0);
  const [offer, setOffer] = useState<WriterDraft | null>(null);
  const [popover, setPopover] = useState<{
    kind: Popover;
    anchor: DOMRect | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    continuing?.notice ?? null,
  );
  const [preview, setPreview] = useState<string[] | null>(null);
  const [markers, setMarkers] = useState<{ page: number; top: number }[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [pt, setPt] = useState(PX_PER_PT);
  const [paged, setPaged] = useState(true);
  const [viewport, setViewport] = useState<{
    top: number;
    height: number;
  } | null>(null);
  /** This session wrote the copy on the device (RF-032-12). */
  const savedHere = useRef(false);

  // The editor itself, created once.
  useLayoutEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const view: PMView = new PMView(mount, {
      state: createState(startDoc(continuing?.source)),
      attributes: (state) => ({
        class: `writer-editor${isEmptyDoc(state.doc) ? " is-empty" : ""}`,
        "aria-label": t("writer.editorLabel"),
        "aria-multiline": "true",
        role: "textbox",
        spellcheck: "true",
        "data-placeholder": t("writer.placeholder"),
        "data-testid": "writer-editor",
      }),
      dispatchTransaction(tr) {
        view.updateState(view.state.apply(tr));
        setTick((n) => n + 1);
        if (tr.docChanged) setDocVersion((n) => n + 1);
      },
      handlePaste(_view, event) {
        // A pasted picture (a screenshot) becomes an image of the document.
        const files = [...(event.clipboardData?.files ?? [])];
        const image = files.find((f) => f.type.startsWith("image/"));
        if (!image || event.clipboardData?.getData("text/html")) return false;
        void addImage(image);
        return true;
      },
    });
    viewRef.current = view;
    track("writer_open");
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // An unfinished document is offered first (RF-032-12). Writing again
  // (spec 033), the changes not applied yet come back as they were.
  useEffect(() => {
    let live = true;
    readWriterDraft(Date.now(), draftKey)
      .then((draft) => {
        if (!live || !draft || !viewRef.current) return;
        if (continuing) resume(draft);
        else if (isEmptyDoc(viewRef.current.state.doc)) setOffer(draft);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once
  }, []);

  const resume = (draft: WriterDraft) => {
    setOffer(null);
    const view = viewRef.current;
    if (!view) return;
    try {
      const doc = schema.nodeFromJSON(draft.doc);
      view.updateState(createState(doc));
      setSettings(draft.settings);
      savedHere.current = true;
      setTick((n) => n + 1);
      setDocVersion((n) => n + 1);
    } catch {
      // A copy this version cannot read: start empty.
    }
    view.focus();
  };

  const startNew = () => {
    setOffer(null);
    void clearWriterDraft().catch(() => {});
    viewRef.current?.focus();
  };

  // Saving on the device, a moment after each change.
  const save = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc;
    if (isEmptyDoc(doc)) {
      if (savedHere.current) void clearWriterDraft(draftKey).catch(() => {});
      savedHere.current = false;
      return;
    }
    savedHere.current = true;
    void writeWriterDraft(
      {
        savedAt: Date.now(),
        settings: settingsRef.current,
        doc: doc.toJSON(),
        title: titleOf(doc),
      },
      draftKey,
    ).catch(() => {});
  }, [draftKey]);
  useEffect(() => {
    if (docVersion === 0 && !savedHere.current) return;
    const timer = setTimeout(save, 800);
    return () => clearTimeout(timer);
  }, [docVersion, settings, save]);
  useEffect(() => {
    const now = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", now);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", now);
    };
  }, [save]);

  // Page at scale on wide screens, text at a readable size on phones.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const fit = () => {
      const pageWidth = PAPER[settings.paper][0];
      const available = scroll.clientWidth - (mobile ? 16 : 48);
      const scale = available / pageWidth;
      if (scale >= 0.75) {
        setPaged(true);
        setPt(Math.min(PX_PER_PT, scale));
      } else {
        setPaged(false);
        setPt(PX_PER_PT);
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [settings.paper, mobile]);

  // The formatting bar stays above the on-screen keyboard.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setViewport(
        covered > 40 ? { top: vv.offsetTop, height: vv.height } : null,
      );
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  // Where each page of the PDF starts (RF-032-08), with the PDF's own layout.
  const measure = useCallback(async () => {
    const view = viewRef.current;
    const paper = paperRef.current;
    if (!view || !paper) return;
    const doc = view.state.doc;
    const current = settingsRef.current;
    const blocks = flowOf(doc, current.family);
    let faces;
    try {
      faces = await measuringFaces(facesUsed(blocks));
    } catch {
      return;
    }
    // Something changed meanwhile: a newer measure follows.
    if (viewRef.current !== view || view.state.doc !== doc) return;
    const laid = layoutWriter(blocks, pageSetup(current.paper), faces.faceOf);
    setPageCount(laid.pages.length);
    const origin = paper.getBoundingClientRect().top;
    const found: { page: number; top: number }[] = [];
    laid.starts.forEach((pos, i) => {
      try {
        const at = Math.min(pos, doc.content.size);
        const after = doc.resolve(at).nodeAfter;
        let top: number;
        if (after?.isBlock && after.isAtom) {
          const dom = view.nodeDOM(at);
          if (!(dom instanceof HTMLElement)) return;
          top = dom.getBoundingClientRect().top;
        } else top = view.coordsAtPos(after?.isTextblock ? at + 1 : at, 1).top;
        found.push({ page: i + 2, top: top - origin });
      } catch {
        // A position the view cannot show: no marker for that page.
      }
    });
    setMarkers(found);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => void measure(), 250);
    return () => clearTimeout(timer);
  }, [docVersion, settings, pt, paged, measure]);
  useEffect(() => {
    // The editor's fonts arrive after the first layout.
    void document.fonts?.ready.then(() => void measure());
    const again = () => void measure();
    document.fonts?.addEventListener("loadingdone", again);
    return () => document.fonts?.removeEventListener("loadingdone", again);
  }, [measure]);

  // Popovers close on Escape and when the user taps elsewhere.
  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover]);

  const view = viewRef.current;
  const state = view?.state;
  const formats = state ? formatsOf(state) : null;
  const empty = state ? isEmptyDoc(state.doc) : true;
  const title = state ? titleOf(state.doc) : "";

  const run = (command: Command) => {
    const v = viewRef.current;
    if (!v) return;
    command(v.state, v.dispatch, v);
    v.focus();
  };

  const toggle = (anchor: HTMLElement, kind: Popover) =>
    setPopover((p) =>
      p?.kind === kind
        ? null
        : { kind, anchor: anchor.getBoundingClientRect() },
    );

  async function addImage(file: Blob) {
    setNotice(null);
    try {
      const node = await imageNode(file);
      run(insertBlock(node));
    } catch {
      setNotice(t("writer.imageFailed"));
    }
  }

  const chooseFamily = (family: WriterFamily) => {
    const v = viewRef.current;
    // In an empty document the font is the document's own.
    if (v && isEmptyDoc(v.state.doc)) {
      setSettings((s) => ({ ...s, family }));
      run(setMark(schema.marks.font!, null));
    } else run(setMark(schema.marks.font!, { family }));
  };

  const finishWith = async (output: "download" | "editor" | "insert") => {
    const v = viewRef.current;
    if (!v || busy) return;
    setPopover(null);
    setBusy(true);
    setNotice(null);
    try {
      const { bytes, pages, title } = await renderWriter(
        v.state.doc,
        settingsRef.current,
        loadFont,
      );
      const fileName = `${safeFileName(title || t("writer.defaultFileName"))}.pdf`;
      track("writer_finish", { output, pages: pagesBucket(pages) });
      if (output === "download") {
        downloadPdf(bytes, fileName);
        return;
      }
      await clearWriterDraft(draftKey).catch(() => {});
      savedHere.current = false;
      const source: WrittenSource = {
        doc: v.state.doc.toJSON(),
        settings: settingsRef.current,
        title,
      };
      if (output === "insert" && onInsert)
        await onInsert(bytes, fileName, source);
      else
        onOpen?.(
          new File([bytes as Uint8Array<ArrayBuffer>], fileName, {
            type: "application/pdf",
          }),
          source,
        );
      onClose();
    } catch (cause) {
      setNotice(
        t(
          "writer.failed",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const showPreview = async () => {
    const v = viewRef.current;
    if (!v || busy) return;
    setPopover(null);
    setBusy(true);
    setNotice(null);
    try {
      const { bytes } = await renderWriter(
        v.state.doc,
        settingsRef.current,
        loadFont,
      );
      const width = Math.min(
        1200,
        Math.round((scrollRef.current?.clientWidth ?? 800) * devicePixelRatio),
      );
      setPreview(await renderPages(bytes, width));
    } catch (cause) {
      setNotice(
        t(
          "writer.failed",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const closePreview = () => {
    preview?.forEach((url) => URL.revokeObjectURL(url));
    setPreview(null);
  };

  const close = () => {
    save();
    onClose();
  };

  const level = formats?.level ?? 0;
  const defaultSize =
    level === 0 ? BLOCK_STYLES.paragraph.size : BLOCK_STYLES[level].size;
  const marks = schema.marks;

  const styleSelect = (
    <select
      className="writer-select"
      aria-label={t("writer.style")}
      title={t("writer.style")}
      value={level}
      onChange={(e) => run(setStyle(Number(e.target.value) as 0 | 1 | 2 | 3))}
    >
      {([0, 1, 2, 3] as const).map((l) => (
        <option key={l} value={l}>
          {t(`writer.style.${l}`)}
        </option>
      ))}
    </select>
  );
  const fontSelect = (
    <select
      className="writer-select writer-font"
      aria-label={t("writer.font")}
      title={t("writer.font")}
      value={formats?.family ?? settings.family}
      onChange={(e) => chooseFamily(e.target.value as WriterFamily)}
    >
      {WRITER_FAMILIES.map((f) => (
        <option key={f} value={f}>
          {t(`writer.family.${f}`)}
        </option>
      ))}
    </select>
  );
  const sizeSelect = (
    <select
      className="writer-select writer-size-select"
      aria-label={t("writer.size")}
      title={t("writer.size")}
      value={formats?.size ?? defaultSize}
      onChange={(e) =>
        run(setMark(marks.size!, { size: Number(e.target.value) }))
      }
    >
      {[...new Set([...FONT_SIZES, formats?.size ?? defaultSize])]
        .sort((a, b) => a - b)
        .map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
    </select>
  );
  const spacingSelect = (
    <select
      className="writer-select"
      aria-label={t("writer.spacing")}
      title={t("writer.spacing")}
      value={formats?.spacing ?? 1.15}
      onChange={(e) => run(setSpacing(Number(e.target.value)))}
    >
      {SPACINGS.map((s) => (
        <option key={s} value={s}>
          {s.toLocaleString(locale())}
        </option>
      ))}
    </select>
  );
  const paperSelect = (
    <select
      className="writer-select"
      aria-label={t("writer.paper")}
      title={t("writer.paper")}
      value={settings.paper}
      onChange={(e) =>
        setSettings((s) => ({ ...s, paper: e.target.value as PaperSize }))
      }
    >
      <option value="a4">{t("templates.paper.a4")}</option>
      <option value="letter">{t("templates.paper.letter")}</option>
    </select>
  );

  const markButtons = (
    <>
      <ToolButton
        icon="bold"
        label={t("writer.bold")}
        pressed={formats?.bold}
        onRun={() => run(toggleMark(marks.strong!))}
      />
      <ToolButton
        icon="italic"
        label={t("writer.italic")}
        pressed={formats?.italic}
        onRun={() => run(toggleMark(marks.em!))}
      />
      <ToolButton
        icon="underline"
        label={t("writer.underline")}
        pressed={formats?.underline}
        onRun={() => run(toggleMark(marks.underline!))}
      />
    </>
  );
  const strikeButton = (
    <ToolButton
      icon="strikeout"
      label={t("writer.strike")}
      pressed={formats?.strike}
      onRun={() => run(toggleMark(marks.strike!))}
    />
  );
  const colorButtons = (
    <>
      <ToolButton
        label={t("writer.color")}
        className="writer-swatch-tool"
        pressed={popover?.kind === "textColor"}
        onRun={(b) => toggle(b, "textColor")}
      >
        <Icon name="textColor" />
        <span
          className="writer-swatch-bar"
          style={{ background: formats?.color ?? "#000000" }}
        />
      </ToolButton>
      <ToolButton
        label={t("writer.highlight")}
        className="writer-swatch-tool"
        pressed={popover?.kind === "highlight"}
        onRun={(b) => toggle(b, "highlight")}
      >
        <Icon name="highlight" />
        <span
          className="writer-swatch-bar"
          style={{ background: formats?.highlight ?? "transparent" }}
        />
      </ToolButton>
    </>
  );
  const alignButtons = ALIGNS.map((a) => (
    <ToolButton
      key={a}
      icon={ALIGN_ICONS[a]}
      label={t(`writer.align.${a}`)}
      pressed={formats?.align === a}
      onRun={() => {
        run(setAlign(a));
        if (mobile) setPopover(null);
      }}
    />
  ));
  const listButtons = (
    <>
      <ToolButton
        icon="listBullet"
        label={t("writer.bullets")}
        pressed={formats?.list === "bullet"}
        onRun={() => run(toggleList(schema.nodes.bullet_list!))}
      />
      <ToolButton
        icon="listOrdered"
        label={t("writer.numbers")}
        pressed={formats?.list === "ordered"}
        onRun={() => run(toggleList(schema.nodes.ordered_list!))}
      />
    </>
  );
  const indentButtons = (
    <>
      <ToolButton
        icon="outdent"
        label={t("writer.outdent")}
        disabled={!formats?.list}
        onRun={() => run(outdent)}
      />
      <ToolButton
        icon="indent"
        label={t("writer.indent")}
        disabled={!formats?.list}
        onRun={() => run(indent)}
      />
    </>
  );
  const insertButtons = (
    <>
      <ToolButton
        icon="image"
        label={t("writer.insertImage")}
        onRun={() => {
          setPopover(null);
          imageInputRef.current?.click();
        }}
      />
      <ToolButton
        icon="pageBreak"
        label={t("writer.pageBreak")}
        onRun={() => {
          setPopover(null);
          run(insertPageBreak);
        }}
      />
      <ToolButton
        icon="rule"
        label={t("writer.rule")}
        onRun={() => {
          setPopover(null);
          run(insertRule);
        }}
      />
    </>
  );
  const clearButton = (
    <ToolButton
      icon="clearFormat"
      label={t("writer.clear")}
      onRun={() => run(clearFormatting)}
    />
  );
  const historyButtons = (
    <>
      <ToolButton
        icon="undo"
        label={t("writer.undo")}
        disabled={!state || undoDepth(state) === 0}
        onRun={() => run(undo)}
      />
      <ToolButton
        icon="redo"
        label={t("writer.redo")}
        disabled={!state || redoDepth(state) === 0}
        onRun={() => run(redo)}
      />
    </>
  );
  const imageWidths = formats?.imageWidth != null && (
    <span
      className="writer-group writer-image-widths"
      role="group"
      aria-label={t("writer.imageWidth")}
    >
      {IMAGE_WIDTHS.map((w) => (
        <ToolButton
          key={w}
          label={`${t("writer.imageWidth")}: ${Math.round(w * 100)} %`}
          pressed={formats.imageWidth === w}
          onRun={() => run(setImageWidth(w))}
        >
          {`${Math.round(w * 100)} %`}
        </ToolButton>
      ))}
    </span>
  );

  // Popover position: under its button, or above it near the bottom.
  const popoverStyle = (): CSSProperties => {
    const anchor = popover?.anchor;
    if (!anchor) return {};
    const below = anchor.top < window.innerHeight / 2;
    // On phones popovers take the width of the screen.
    const across = mobile
      ? { left: 8, right: 8 }
      : { left: Math.max(8, Math.min(anchor.left, window.innerWidth - 340)) };
    return below
      ? { top: anchor.bottom + 6, ...across }
      : { bottom: window.innerHeight - anchor.top + 6, ...across };
  };

  const palette = (kind: "textColor" | "highlight") => {
    const colors = kind === "textColor" ? TEXT_COLORS : HIGHLIGHTS;
    const current = kind === "textColor" ? formats?.color : formats?.highlight;
    const type = kind === "textColor" ? marks.color! : marks.highlight!;
    return (
      <div
        className="writer-popover writer-palette"
        role="group"
        aria-label={t(
          kind === "textColor" ? "writer.color" : "writer.highlight",
        )}
        style={popoverStyle()}
      >
        <ToolButton
          label={t(
            kind === "textColor" ? "writer.colorAuto" : "writer.highlightNone",
          )}
          className="writer-palette-none"
          pressed={!current}
          onRun={() => {
            run(setMark(type, null));
            setPopover(null);
          }}
        >
          {t(
            kind === "textColor" ? "writer.colorAuto" : "writer.highlightNone",
          )}
        </ToolButton>
        <div className="writer-swatches">
          {colors.map((c) => (
            <ToolButton
              key={c}
              label={c}
              className="writer-swatch"
              pressed={current === c}
              onRun={() => {
                run(setMark(type, { color: c }));
                setPopover(null);
              }}
            >
              <span style={{ background: c }} />
            </ToolButton>
          ))}
        </div>
      </div>
    );
  };

  const finishActions = (
    <>
      {onInsert && (
        <button
          type="button"
          className="primary"
          disabled={busy || empty}
          title={t(
            continuing ? "writer.updateDocHint" : "writer.insertInDocHint",
          )}
          onClick={() => void finishWith("insert")}
        >
          <Icon name="insert" />
          {t(continuing ? "writer.updateDoc" : "writer.insertInDoc")}
        </button>
      )}
      {!onInsert && onOpen && (
        <button
          type="button"
          className="primary"
          disabled={busy || empty}
          title={t("writer.openInEditorHint")}
          onClick={() => void finishWith("editor")}
        >
          <Icon name="edit" />
          {t("writer.openInEditor")}
        </button>
      )}
      <button
        type="button"
        disabled={busy || empty}
        onClick={() => void finishWith("download")}
      >
        <Icon name="download" />
        {t("writer.download")}
      </button>
    </>
  );

  const rootStyle: CSSProperties = viewport
    ? { top: viewport.top, height: viewport.height, bottom: "auto" }
    : {};
  const paperStyle = {
    "--pt": pt,
    "--page-w": PAPER[settings.paper][0],
    "--doc-font": settings.family,
    "--page-break-label": JSON.stringify(t("writer.pageBreak")),
  } as CSSProperties;

  return (
    <div
      className={`scan-view writer-view${mobile ? " is-mobile" : ""}`}
      role="dialog"
      aria-label={t("writer.title")}
      style={rootStyle}
    >
      <header className="scan-toolbar writer-top">
        <button
          type="button"
          className="writer-close"
          aria-label={t("writer.close")}
          title={t("writer.closeHint")}
          onClick={close}
        >
          <Icon name="close" />
          {!mobile && t("writer.close")}
        </button>
        <div className="writer-heading">
          <h2>{title || t("writer.untitled")}</h2>
          <span className="writer-page-count">
            {t("writer.pages", pageCount)}
          </span>
        </div>
        <span className="scan-spacer" />
        {mobile ? (
          <>
            {historyButtons}
            <ToolButton
              icon="plus"
              label={t("writer.insert")}
              pressed={popover?.kind === "insert"}
              onRun={(b) => toggle(b, "insert")}
            />
            <ToolButton
              icon="eye"
              label={t("writer.preview")}
              disabled={busy}
              onRun={() => void showPreview()}
            />
            <button
              type="button"
              className="primary writer-done"
              aria-label={t("writer.done")}
              title={t("writer.done")}
              disabled={busy || empty}
              onClick={(e) => toggle(e.currentTarget, "finish")}
            >
              <Icon name="check" />
            </button>
          </>
        ) : (
          <>
            {paperSelect}
            <button
              type="button"
              disabled={busy}
              onClick={() => void showPreview()}
            >
              <Icon name="eye" />
              {t("writer.preview")}
            </button>
            {finishActions}
          </>
        )}
      </header>

      {!mobile && (
        <div
          className="writer-toolbar"
          role="toolbar"
          aria-label={t("writer.toolbar")}
        >
          <span className="writer-group">{historyButtons}</span>
          <span className="writer-group">
            {styleSelect}
            {fontSelect}
            {sizeSelect}
          </span>
          <span className="writer-group">
            {markButtons}
            {strikeButton}
            {colorButtons}
          </span>
          <span className="writer-group">
            {alignButtons}
            {spacingSelect}
          </span>
          <span className="writer-group">
            {listButtons}
            {indentButtons}
          </span>
          <span className="writer-group">{insertButtons}</span>
          <span className="writer-group">{clearButton}</span>
          {imageWidths}
        </div>
      )}

      {(busy || notice) && (
        <p
          className={notice ? "writer-notice error" : "writer-notice"}
          role="status"
        >
          {notice ?? t("writer.working")}
        </p>
      )}

      <div className="writer-scroll" ref={scrollRef}>
        <div
          ref={paperRef}
          className={`writer-page${paged ? " is-paged" : " is-flow"}`}
          style={paperStyle}
        >
          <div ref={mountRef} />
          {markers.map((m) => (
            <div
              key={m.page}
              className="writer-marker"
              style={{ top: m.top }}
              aria-hidden="true"
            >
              <span>{t("writer.pageMarker", m.page)}</span>
            </div>
          ))}
        </div>
      </div>

      {mobile && (
        <div
          className="writer-format-bar"
          role="toolbar"
          aria-label={t("writer.toolbar")}
        >
          {imageWidths || (
            <>
              {markButtons}
              {colorButtons}
              <ToolButton
                icon={ALIGN_ICONS[formats?.align ?? "left"]}
                label={t("writer.align")}
                pressed={popover?.kind === "align"}
                onRun={(b) => toggle(b, "align")}
              />
              {listButtons}
              <ToolButton
                label={t("writer.moreFormat")}
                className="writer-more-format"
                pressed={popover?.kind === "more"}
                onRun={(b) => toggle(b, "more")}
              >
                <Icon name="text" />
              </ToolButton>
            </>
          )}
        </div>
      )}

      {popover && (
        <div
          className="writer-popover-backdrop"
          aria-hidden="true"
          onPointerDown={(e) => {
            e.preventDefault();
            setPopover(null);
          }}
        />
      )}
      {popover?.kind === "textColor" && palette("textColor")}
      {popover?.kind === "highlight" && palette("highlight")}
      {popover?.kind === "align" && (
        <div
          className="writer-popover writer-row-popover"
          role="group"
          aria-label={t("writer.align")}
          style={popoverStyle()}
        >
          {alignButtons}
        </div>
      )}
      {popover?.kind === "insert" && (
        <div
          className="writer-popover writer-row-popover"
          role="group"
          aria-label={t("writer.insert")}
          style={popoverStyle()}
        >
          {insertButtons}
        </div>
      )}
      {popover?.kind === "more" && (
        <div
          className="writer-popover writer-more"
          role="group"
          aria-label={t("writer.moreFormat")}
          style={popoverStyle()}
        >
          <label>
            <span>{t("writer.style")}</span>
            {styleSelect}
          </label>
          <label>
            <span>{t("writer.font")}</span>
            {fontSelect}
          </label>
          <label>
            <span>{t("writer.size")}</span>
            {sizeSelect}
          </label>
          <label>
            <span>{t("writer.spacing")}</span>
            {spacingSelect}
          </label>
          <label>
            <span>{t("writer.paper")}</span>
            {paperSelect}
          </label>
          <div className="writer-more-row">
            {strikeButton}
            {indentButtons}
            {clearButton}
          </div>
        </div>
      )}
      {popover?.kind === "finish" && (
        <div
          className="writer-popover writer-finish"
          role="group"
          aria-label={t("writer.finishTitle")}
          style={popoverStyle()}
        >
          <p>{t("writer.finishTitle")}</p>
          {finishActions}
        </div>
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        data-testid="writer-image-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void addImage(file);
        }}
      />

      {offer && (
        <div
          className="writer-offer"
          role="alertdialog"
          aria-label={t("writer.resumeTitle")}
        >
          <div className="writer-offer-card">
            <strong>{t("writer.resumeTitle")}</strong>
            <span>
              {t(
                "writer.resumeDetail",
                offer.title || t("writer.untitled"),
                ago(offer.savedAt),
              )}
            </span>
            <div className="writer-offer-actions">
              <button
                type="button"
                className="primary"
                onClick={() => resume(offer)}
              >
                {t("writer.resume")}
              </button>
              <button type="button" onClick={startNew}>
                {t("writer.startNew")}
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div
          className="writer-preview"
          role="dialog"
          aria-label={t("writer.preview")}
        >
          <header className="scan-toolbar">
            <button type="button" onClick={closePreview}>
              <Icon name="edit" />
              {t("writer.previewBack")}
            </button>
            <span className="writer-page-count">
              {t("writer.pages", preview.length)}
            </span>
          </header>
          <div className="writer-preview-pages">
            {preview.map((url, i) => (
              <img
                key={url}
                src={url}
                alt={t("writer.pageMarker", i + 1)}
                className="writer-preview-page"
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
