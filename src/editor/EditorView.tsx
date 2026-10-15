import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  effectiveRotation,
  type AnnotationItem,
  type EditorState,
  type FontFamily,
  type FormFieldItem,
  type FormFieldType,
  type Item,
  type SignatureItem,
  type SignFieldItem,
  type PageEntry,
  type TextItem,
  type TextStyle,
} from "../model/document";
import type { PagePixels } from "./scanTextEdit";
import { existingItemId } from "../engine/annotRead";
import { EMPTY_DOC_INFO, type DocInfo } from "./docInfo";
import type { PageWidget } from "./FormLayer";
import { normalizeRotation, type PageGeometry } from "../model/geometry";
import { newId } from "../model/operations";
import { OcrPanel, pageIsScanned } from "../ocr/OcrPanel";
import { createPdfFile, openPdfFile, type PdfFile } from "../storage/pdfFile";
import type { PDFDocumentProxy } from "../viewer/pdfjs";
import { Viewer } from "../viewer/Viewer";
import { EditLayer, type Placing, type TextDraft } from "./EditLayer";
import { formatDate, SignPanel, type Adopted } from "../sign/SignPanel";
import { PlanEditor } from "../sign/PlanEditor";
import { SignAsPanel } from "../sign/SignAsPanel";
import type {
  PlanMode,
  PlanSigner,
  SignerStatus,
  SigningPlan,
} from "../sign/multi";
import { signFieldLabel, type SignFieldType } from "../model/signature";
import {
  IdentityPicker,
  type SaveMode,
  type StoredIdentity,
} from "../sign/IdentityPicker";
import { SignaturesPanel } from "../sign/SignaturesPanel";
import type { SignatureReport } from "../sign/verify";
import type { Identity } from "../sign/certificates";
import { loadImageFile, type LoadedImage } from "./imageInput";
import { DEFAULT_TEXT_STYLE } from "./itemOps";
import { textBoxes, type TextBox } from "./textBoxes";
import { toolHint, TOOLS, type Tool } from "./tools";
import { useEditor } from "./useEditor";
import { track, trackOnce } from "../analytics/analytics";
import { filesBucket, pagesBucket } from "../analytics/events";
import { featureOf } from "../analytics/features";
import { useT, type MessageKey } from "../i18n";
import { useMobile, useTouch } from "../useMobile";
import { Toast } from "../Toast";
import { MobileBar } from "./MobileBar";
import { RedactOptions } from "./RedactOptions";
import { SplitPanel, type SplitMode } from "./SplitPanel";

interface EditorViewProps {
  file: PdfFile | null;
  doc: PDFDocumentProxy | null;
  initial: EditorState;
  /** Scanned pages to append to the document (spec 002, CA9). */
  incoming?: { seq: number; pages: PageEntry[]; items?: Item[] } | null;
  /** Opens the scanner (phone layout, spec 007). */
  onScan?: () => void;
  /**
   * Gives the document new bytes that keep its pages as they are (inserting
   * PDFs, spec 013) and returns them loaded.
   */
  onReplaceBase?: (file: PdfFile) => Promise<PDFDocumentProxy>;
}

const FONTS: { value: FontFamily; label: string }[] = [
  { value: "Helvetica", label: "Helvetica" },
  { value: "Times", label: "Times" },
  { value: "Courier", label: "Courier" },
];
const STROKE_WIDTHS = [1, 2, 4, 8];
const FIELD_TYPES: { value: FormFieldType; label: MessageKey }[] = [
  { value: "text", label: "editor.fieldText" },
  { value: "multiline", label: "editor.fieldMultiline" },
  { value: "checkbox", label: "editor.fieldCheckbox" },
  { value: "radio", label: "editor.fieldRadio" },
  { value: "dropdown", label: "editor.fieldDropdown" },
  { value: "list", label: "editor.fieldList" },
];
const FIELD_SIZES = [0, 8, 9, 10, 11, 12, 14, 16, 18, 24];

/** Value a field shows when nothing was written in it yet. */
function initialValue(item: FormFieldItem): string | string[] {
  if (item.field === "checkbox" || item.field === "radio") return "Off";
  if (item.field === "dropdown") return item.options?.[0] ?? "";
  if (item.field === "list") return [];
  return "";
}

/** Form widget of a field created in pdfcraft. */
function createdWidget(
  item: FormFieldItem,
  value: string | string[] | undefined,
): PageWidget {
  return {
    key: item.id,
    name: item.name,
    kind: item.field,
    rect: item.rect,
    onState:
      item.field === "checkbox"
        ? item.exportValue || "Yes"
        : item.field === "radio"
          ? item.exportValue
          : undefined,
    value: value ?? initialValue(item),
    options: (item.options ?? []).map((o) => ({ value: o, label: o })),
    readOnly: false,
    maxLength: item.maxLength,
    multiSelect: !!item.multiSelect,
    align: ({ left: 0, center: 1, right: 2 } as const)[item.align],
    style: { ...item.style, bold: false, italic: false },
  };
}

/** The state with an audit page at the end (spec 004, HU7). */
function appendAuditPage(
  state: EditorState,
  documentName: string,
  multi: Pick<typeof import("../sign/multi"), "auditPageText">,
): { state: EditorState; page: number } {
  const first = state.pages[0]!;
  const w = first.box[2] - first.box[0];
  const h = first.box[3] - first.box[1];
  const box: PageEntry["box"] =
    effectiveRotation(first) % 180 === 0 ? [0, 0, w, h] : [0, 0, h, w];
  const page: PageEntry = {
    id: newId("audit"),
    source: { kind: "blank" },
    box,
    baseRotation: 0,
    extraRotation: 0,
  };
  const texts = multi.auditPageText(box, documentName).map((l): TextItem => ({
    kind: "text",
    id: newId("text"),
    pageId: page.id,
    at: { x: l.x, y: l.y },
    text: l.text,
    style: { ...DEFAULT_TEXT_STYLE, size: l.size, bold: l.bold },
    rotate: 0,
  }));
  return {
    state: {
      ...state,
      pages: [...state.pages, page],
      items: [...state.items, ...texts],
    },
    page: state.pages.length,
  };
}

/** Properties of a field created in pdfcraft (spec 005, CA5). */
function FieldPanel({
  field,
  taken,
  onChange,
}: {
  field: FormFieldItem;
  taken: () => Set<string>;
  onChange: (patch: Partial<FormFieldItem>) => void;
}) {
  const t = useT();
  const [name, setName] = useState(field.name);
  const [options, setOptions] = useState((field.options ?? []).join("\n"));
  const nameTaken = name !== field.name && taken().has(name.trim());
  const commitName = () => {
    const next = name.trim();
    if (next && next !== field.name && !taken().has(next))
      onChange({ name: next });
    else setName(field.name);
  };
  const choice = field.field === "dropdown" || field.field === "list";
  const text = field.field === "text" || field.field === "multiline";
  return (
    <div
      className="field-panel"
      role="group"
      aria-label={t("editor.fieldProperties")}
    >
      <label>
        {t("editor.fieldName")}
        <input
          value={name}
          aria-invalid={nameTaken}
          onChange={(e) => setName(e.currentTarget.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </label>
      {(field.field === "checkbox" || field.field === "radio") && (
        <label>
          {t("editor.fieldValue")}
          <input
            defaultValue={field.exportValue ?? ""}
            onBlur={(e) => {
              const value = e.currentTarget.value.trim().replace(/[\s/]/g, "_");
              if (value && value !== field.exportValue)
                onChange({ exportValue: value });
            }}
          />
        </label>
      )}
      {choice && (
        <label>
          {t("editor.fieldOptions")}
          <textarea
            value={options}
            rows={4}
            onChange={(e) => setOptions(e.currentTarget.value)}
            onBlur={() =>
              onChange({
                options: options
                  .split("\n")
                  .map((o) => o.trim())
                  .filter(Boolean),
              })
            }
          />
        </label>
      )}
      {field.field === "list" && (
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={!!field.multiSelect}
            onChange={(e) => onChange({ multiSelect: e.currentTarget.checked })}
          />
          {t("editor.fieldMultiSelect")}
        </label>
      )}
      {(text || choice) && (
        <label>
          {t("editor.fieldAlign")}
          <select
            value={field.align}
            onChange={(e) =>
              onChange({
                align: e.currentTarget.value as FormFieldItem["align"],
              })
            }
          >
            <option value="left">{t("editor.alignLeft")}</option>
            <option value="center">{t("editor.alignCenter")}</option>
            <option value="right">{t("editor.alignRight")}</option>
          </select>
        </label>
      )}
      {field.field === "text" && (
        <>
          <label>
            {t("editor.fieldMaxLength")}
            <input
              type="number"
              min={0}
              max={999}
              value={field.maxLength ?? 0}
              onChange={(e) => {
                const n = Number(e.currentTarget.value);
                onChange({
                  maxLength: n > 0 ? n : undefined,
                  ...(n > 0 ? {} : { comb: false }),
                });
              }}
            />
          </label>
          <label className="toolbar-check">
            <input
              type="checkbox"
              checked={!!field.comb}
              disabled={!field.maxLength}
              onChange={(e) => onChange({ comb: e.currentTarget.checked })}
            />
            {t("editor.fieldComb")}
          </label>
        </>
      )}
      <label className="toolbar-check">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(e) => onChange({ required: e.currentTarget.checked })}
        />
        {t("editor.fieldRequired")}
      </label>
    </div>
  );
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest("input, textarea, select, [contenteditable='true']");

/** Documents opened in this tab: each one counts its features once. */
let openedDocuments = 0;

export function EditorView({
  file,
  doc,
  initial,
  incoming,
  onScan,
  onReplaceBase,
}: EditorViewProps) {
  const t = useT();
  const editor = useEditor(initial);
  const { state, dispatch } = editor;
  const appliedSeq = useRef(incoming?.seq ?? 0);

  // Scanned pages go at the end, as one undoable step.
  useEffect(() => {
    if (!incoming || incoming.seq === appliedSeq.current) return;
    appliedSeq.current = incoming.seq;
    dispatch({
      kind: "insertPages",
      atIndex: Number.MAX_SAFE_INTEGER,
      pages: incoming.pages,
      items: incoming.items,
    });
  }, [incoming, dispatch]);
  // Spec 011: each feature counts once per document opened.
  const [scope] = useState(() => `doc${++openedDocuments}`);
  const counted = useRef(new Set<string>());
  useEffect(() => {
    for (const item of state.items) {
      if (counted.current.has(item.id)) continue;
      counted.current.add(item.id);
      const event = featureOf(item);
      if (event) trackOnce(scope, event);
    }
  }, [state.items, scope]);
  const trackSave = () =>
    track("save_document", {
      pages: pagesBucket(state.pages.length),
      source: file
        ? "file"
        : state.pages.some((p) => p.source.kind === "scan")
          ? "scan"
          : "blank",
    });
  const [ocrOpen, setOcrOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  // Phone layout (spec 007): page thumbnails as a strip, help collapsed.
  const mobile = useMobile();
  // Touch screens: the help says "tap" instead of "click" (spec 009).
  const touch = useTouch();
  const [thumbsOpen, setThumbsOpen] = useState(false);
  const [hintOpenFor, setHintOpenFor] = useState<Tool | null>(null);
  const [adopted, setAdopted] = useState<Adopted>({});
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [looksScanned, setLooksScanned] = useState(false);
  /** A short confirmation that goes away by itself (spec 009). */
  const [toast, setToast] = useState<string | null>(null);
  const [scannedDismissed, setScannedDismissed] = useState(false);

  // CA1: a document whose first pages are images of text is offered OCR.
  const firstPages = state.pages.slice(0, 3);
  useEffect(() => {
    let live = true;
    void Promise.all(firstPages.map((p) => pageIsScanned(doc, p)))
      .then((flags) => {
        if (live) setLooksScanned(flags.some(Boolean));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, firstPages.map((p) => p.id).join()]);
  const hasOcr = state.items.some((i) => i.kind === "ocr");
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  // Digital signatures of the opened file (spec 004, HU8).
  const [signatures, setSignatures] = useState<SignatureReport[]>([]);
  const [signaturesOpen, setSignaturesOpen] = useState(false);
  const [rootsVersion, setRootsVersion] = useState(0);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  // Signatures and signing plans are those of the file as it was opened, even
  // after PDFs are inserted into it (spec 013).
  const [openedFile] = useState(file);
  useEffect(() => {
    if (!openedFile) return;
    let live = true;
    const bytes = openedFile.copyBytes();
    // Loads the verifier only for files that contain signatures.
    if (!/\/ByteRange/.test(new TextDecoder("latin1").decode(bytes))) return;
    void (async () => {
      const [{ verifyPdf }, { trustedRoots }] = await Promise.all([
        import("../sign/verify"),
        import("../sign/SignaturesPanel"),
      ]);
      const roots = (await trustedRoots()).map((r) => r.value.der);
      const reports = await verifyPdf(bytes, roots).catch(() => []);
      if (live) setSignatures(reports);
    })();
    return () => {
      live = false;
    };
  }, [openedFile, rootsVersion]);
  // Several signers (spec 004, HU6): the plan being prepared...
  const [planSigners, setPlanSigners] = useState<PlanSigner[]>([]);
  const [planMode, setPlanMode] = useState<PlanMode>("pades");
  // ...and the plan of the opened file, with the file as last signed here.
  const [filePlan, setFilePlan] = useState<{
    plan: SigningPlan;
    status: SignerStatus[];
    bytes: Uint8Array;
  } | null>(null);
  const [signAsOpen, setSignAsOpen] = useState(false);
  const [signAsId, setSignAsId] = useState<string | null>(null);
  useEffect(() => {
    if (!openedFile) return;
    let live = true;
    const bytes = openedFile.copyBytes();
    if (!/\/PdfcraftSigning/.test(new TextDecoder("latin1").decode(bytes)))
      return;
    void (async () => {
      const { readPlan, planStatus } = await import("../sign/multi");
      const plan = await readPlan(bytes).catch(() => null);
      if (!plan || !live) return;
      const status = await planStatus(bytes, plan);
      if (live) setFilePlan({ plan, status, bytes });
    })();
    return () => {
      live = false;
    };
  }, [openedFile]);
  const signerNames = useMemo(
    () =>
      Object.fromEntries(
        [...planSigners, ...(filePlan?.plan.signers ?? [])].map((s) => [
          s.id,
          s.name,
        ]),
      ),
    [planSigners, filePlan],
  );
  const placedFields = useMemo(() => {
    const out: Record<string, SignFieldType[]> = {};
    for (const i of state.items)
      if (i.kind === "signField") (out[i.signerId] ??= []).push(i.field);
    return out;
  }, [state.items]);
  const [notice, setNotice] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textStyle, setTextStyle] = useState<TextStyle>(DEFAULT_TEXT_STYLE);
  const [annotationColor, setAnnotationColor] = useState("#d9480f");
  const [highlightColor, setHighlightColor] = useState("#ffd400");
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [pendingImage, setPendingImage] = useState<LoadedImage | null>(null);
  const [draft, setDraft] = useState<TextDraft | null>(null);
  const [noteColor, setNoteColor] = useState("#ffd400");
  const [fillColor, setFillColor] = useState<string | null>(null);
  const [lastFill, setLastFill] = useState("#a5d8ff");
  const [fieldType, setFieldType] = useState<FormFieldType>("text");
  const [fieldStyle, setFieldStyle] = useState<FormFieldItem["style"]>({
    font: "Helvetica",
    size: 0,
    color: "#000000",
  });
  const [flattenForms, setFlattenForms] = useState(false);
  // Form fields and annotations of the opened file (spec 005).
  const [docInfo, setDocInfo] = useState<DocInfo>(EMPTY_DOC_INFO);
  useEffect(() => {
    if (!file) return;
    let live = true;
    const text = new TextDecoder("latin1").decode(file.copyBytes());
    if (!/\/(AcroForm|Annots)\b/.test(text)) return;
    void import("./docInfo")
      .then((m) => m.readDocInfo(file))
      .then((info) => {
        if (live) setDocInfo(info);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [file]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textCache = useRef(new Map<number, Promise<TextBox[]>>());

  /** Text of an original page, extracted once with pdf.js. */
  const textBoxesFor = useCallback(
    (entry: PageEntry): Promise<TextBox[]> => {
      if (entry.source.kind !== "original" || !doc) return Promise.resolve([]);
      const index = entry.source.index;
      let boxes = textCache.current.get(index);
      if (!boxes) {
        boxes = doc
          .getPage(index + 1)
          .then((page) => page.getTextContent())
          .then(textBoxes);
        textCache.current.set(index, boxes);
      }
      return boxes;
    },
    [doc],
  );

  /** Color, weight and style of page text, read with pdf-lib on demand. */
  const probeStyleFor = useCallback(
    (entry: PageEntry, box: TextBox) => {
      if (entry.source.kind !== "original" || !file)
        return Promise.resolve(null);
      const index = entry.source.index;
      return import("./textStyleProbe").then((m) =>
        m.probeTextStyle(file, index, box),
      );
    },
    [file],
  );

  // Spec 010: the page as pixels, for edits of scanned text (one at a time).
  const pixelCache = useRef<{
    key: string;
    pixels: Promise<PagePixels>;
  } | null>(null);
  const pagePixelsFor = useCallback(
    (entry: PageEntry): Promise<PagePixels> => {
      const key = `${entry.id}:${effectiveRotation(entry)}`;
      if (pixelCache.current?.key !== key)
        pixelCache.current = {
          key,
          pixels: import("../ocr/recognize").then((m) =>
            m.pageImage(doc, entry),
          ),
        };
      return pixelCache.current.pixels;
    },
    [doc],
  );
  const [needOcr, setNeedOcr] = useState(false);

  /** The page rendered with its text edits by the save engine (CA3b). */
  const renderEditsFor = useCallback(
    (entry: PageEntry, edits: Item[], zoom: number) =>
      file
        ? import("./pagePreview").then((m) =>
            m.renderEditedPage(file, entry, edits, zoom),
          )
        : Promise.resolve(null),
    [file],
  );

  /** Current value of each field: the last one written, by name. */
  const formValues = useMemo(() => {
    const map = new Map<string, string | string[]>();
    for (const i of state.items)
      if (i.kind === "formValue") map.set(i.name, i.value);
    return map;
  }, [state.items]);
  const createdFields = useMemo(
    () => state.items.filter((i): i is FormFieldItem => i.kind === "formField"),
    [state.items],
  );
  const fieldNames = useCallback(
    () =>
      new Set([
        ...docInfo.fields.map((f) => f.name),
        ...createdFields.map((f) => f.name),
      ]),
    [docInfo, createdFields],
  );
  const hasForm = docInfo.fields.length > 0 || createdFields.length > 0;

  /** Widgets of a page: those of the file and those created here. */
  const widgetsFor = useCallback(
    (entry: PageEntry): PageWidget[] => {
      const index = entry.source.kind === "original" ? entry.source.index : -1;
      const out: PageWidget[] = [];
      for (const field of docInfo.fields) {
        if (
          field.kind === "signature" ||
          field.kind === "button" ||
          field.kind === "password"
        )
          continue;
        for (const w of field.widgets)
          if (w.pageIndex === index && index >= 0 && !w.hidden)
            out.push({
              key: w.ref || `${field.name}-${out.length}`,
              name: field.name,
              kind: field.kind,
              rect: w.rect,
              onState: w.onState,
              value: formValues.get(field.name) ?? field.value,
              options: field.options,
              readOnly: field.readOnly,
              maxLength: field.maxLength,
              multiSelect: field.multiSelect,
              align: field.align,
              style: field.style,
            });
      }
      for (const item of createdFields)
        if (item.pageId === entry.id)
          out.push(createdWidget(item, formValues.get(item.name)));
      return out;
    },
    [docInfo, createdFields, formValues],
  );

  /** Annotations of the file, with the page id of where they are now. */
  const existingById = useMemo(() => {
    const map = new Map<string, AnnotationItem | null>();
    docInfo.annots.forEach((list, index) => {
      const pageId = state.pages.find(
        (p) => p.source.kind === "original" && p.source.index === index,
      )?.id;
      if (!pageId) return;
      for (const e of list)
        map.set(
          existingItemId(e.source),
          e.item ? { ...e.item, pageId } : null,
        );
    });
    return map;
  }, [docInfo, state.pages]);
  const sourceOf = (id: string) =>
    docInfo.annots.flat().find((e) => existingItemId(e.source) === id)?.source;

  const selected: Item | null =
    state.items.find((i) => i.id === selectedId) ??
    (selectedId ? existingById.get(selectedId) : null) ??
    null;
  const selectedInState =
    !!selected && state.items.some((i) => i.id === selected.id);

  /** Changes the selected annotation (adopting it if it is from the file). */
  const updateSelectedAnnotation = (patch: Partial<AnnotationItem>) => {
    if (selected?.kind !== "annotation") return;
    const item = { ...selected, ...patch };
    // An annotation of the file is only adopted when it really changes.
    if (
      Object.entries(patch).every(
        ([k, v]) => selected[k as keyof AnnotationItem] === v,
      )
    )
      return;
    dispatch(
      selectedInState
        ? { kind: "updateItem", item }
        : { kind: "addItem", item },
    );
  };

  const updateSelectedField = (patch: Partial<FormFieldItem>) => {
    if (selected?.kind !== "formField") return;
    const ops = state.items
      .filter(
        (i): i is FormFieldItem =>
          i.kind === "formField" &&
          (i.id === selected.id ||
            // Renaming a radio button renames its group.
            (patch.name !== undefined &&
              selected.field === "radio" &&
              i.field === "radio" &&
              i.name === selected.name)),
      )
      .map((i) => ({
        kind: "updateItem" as const,
        item:
          i.id === selected.id
            ? { ...i, ...patch }
            : { ...i, name: patch.name! },
      }));
    dispatch(ops);
  };

  /** Removes the selection; an annotation of the file is removed from it. */
  const removeSelected = () => {
    if (!selectedId) return;
    const item = state.items.find((i) => i.id === selectedId);
    const source =
      item?.kind === "annotation"
        ? item.source
        : item
          ? undefined
          : sourceOf(selectedId);
    const removal: Item[] = source
      ? [
          {
            kind: "annotRemoval",
            id: newId("removal"),
            pageId: item?.pageId ?? pageOfExisting(selectedId),
            source,
          },
        ]
      : [];
    dispatch([
      ...(item ? [{ kind: "removeItem" as const, itemId: item.id }] : []),
      ...removal.map((r) => ({ kind: "addItem" as const, item: r })),
    ]);
    setSelectedId(null);
  };
  const pageOfExisting = (id: string) => {
    const index = docInfo.annots.findIndex((list) =>
      list.some((e) => existingItemId(e.source) === id),
    );
    return (
      state.pages.find(
        (p) => p.source.kind === "original" && p.source.index === index,
      )?.id ?? state.pages[0]!.id
    );
  };

  const chooseTool = (next: Tool) => {
    setDraft(null);
    if (next !== "select") setSelectedId(null);
    if (next === "image") {
      imageInputRef.current?.click();
      return;
    }
    setPendingImage(null);
    setPlacing(null);
    setTool(next);
  };

  const onImageChosen = async (chosen: File | undefined) => {
    if (!chosen) return;
    try {
      setPendingImage(await loadImageFile(chosen));
      setTool("image");
    } catch {
      setNotice(t("editor.imageUnreadable"));
    }
  };

  // Supr/Retroceso removes the selection; Esc clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        removeSelected();
      } else if (e.key === "Escape") {
        setSelectedId(null);
        if (tool === "image" || tool === "place") chooseTool("select");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // With the select tool, clicking empty page space clears the selection.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      // Tools and items call preventDefault when they handle the pointer.
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest(".pages")) setSelectedId(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const updateTextStyle = (change: Partial<TextStyle>) => {
    const next = { ...textStyle, ...change };
    setTextStyle(next);
    if (selected?.kind === "text")
      dispatch({
        kind: "updateItem",
        item: { ...selected, style: { ...selected.style, ...change } },
      });
  };

  // Spec 013: other PDFs go at the end, as one undoable step.
  const insertInputRef = useRef<HTMLInputElement>(null);
  const [inserting, setInserting] = useState(false);
  const insertPdfs = async (chosen: File[]) => {
    if (chosen.length === 0 || !onReplaceBase) return;
    setInserting(true);
    setNotice(null);
    try {
      const others = await Promise.all(chosen.map(openPdfFile));
      const { appendPdfs } = await import("../engine/organize");
      const { bytes, added } = await appendPdfs(
        file?.copyBytes() ?? new Uint8Array(),
        others.map((o) => ({ name: o.name, bytes: o.copyBytes() })),
      );
      const merged = createPdfFile(file?.name ?? others[0]!.name, bytes);
      const loaded = await onReplaceBase(merged);
      const pages: PageEntry[] = [];
      for (const { start, count } of added)
        for (let index = start; index < start + count; index++) {
          const page = await loaded.getPage(index + 1);
          const [x0, y0, x1, y1] = page.view as [
            number,
            number,
            number,
            number,
          ];
          pages.push({
            id: newId("page"),
            source: { kind: "original", index },
            box: [x0, y0, x1, y1],
            baseRotation: normalizeRotation(page.rotate),
            extraRotation: 0,
          });
        }
      dispatch({
        kind: "insertPages",
        atIndex: Number.MAX_SAFE_INTEGER,
        pages,
      });
      setToast(t("organize.inserted", pages.length));
      track("merge_pdf", {
        files: filesBucket(chosen.length + 1),
        pages: pagesBucket(pages.length),
      });
    } catch (cause) {
      setNotice(
        t(
          "organize.insertFailed",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    } finally {
      setInserting(false);
    }
  };
  const chooseInsert = () => insertInputRef.current?.click();

  const [splitOpen, setSplitOpen] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const baseName = (file?.name ?? t("editor.defaultBaseName")).replace(
    /\.pdf$/i,
    "",
  );
  /** The document as it would be saved, cut into one file per group. */
  const splitDocument = async (groups: number[][], mode: SplitMode) => {
    setSplitting(true);
    setNotice(null);
    try {
      const [{ buildPdf, downloadFile }, { splitPdf }, { describeGroup }] =
        await Promise.all([
          import("./save"),
          import("../engine/organize"),
          import("../engine/pageRanges"),
        ]);
      const { bytes, warnings } = await buildPdf(file, state, {
        flattenForms: flattenForms && hasForm,
      });
      const parts = await splitPdf(bytes, groups);
      const taken = new Set<string>();
      const named = parts.map((part, i) => {
        const stem = `${baseName} (${t("organize.pagesSuffix", describeGroup(groups[i]!))})`;
        let name = `${stem}.pdf`;
        for (let k = 2; taken.has(name); k++) name = `${stem} ${k}.pdf`;
        taken.add(name);
        return { name, bytes: part };
      });
      if (named.length === 1)
        downloadFile(named[0]!.bytes, named[0]!.name, "application/pdf");
      else {
        const { zip } = await import("../storage/zip");
        downloadFile(
          zip(named),
          `${baseName} (${t("organize.partsSuffix")}).zip`,
          "application/zip",
        );
      }
      track("split_pdf", {
        split: mode,
        pages: pagesBucket(state.pages.length),
      });
      if (warnings.length === 0)
        setToast(t("organize.splitDone", named.length));
      else
        setNotice(
          [t("organize.splitDone", named.length), ...warnings].join(" "),
        );
    } catch (cause) {
      setNotice(
        t(
          "organize.splitFailed",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    } finally {
      setSplitting(false);
    }
  };

  const save = async (overwrite = false) => {
    // CA12: rewriting the file breaks its digital signatures.
    if (signatures.length > 0 && !overwrite) {
      setConfirmOverwrite(true);
      return;
    }
    setConfirmOverwrite(false);
    setSaving(true);
    setNotice(null);
    try {
      // The engine (pdf-lib, fontkit) loads only when saving.
      const { buildPdf, downloadPdf, editedFileName } = await import("./save");
      const { bytes, warnings } = await buildPdf(file, state, {
        flattenForms: flattenForms && hasForm,
      });
      downloadPdf(bytes, editedFileName(file?.name ?? null));
      trackSave();
      if (warnings.length === 0) setToast(t("editor.saved"));
      else setNotice([t("editor.saved"), ...warnings].join(" "));
    } catch (cause) {
      setNotice(
        t(
          "editor.saveFailed",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  /** Saves with the signatures flattened, or signed with PAdES (spec 004). */
  const saveSigned = async (
    mode: SaveMode,
    identity: Identity | null,
    { audit }: { audit: boolean },
  ) => {
    setSigning(true);
    setNotice(null);
    try {
      const { buildPdf, downloadPdf, loadFont, signedFileName } =
        await import("./save");
      const multi = audit ? await import("../sign/multi") : null;
      // HU7: the audit page goes at the end; its row is added once the
      // document is final, with the hash of the file as signed.
      const withAudit = multi
        ? appendAuditPage(
            state,
            file?.name ?? t("editor.defaultFileName"),
            multi,
          )
        : null;
      const base = withAudit?.state ?? state;
      const date = new Date();
      const auditStep = async (
        bytes: Uint8Array,
        name: string,
        email?: string,
        fingerprint?: string,
      ) =>
        multi && withAudit
          ? multi.auditRowStep(
              withAudit.page,
              {
                index: 0,
                name,
                email,
                date,
                mode: identity && mode === "digital" ? "pades" : "visual",
                certificateFingerprint: fingerprint,
                documentHash: await multi.sha256Hex(bytes),
              },
              loadFont,
            )
          : undefined;
      if (mode === "visual" || !identity) {
        const built = await buildPdf(file, base);
        const { warnings } = built;
        let { bytes } = built;
        if (multi && withAudit) {
          const signature = state.items.find(
            (i): i is SignatureItem => i.kind === "signature",
          );
          const name =
            signature?.asset.kind === "typed"
              ? signature.asset.text
              : t("editor.defaultSigner");
          bytes = await multi.withAuditRow(
            bytes,
            withAudit.page,
            {
              index: 0,
              name,
              date,
              mode: "visual",
              documentHash: await multi.sha256Hex(bytes),
            },
            loadFont,
          );
        }
        downloadPdf(bytes, signedFileName(file?.name ?? null));
        trackSave();
        if (warnings.length === 0) setToast(t("editor.savedVisual"));
        else setNotice([t("editor.savedVisual"), ...warnings].join(" "));
        return;
      }
      // The signature to use as the appearance of the digital signature: the
      // selected one, or the first placed. The rest is flattened as usual.
      const isSignature = (i: Item): i is SignatureItem =>
        i.kind === "signature" && i.role === "signature";
      const chosen =
        (selected && isSignature(selected) ? selected : null) ??
        state.items.find(isSignature) ??
        null;
      const { bytes } = await buildPdf(file, {
        ...base,
        items: base.items.filter((i) => i !== chosen),
      });
      const [{ signPdf }, { certificateInfo }] = await Promise.all([
        import("../sign/pades"),
        import("../sign/certificates"),
      ]);
      const info = await certificateInfo(identity.certificate);
      const signed = await signPdf(bytes, {
        identity,
        appearance: chosen
          ? {
              page: state.pages.findIndex((p) => p.id === chosen.pageId),
              rect: chosen.rect,
              rotate: chosen.rotate,
              asset: chosen.asset,
            }
          : undefined,
        name: info.subject,
        contactInfo: info.email,
        date,
        loadFont,
        prepare: await auditStep(
          bytes,
          info.subject,
          info.email,
          info.fingerprint,
        ),
      });
      downloadPdf(signed, signedFileName(file?.name ?? null));
      trackSave();
      setNotice(
        chosen ? t("editor.savedDigital") : t("editor.savedDigitalInvisible"),
      );
    } catch (cause) {
      setNotice(
        t(
          "editor.signFailed",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    } finally {
      setSigning(false);
    }
  };

  /** Saves the document prepared for several signers (spec 004, HU6). */
  const preparePlanFile = async (withAudit: boolean) => {
    setSigning(true);
    setNotice(null);
    try {
      const [{ buildPdf, downloadPdf, preparedFileName }, multi] =
        await Promise.all([import("./save"), import("../sign/multi")]);
      const signerIds = new Set(planSigners.map((s) => s.id));
      const fields = state.items.filter(
        (i): i is SignFieldItem =>
          i.kind === "signField" && signerIds.has(i.signerId),
      );
      const withoutFields: EditorState = {
        ...state,
        items: state.items.filter((i) => i.kind !== "signField"),
      };
      const audit = withAudit
        ? appendAuditPage(
            withoutFields,
            file?.name ?? t("editor.defaultFileName"),
            multi,
          )
        : null;
      const auditPage = audit?.page ?? null;
      const plan: SigningPlan = {
        version: 1,
        mode: planMode,
        auditPage,
        signers: planSigners.map((s) => ({
          ...s,
          name: s.name.trim(),
          email: s.email?.trim() || undefined,
        })),
        fields: fields.map((f) => ({
          id: f.id,
          page: state.pages.findIndex((p) => p.id === f.pageId),
          rect: f.rect,
          type: f.field,
          signerId: f.signerId,
        })),
      };
      const { bytes, warnings } = await buildPdf(
        file,
        audit?.state ?? withoutFields,
      );
      const prepared = await multi.preparePlan(bytes, plan);
      downloadPdf(prepared, preparedFileName(file?.name ?? null));
      trackSave();
      const first = Math.min(...plan.signers.map((s) => s.order));
      setNotice(
        [
          t(
            "editor.preparedSendTo",
            plan.signers
              .filter((s) => s.order === first)
              .map((s) => s.name)
              .join(t("editor.namesAnd")),
          ),
          ...warnings,
        ].join(" "),
      );
    } catch (cause) {
      setNotice(
        t(
          "editor.prepareFailed",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    } finally {
      setSigning(false);
    }
  };

  /** Signs the opened plan as one of its signers (spec 004, CA9). */
  const signAs = async (
    signerId: string,
    texts: Record<string, string>,
    identity: StoredIdentity | null,
  ) => {
    if (!filePlan) return;
    setSigning(true);
    setNotice(null);
    try {
      const [{ downloadPdf, loadFont, signedFileName }, multi] =
        await Promise.all([import("./save"), import("../sign/multi")]);
      const signed = await multi.signAsSigner(filePlan.bytes, {
        plan: filePlan.plan,
        signerId,
        assets: adopted,
        texts,
        identity: identity ?? undefined,
        formatDate: (d) => formatDate(d, "dmy"),
        loadFont,
      });
      downloadPdf(signed, signedFileName(file?.name ?? null));
      trackSave();
      const status = await multi.planStatus(signed, filePlan.plan);
      setFilePlan({ plan: filePlan.plan, status, bytes: signed });
      setSignAsOpen(false);
      setSignAsId(null);
      const next = status.filter((s) => s.canSign).map((s) => s.signer.name);
      setNotice(
        next.length > 0
          ? t("editor.signedSendTo", next.join(t("editor.namesAnd")))
          : t("editor.signedAllDone"),
      );
    } catch (cause) {
      setNotice(
        t(
          "editor.signFailed",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    } finally {
      setSigning(false);
    }
  };

  /** Fields of the signer about to sign, outlined on their pages. */
  const signAsFields = useMemo(
    () =>
      signAsOpen && filePlan
        ? filePlan.plan.fields.filter((f) => f.signerId === signAsId)
        : [],
    [signAsOpen, filePlan, signAsId],
  );

  /**
   * Items of a page, plus the values of fields with a widget on it (a field
   * can have widgets on several pages).
   */
  const pageItems = useCallback(
    (entry: PageEntry) => {
      const names = new Set(widgetsFor(entry).map((w) => w.name));
      return state.items.filter(
        (i) =>
          i.pageId === entry.id ||
          (i.kind === "formValue" && names.has(i.name)),
      );
    },
    [state.items, widgetsFor],
  );

  const renderOverlay = useCallback(
    (entry: PageEntry, geometry: PageGeometry) => (
      <EditLayer
        entry={entry}
        geometry={geometry}
        items={pageItems(entry)}
        tool={tool}
        selectedId={selectedId}
        onSelect={setSelectedId}
        dispatch={dispatch}
        textStyle={textStyle}
        annotationColor={annotationColor}
        highlightColor={highlightColor}
        strokeWidth={strokeWidth}
        pendingImage={pendingImage}
        onImagePlaced={() => {
          setPendingImage(null);
          setTool("select");
        }}
        placing={placing}
        onPlaced={() => {
          setPlacing(null);
          setTool("select");
        }}
        signerNames={signerNames}
        draft={draft}
        onDraft={setDraft}
        textBoxes={textBoxesFor.bind(null, entry)}
        probeStyle={probeStyleFor.bind(null, entry)}
        renderEdits={renderEditsFor.bind(null, entry)}
        existing={
          entry.source.kind === "original"
            ? docInfo.annots[entry.source.index]
            : undefined
        }
        widgets={widgetsFor(entry)}
        onFormValue={(name, value) =>
          dispatch({
            kind: "addItem",
            item: {
              kind: "formValue",
              id: newId("value"),
              pageId: entry.id,
              name,
              value,
            },
          })
        }
        fieldType={fieldType}
        fieldStyle={fieldStyle}
        fieldNames={fieldNames}
        noteColor={noteColor}
        fillColor={fillColor}
        showOcrLow={ocrOpen}
        pagePixels={pagePixelsFor.bind(null, entry)}
        onNeedOcr={() => setNeedOcr(true)}
      >
        {signAsFields
          .filter(
            (f) =>
              entry.source.kind === "original" && entry.source.index === f.page,
          )
          .map((f) => {
            const v = geometry.rectToView(f.rect);
            return (
              <div
                key={f.id}
                className="plan-field"
                data-testid="plan-field"
                style={{
                  left: v.x,
                  top: v.y,
                  width: v.width,
                  height: v.height,
                }}
              >
                {signFieldLabel(f.type)}
              </div>
            );
          })}
      </EditLayer>
    ),
    [
      tool,
      selectedId,
      dispatch,
      textStyle,
      annotationColor,
      highlightColor,
      strokeWidth,
      pendingImage,
      placing,
      draft,
      textBoxesFor,
      probeStyleFor,
      renderEditsFor,
      signerNames,
      signAsFields,
      docInfo,
      widgetsFor,
      fieldType,
      fieldStyle,
      fieldNames,
      noteColor,
      fillColor,
      pageItems,
      ocrOpen,
      pagePixelsFor,
    ],
  );

  const pageCount = state.pages.length;
  const renderPageActions = (entry: PageEntry, index: number) => {
    const n = index + 1;
    const blankBox = (): PageEntry["box"] => {
      const w = entry.box[2] - entry.box[0];
      const h = entry.box[3] - entry.box[1];
      return effectiveRotation(entry) % 180 === 0 ? [0, 0, w, h] : [0, 0, h, w];
    };
    return (
      <div className="page-actions">
        <button
          type="button"
          aria-label={t("editor.rotateLeftPage", n)}
          title={t("editor.rotateLeft")}
          onClick={() =>
            dispatch({ kind: "rotatePage", pageId: entry.id, degrees: -90 })
          }
        >
          ⟲
        </button>
        <button
          type="button"
          aria-label={t("editor.rotateRightPage", n)}
          title={t("editor.rotateRight")}
          onClick={() =>
            dispatch({ kind: "rotatePage", pageId: entry.id, degrees: 90 })
          }
        >
          ⟳
        </button>
        <button
          type="button"
          aria-label={t("editor.moveUpPage", n)}
          title={t("editor.moveUp")}
          disabled={index === 0}
          onClick={() =>
            dispatch({ kind: "movePage", pageId: entry.id, toIndex: index - 1 })
          }
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={t("editor.moveDownPage", n)}
          title={t("editor.moveDown")}
          disabled={index === pageCount - 1}
          onClick={() =>
            dispatch({ kind: "movePage", pageId: entry.id, toIndex: index + 1 })
          }
        >
          ↓
        </button>
        <button
          type="button"
          aria-label={t("editor.insertBlankAfterPage", n)}
          title={t("editor.insertBlankAfter")}
          onClick={() =>
            dispatch({
              kind: "insertBlankPage",
              atIndex: index + 1,
              pageId: newId("blank"),
              box: blankBox(),
            })
          }
        >
          +
        </button>
        <button
          type="button"
          aria-label={t("editor.deletePageN", n)}
          title={t("editor.deletePage")}
          disabled={pageCount === 1}
          onClick={() => dispatch({ kind: "deletePage", pageId: entry.id })}
        >
          ✕
        </button>
      </div>
    );
  };

  const showTextStyle =
    tool === "text" ||
    tool === "freeText" ||
    selected?.kind === "text" ||
    (draft !== null && !draft.replace);
  const shownStyle = selected?.kind === "text" ? selected.style : textStyle;
  const selectedAnnotation = selected?.kind === "annotation" ? selected : null;
  const strokeShape =
    selectedAnnotation &&
    ["ink", "line", "arrow", "square", "circle"].includes(
      selectedAnnotation.shape,
    );
  const showStroke =
    tool === "ink" ||
    tool === "line" ||
    tool === "arrow" ||
    tool === "square" ||
    tool === "circle" ||
    tool === "underline" ||
    tool === "strikeout" ||
    !!strokeShape;
  const showFill =
    tool === "square" ||
    tool === "circle" ||
    selectedAnnotation?.shape === "square" ||
    selectedAnnotation?.shape === "circle";
  const shownFill = selectedAnnotation
    ? (selectedAnnotation.fill ?? null)
    : fillColor;
  const selectedField = selected?.kind === "formField" ? selected : null;
  const shownFieldStyle = selectedField?.style ?? fieldStyle;
  const updateFieldStyle = (patch: Partial<FormFieldItem["style"]>) => {
    setFieldStyle({ ...fieldStyle, ...patch });
    if (selectedField)
      updateSelectedField({ style: { ...selectedField.style, ...patch } });
  };

  const historyButtons = (
    <>
      <button
        type="button"
        onClick={editor.undo}
        disabled={!editor.canUndo}
        aria-label={t("editor.undo")}
        title={t("editor.undoHint")}
      >
        ↶
      </button>
      <button
        type="button"
        onClick={editor.redo}
        disabled={!editor.canRedo}
        aria-label={t("editor.redo")}
        title={t("editor.redoHint")}
      >
        ↷
      </button>
      <button
        type="button"
        className="primary"
        onClick={() => void save()}
        disabled={saving}
      >
        {saving ? t("editor.saving") : t("editor.savePdf")}
      </button>
    </>
  );

  const flattenCheck = hasForm && (
    <label className="toolbar-group toolbar-check">
      <input
        type="checkbox"
        checked={flattenForms}
        onChange={(e) => setFlattenForms(e.currentTarget.checked)}
      />
      {t("editor.flattenForm")}
    </label>
  );

  const insertInput = (
    <input
      ref={insertInputRef}
      type="file"
      accept="application/pdf,.pdf"
      multiple
      hidden
      data-testid="insert-pdf"
      onChange={(e) => {
        void insertPdfs([...(e.currentTarget.files ?? [])]);
        e.currentTarget.value = "";
      }}
    />
  );

  const thumbnailsHeader = (
    <div className="thumbnails-header">
      <button
        type="button"
        title={t("organize.insertHint")}
        disabled={inserting || !onReplaceBase}
        onClick={chooseInsert}
      >
        {inserting ? t("organize.inserting") : t("organize.insert")}
      </button>
      <button
        type="button"
        title={t("organize.splitHint")}
        aria-pressed={splitOpen}
        onClick={() => setSplitOpen((o) => !o)}
      >
        {t("organize.split")}
      </button>
      <small>{t("organize.dragHint")}</small>
    </div>
  );

  const imageInput = (
    <input
      ref={imageInputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      hidden
      data-testid="image-input"
      onChange={(e) => {
        void onImageChosen(e.currentTarget.files?.[0]);
        e.currentTarget.value = "";
      }}
    />
  );

  const hintOpen = hintOpenFor === tool;

  const hasOptions =
    tool === "redact" ||
    showTextStyle ||
    tool === "highlight" ||
    tool === "note" ||
    !!selectedAnnotation ||
    showStroke ||
    tool === "formField" ||
    !!selectedField;

  const options = (
    <>
      {tool === "redact" && (
        <RedactOptions file={file} state={state} dispatch={dispatch} />
      )}
      {showTextStyle && (
        <span
          className="toolbar-group"
          role="group"
          aria-label={t("editor.textStyle")}
        >
          <select
            aria-label={t("editor.font")}
            value={shownStyle.font}
            onChange={(e) =>
              updateTextStyle({ font: e.currentTarget.value as FontFamily })
            }
          >
            {FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            aria-label={t("editor.size")}
            min={4}
            max={200}
            value={shownStyle.size}
            onChange={(e) => {
              const size = Number(e.currentTarget.value);
              if (size >= 4 && size <= 200) updateTextStyle({ size });
            }}
          />
          <input
            type="color"
            aria-label={t("editor.textColor")}
            value={shownStyle.color}
            onChange={(e) => updateTextStyle({ color: e.currentTarget.value })}
          />
          <button
            type="button"
            aria-label={t("editor.bold")}
            aria-pressed={shownStyle.bold}
            onClick={() => updateTextStyle({ bold: !shownStyle.bold })}
          >
            <b>{t("editor.boldIcon")}</b>
          </button>
          <button
            type="button"
            aria-label={t("editor.italic")}
            aria-pressed={shownStyle.italic}
            onClick={() => updateTextStyle({ italic: !shownStyle.italic })}
          >
            <i>{t("editor.italicIcon")}</i>
          </button>
        </span>
      )}
      {tool === "highlight" && (
        <span className="toolbar-group">
          <input
            type="color"
            aria-label={t("editor.highlightColor")}
            value={highlightColor}
            onChange={(e) => setHighlightColor(e.currentTarget.value)}
          />
        </span>
      )}
      {tool === "note" && (
        <span className="toolbar-group">
          <input
            type="color"
            aria-label={t("editor.noteColor")}
            value={noteColor}
            onChange={(e) => setNoteColor(e.currentTarget.value)}
          />
        </span>
      )}
      {selectedAnnotation && !strokeShape && (
        <span
          className="toolbar-group"
          role="group"
          aria-label={t("editor.annotation")}
        >
          <input
            type="color"
            aria-label={t("editor.annotationColor")}
            value={selectedAnnotation.color}
            onChange={(e) =>
              updateSelectedAnnotation({ color: e.currentTarget.value })
            }
          />
        </span>
      )}
      {showStroke && (
        <span
          className="toolbar-group"
          role="group"
          aria-label={t("editor.stroke")}
        >
          <input
            type="color"
            aria-label={t("editor.strokeColor")}
            value={strokeShape ? selectedAnnotation!.color : annotationColor}
            onChange={(e) => {
              const color = e.currentTarget.value;
              setAnnotationColor(color);
              if (strokeShape) updateSelectedAnnotation({ color });
            }}
          />
          {tool !== "underline" && tool !== "strikeout" && (
            <select
              aria-label={t("editor.strokeWidth")}
              value={strokeShape ? selectedAnnotation!.width : strokeWidth}
              onChange={(e) => {
                const width = Number(e.currentTarget.value);
                setStrokeWidth(width);
                if (strokeShape) updateSelectedAnnotation({ width });
              }}
            >
              {[
                ...new Set([
                  ...STROKE_WIDTHS,
                  strokeShape ? selectedAnnotation!.width : strokeWidth,
                ]),
              ]
                .sort((a, b) => a - b)
                .map((w) => (
                  <option key={w} value={w}>
                    {t("editor.points", w)}
                  </option>
                ))}
            </select>
          )}
          {showFill && (
            <>
              <label className="toolbar-check">
                <input
                  type="checkbox"
                  checked={shownFill !== null}
                  onChange={(e) => {
                    const fill = e.currentTarget.checked ? lastFill : null;
                    if (selectedAnnotation)
                      updateSelectedAnnotation({ fill: fill ?? undefined });
                    else setFillColor(fill);
                  }}
                />
                {t("editor.fill")}
              </label>
              {shownFill !== null && (
                <input
                  type="color"
                  aria-label={t("editor.fillColor")}
                  value={shownFill}
                  onChange={(e) => {
                    const fill = e.currentTarget.value;
                    setLastFill(fill);
                    if (selectedAnnotation) updateSelectedAnnotation({ fill });
                    else setFillColor(fill);
                  }}
                />
              )}
            </>
          )}
        </span>
      )}
      {(tool === "formField" || selectedField) && (
        <span
          className="toolbar-group"
          role="group"
          aria-label={t("editor.field")}
        >
          {tool === "formField" && (
            <select
              aria-label={t("editor.fieldType")}
              value={fieldType}
              onChange={(e) =>
                setFieldType(e.currentTarget.value as FormFieldType)
              }
            >
              {FIELD_TYPES.map((f) => (
                <option key={f.value} value={f.value}>
                  {t(f.label)}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label={t("editor.fieldFont")}
            value={shownFieldStyle.font}
            onChange={(e) =>
              updateFieldStyle({ font: e.currentTarget.value as FontFamily })
            }
          >
            {FONTS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            aria-label={t("editor.fieldSize")}
            value={shownFieldStyle.size}
            onChange={(e) =>
              updateFieldStyle({ size: Number(e.currentTarget.value) })
            }
          >
            {[...new Set([...FIELD_SIZES, shownFieldStyle.size])]
              .sort((a, b) => a - b)
              .map((s) => (
                <option key={s} value={s}>
                  {s === 0 ? t("editor.fieldSizeAuto") : t("editor.points", s)}
                </option>
              ))}
          </select>
          <input
            type="color"
            aria-label={t("editor.fieldColor")}
            value={shownFieldStyle.color}
            onChange={(e) => updateFieldStyle({ color: e.currentTarget.value })}
          />
        </span>
      )}
    </>
  );

  const toolbar = (
    <>
      <span className="toolbar-group">
        {historyButtons}
        <button
          type="button"
          aria-pressed={signOpen}
          title={t("editor.signHint")}
          onClick={() => setSignOpen((o) => !o)}
        >
          {t("editor.sign")}
        </button>
        <button
          type="button"
          aria-pressed={ocrOpen}
          title={t("editor.ocrHint")}
          onClick={() => setOcrOpen((o) => !o)}
        >
          {t("editor.ocr")}
        </button>
      </span>
      <span
        className="toolbar-group tools"
        role="group"
        aria-label={t("editor.tools")}
      >
        {TOOLS.map(({ tool: id, label, icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={tool === id}
            aria-label={label}
            title={label}
            onClick={() => chooseTool(id)}
          >
            <span aria-hidden="true">{icon}</span>
          </button>
        ))}
      </span>
      {options}
      {flattenCheck}
    </>
  );

  return (
    <>
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      {(notice || editor.error) && (
        <div className="notice" role="status">
          <span>{editor.error ?? notice}</span>
          <button
            type="button"
            aria-label={t("editor.closeNotice")}
            onClick={() => {
              setNotice(null);
              editor.clearError();
            }}
          >
            ×
          </button>
        </div>
      )}
      {confirmOverwrite && (
        <div
          className="notice warning"
          role="alertdialog"
          aria-label={t("editor.signatures")}
        >
          <span>{t("editor.overwriteSigned")}</span>
          <button type="button" onClick={() => void save(true)}>
            {t("editor.saveAnyway")}
          </button>
          <button type="button" onClick={() => setConfirmOverwrite(false)}>
            {t("editor.cancel")}
          </button>
        </div>
      )}
      {signatures.length > 0 && !signaturesOpen && (
        <div className="notice" role="status" data-testid="signed-notice">
          <span>
            {signatures.length === 1
              ? t("editor.oneSignature")
              : t("editor.manySignatures", signatures.length)}{" "}
            {signatures.some(
              (s) => s.integrity !== "valid" || s.laterChanges === "modified",
            )
              ? t("editor.someInvalid")
              : t("editor.allIntact")}
          </span>
          <button type="button" onClick={() => setSignaturesOpen(true)}>
            {t("editor.viewSignatures")}
          </button>
        </div>
      )}
      {signaturesOpen && (
        <SignaturesPanel
          reports={signatures}
          onRootsChanged={() => setRootsVersion((v) => v + 1)}
          onClose={() => setSignaturesOpen(false)}
        />
      )}
      {filePlan && !signAsOpen && (
        <div className="notice" role="status" data-testid="plan-notice">
          <span>
            {filePlan.status.every((s) => s.done)
              ? t("editor.planDone", filePlan.status.length)
              : t(
                  "editor.planPending",
                  filePlan.status
                    .filter((s) => s.canSign)
                    .map((s) => s.signer.name)
                    .join(", "),
                )}
          </span>
          {filePlan.status.some((s) => s.canSign) && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                setSignOpen(false);
                setSignAsId(
                  filePlan.status.find((s) => s.canSign)?.signer.id ?? null,
                );
                setSignAsOpen(true);
              }}
            >
              {t("editor.signAs")}
            </button>
          )}
        </div>
      )}
      {signAsOpen && filePlan && (
        <SignAsPanel
          plan={filePlan.plan}
          status={filePlan.status}
          signerId={signAsId}
          onSigner={setSignAsId}
          adopted={adopted}
          onAdopted={setAdopted}
          busy={signing}
          onSign={(id, texts, identity) => void signAs(id, texts, identity)}
          onClose={() => setSignAsOpen(false)}
        />
      )}
      {needOcr && !ocrOpen && (
        <div className="notice compact" role="status" data-testid="need-ocr">
          <span>{mobile ? t("editor.needOcrShort") : t("editor.needOcr")}</span>
          <button
            type="button"
            className="primary"
            onClick={() => {
              setNeedOcr(false);
              setOcrOpen(true);
            }}
          >
            {t("editor.recognizeText")}
          </button>
          <button
            type="button"
            aria-label={t("editor.closeNotice")}
            onClick={() => setNeedOcr(false)}
          >
            ×
          </button>
        </div>
      )}
      {looksScanned && !hasOcr && !ocrOpen && !scannedDismissed && !needOcr && (
        <div
          className="notice compact"
          role="status"
          data-testid="scanned-notice"
        >
          <span>
            {mobile ? t("editor.looksScannedShort") : t("editor.looksScanned")}
          </span>
          <button
            type="button"
            className="primary"
            onClick={() => setOcrOpen(true)}
          >
            {t("editor.recognizeText")}
          </button>
          <button
            type="button"
            aria-label={t("editor.closeScannedNotice")}
            onClick={() => setScannedDismissed(true)}
          >
            ×
          </button>
        </div>
      )}
      {signOpen && (
        <SignPanel
          adopted={adopted}
          onAdopted={setAdopted}
          onPlace={(next) => {
            setDraft(null);
            setSelectedId(null);
            setPendingImage(null);
            setPlacing(next);
            setTool("place");
            // On a phone the panel covers the page: close it to place.
            if (mobile) setSignOpen(false);
          }}
          onClose={() => setSignOpen(false)}
        >
          <IdentityPicker
            busy={signing}
            offerAudit
            onSave={(mode, identity, options) =>
              void saveSigned(mode, identity, options)
            }
          />
          <PlanEditor
            signers={planSigners}
            onSigners={setPlanSigners}
            mode={planMode}
            onMode={setPlanMode}
            placed={placedFields}
            onPlaceField={(signerId, field) => {
              setDraft(null);
              setSelectedId(null);
              setPendingImage(null);
              setPlacing({ kind: "field", field, signerId });
              setTool("place");
              if (mobile) setSignOpen(false);
            }}
            onPrepare={(withAudit) => void preparePlanFile(withAudit)}
            busy={signing}
          />
        </SignPanel>
      )}
      {ocrOpen && (
        <OcrPanel
          doc={doc}
          pages={state.pages}
          items={state.items}
          dispatch={dispatch}
          fileName={file?.name ?? null}
          onClose={() => setOcrOpen(false)}
        />
      )}
      {splitOpen && (
        <SplitPanel
          pageCount={state.pages.length}
          baseName={baseName}
          busy={splitting}
          onSplit={(groups, mode) => void splitDocument(groups, mode)}
          onClose={() => setSplitOpen(false)}
        />
      )}
      {selectedField && (
        <FieldPanel
          key={selectedField.id}
          field={selectedField}
          taken={fieldNames}
          onChange={updateSelectedField}
        />
      )}
      <p
        className={`tool-hint${tool === "whiteout" ? " warning" : ""}${
          mobile && !hintOpen ? " collapsed" : ""
        }`}
        role="note"
        title={mobile && !hintOpen ? t("mobile.showHint") : undefined}
        onClick={
          mobile ? () => setHintOpenFor(hintOpen ? null : tool) : undefined
        }
      >
        {toolHint(tool, touch)}
      </p>
      {imageInput}
      {insertInput}
      <Viewer
        doc={doc}
        pages={state.pages}
        toolbar={
          mobile ? (
            <span className="toolbar-group">{historyButtons}</span>
          ) : (
            toolbar
          )
        }
        belowToolbar={
          mobile && hasOptions ? (
            <div className="mobile-options">{options}</div>
          ) : null
        }
        thumbnailsOpen={thumbsOpen}
        renderOverlay={renderOverlay}
        renderPageActions={renderPageActions}
        thumbnailsHeader={thumbnailsHeader}
        onMovePage={(from, to) => {
          const page = state.pages[from];
          if (page)
            dispatch({ kind: "movePage", pageId: page.id, toIndex: to });
        }}
        pagesClassName={`tool-${tool}`}
      />
      {mobile && (
        <MobileBar
          tool={tool}
          onTool={chooseTool}
          signOpen={signOpen}
          onToggleSign={() => setSignOpen((o) => !o)}
          ocrOpen={ocrOpen}
          onToggleOcr={() => setOcrOpen((o) => !o)}
          onScan={onScan ?? null}
          thumbsOpen={thumbsOpen}
          onToggleThumbs={() => setThumbsOpen((o) => !o)}
          formOptions={flattenCheck || undefined}
          onInsertPdf={onReplaceBase ? chooseInsert : null}
          splitOpen={splitOpen}
          onToggleSplit={() => setSplitOpen((o) => !o)}
        />
      )}
    </>
  );
}
