import { createPortal } from "react-dom";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  effectiveRotation,
  isImageTextEdit,
  type Item,
  type PageEntry,
  type AnnotationItem,
  type FormFieldItem,
  type FormFieldType,
  type OcrBox,
  type OcrItem,
  type TextEditItem,
  type TextItem,
  type TextStyle,
} from "../model/document";
import { existingItemId, type ExistingAnnot } from "../engine/annotRead";
import { FormLayer, type PageWidget } from "./FormLayer";
import {
  boundingRect,
  rectFromCorners,
  type PageGeometry,
  type Point,
  type Rect,
} from "../model/geometry";
import { newId, type Operation } from "../model/operations";
import { boxBounds, lineAt } from "../ocr/ocrText";
import {
  boldByStrokes,
  imageEditFor,
  invisibleImageLine,
  measuredEdit,
  ocrImageLine,
  type ImageLine,
  type PagePixels,
} from "./scanTextEdit";
import { useMobile, useTouch } from "../useMobile";
import { OcrTextLayer } from "../ocr/OcrTextLayer";
import type { LoadedImage } from "./imageInput";
import {
  signFieldLabel,
  type SignatureAsset,
  type SignatureRole,
  type SignFieldType,
} from "../model/signature";
import { assetAspect, SignaturePreview } from "../sign/SignaturePreview";
import {
  CSS_FONT,
  baselineOffset,
  mergeLineRects,
  minSize,
  moveItem,
  resizableRect,
  visualRotation,
  withRect,
} from "./itemOps";
import { boxAt, previewFamily, textEditFor, type TextBox } from "./textBoxes";
import type { ProbedStyle } from "./textStyleProbe";
import { useEditedRender, type RenderEdits } from "./useEditedRender";
import { DRAG_TOOLS, TEXT_TOOLS, type Tool } from "./tools";
import { useT, type MessageKey } from "../i18n";

/** Text being typed: a new text (itemId null) or an existing one. */
export interface TextDraft {
  pageId: string;
  itemId: string | null;
  at: Point;
  rotate: number;
  /** Page text being replaced (edit-text tool). */
  replace?: TextEditItem;
}

export interface EditLayerProps {
  entry: PageEntry;
  geometry: PageGeometry;
  items: Item[];
  tool: Tool;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  dispatch: (ops: Operation | Operation[]) => void;
  textStyle: TextStyle;
  annotationColor: string;
  highlightColor: string;
  strokeWidth: number;
  pendingImage: LoadedImage | null;
  onImagePlaced: () => void;
  /** What the "place" tool puts on the page (spec 004). */
  placing?: Placing | null;
  onPlaced?: () => void;
  /** Names of the signers of the plan being prepared, by id. */
  signerNames?: Record<string, string>;
  /** Extra marks drawn over the page (not editable items). */
  children?: ReactNode;
  draft: TextDraft | null;
  onDraft: Dispatch<SetStateAction<TextDraft | null>>;
  /** Color, weight and style of a run of page text (loaded on demand). */
  probeStyle?: (box: TextBox) => Promise<ProbedStyle | null>;
  /** Existing text of the page, as extracted by pdf.js. */
  textBoxes: () => Promise<TextBox[]>;
  /** Renders the page with text edits applied (see `useEditedRender`). */
  renderEdits?: RenderEdits;
  /** Annotations of the original page (spec 005, HU8). */
  existing?: ExistingAnnot[];
  /** Form widgets of the page, filled with the select tool (spec 005, HU1). */
  widgets?: PageWidget[];
  onFormValue?: (name: string, value: string | string[]) => void;
  /** What the form field tool creates. */
  fieldType?: FormFieldType;
  fieldStyle?: FormFieldItem["style"];
  /** Field names in use, for the name of a new field. */
  fieldNames?: () => Set<string>;
  noteColor?: string;
  /** Interior color of new rectangles and ellipses, or none. */
  fillColor?: string | null;
  /** Marks doubtful OCR words (only while the OCR panel is open, spec 009). */
  showOcrLow?: boolean;
  /** The page as pixels, to match edits of scanned text (spec 010). */
  pagePixels?: () => Promise<PagePixels>;
  /** A scanned page without recognized text was clicked to edit its text. */
  onNeedOcr?: () => void;
}

/** Text of a note or free text being typed. */
interface AnnotDraft {
  item: AnnotationItem;
  /** Not yet in the document. */
  isNew: boolean;
}

/** Default size of a new form field, in points. */
const NEW_FIELD_SIZE: Record<FormFieldType, { width: number; height: number }> =
  {
    text: { width: 150, height: 20 },
    multiline: { width: 200, height: 60 },
    checkbox: { width: 14, height: 14 },
    radio: { width: 14, height: 14 },
    dropdown: { width: 150, height: 20 },
    list: { width: 120, height: 60 },
  };

/** Base of the name of a new field, in the interface language. */
const FIELD_NAME = {
  text: "editLayer.fieldText",
  multiline: "editLayer.fieldText",
  checkbox: "editLayer.fieldCheckbox",
  radio: "editLayer.fieldRadio",
  dropdown: "editLayer.fieldDropdown",
  list: "editLayer.fieldList",
} as const satisfies Record<FormFieldType, MessageKey>;

/** Width of a new free text box, in points. */
const FREE_TEXT_WIDTH = 200;

/** A signature, initials or a fixed text (the date) waiting to be placed. */
export type Placing =
  | {
      kind: "signature";
      role: SignatureRole;
      asset: SignatureAsset;
      /** Spec 019: the date written under the signature. */
      date?: string;
    }
  | { kind: "text"; text: string }
  /** A field for a signer of a signing plan (spec 004, HU6). */
  | { kind: "field"; field: SignFieldType; signerId: string };

/** Default size of a signing plan field, in points. */
const FIELD_SIZE: Record<SignFieldType, { width: number; height: number }> = {
  signature: { width: 150, height: 40 },
  initials: { width: 50, height: 28 },
  date: { width: 100, height: 18 },
  name: { width: 150, height: 18 },
  text: { width: 150, height: 18 },
};

/** Default height of a placed signature and of initials, in points. */
const SIGNATURE_HEIGHT = { signature: 40, initials: 28 };

/** Default width of a newly placed image, in points. */
const IMAGE_WIDTH = 150;

/** A touch that moves less than this (px) and lifts sooner (ms) is a tap. */
const TAP_SLOP = 10;
const TAP_TIME = 500;

type Drag =
  | { kind: "create"; start: Point; current: Point; points: Point[] }
  | { kind: "move"; id: string; start: Point; current: Point }
  | {
      kind: "resize";
      id: string;
      start: Point;
      current: Point;
      keepAspect: boolean;
    };

/**
 * Editing overlay of one page (spec 001, phase 4). Items are stored in PDF
 * user space and drawn here in view coordinates through `geometry`.
 */
export function EditLayer(props: EditLayerProps) {
  const t = useT();
  const {
    entry,
    geometry,
    items,
    tool,
    selectedId,
    onSelect,
    dispatch,
    pendingImage,
    draft,
  } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  // Phone or touch screen: the text box gets Cancel and Accept buttons.
  const mobile = useMobile();
  const touch = useTouch();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The draft as last rendered, for work that finishes later.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  });
  const annotRef = useRef<HTMLTextAreaElement>(null);
  // A finger down with a tool that acts on a tap: it acts when the finger
  // lifts nearby, soon; if it moves, the page scrolls and nothing happens.
  const tapRef = useRef<{ id: number; x: number; y: number; time: number }>(
    null,
  );
  const [drag, setDrag] = useState<Drag | null>(null);
  const [annotDraft, setAnnotDraft] = useState<AnnotDraft | null>(null);
  const pageRotation = effectiveRotation(entry);

  // Annotations of the file not yet changed or removed: the page render shows
  // them; here they only get a box to select them (spec 005, HU8).
  const touched = new Set(
    items.flatMap((i) =>
      i.kind === "annotRemoval"
        ? [i.source]
        : i.kind === "annotation" && i.source
          ? [i.source]
          : [],
    ),
  );
  const existing = (props.existing ?? []).filter((e) => !touched.has(e.source));
  const existingItem = (id: string) => {
    const e = existing.find((x) => existingItemId(x.source) === id);
    return e?.item ? { ...e.item, pageId: entry.id } : undefined;
  };
  const findItem = (id: string): Item | undefined =>
    items.find((i) => i.id === id) ?? existingItem(id);
  /** Adds a changed annotation of the file, or updates an item. */
  const commitItem = (item: Item) =>
    dispatch(
      items.some((i) => i.id === item.id)
        ? { kind: "updateItem", item }
        : { kind: "addItem", item },
    );

  useEffect(() => {
    if (annotDraft) annotRef.current?.focus();
  }, [annotDraft]);

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = rootRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pdfDelta = (a: Point, b: Point): Point => {
    const p = geometry.toPdf(a);
    const q = geometry.toPdf(b);
    return { x: q.x - p.x, y: q.y - p.y };
  };

  // Highlight, underline and strikeout: the text selection inside this page,
  // as line rects.
  useEffect(() => {
    if (!TEXT_TOOLS.has(tool)) return;
    const shape = tool as "highlight" | "underline" | "strikeout";
    const onUp = () => {
      const selection = window.getSelection();
      const root = rootRef.current;
      if (!selection || selection.isCollapsed || !root) return;
      const page = root.getBoundingClientRect();
      const rects: Rect[] = [];
      for (let i = 0; i < selection.rangeCount; i++) {
        for (const r of selection.getRangeAt(i).getClientRects()) {
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          if (
            cx < page.left ||
            cx > page.right ||
            cy < page.top ||
            cy > page.bottom ||
            r.height > page.height * 0.2 // container boxes, not text lines
          )
            continue;
          rects.push({
            x: r.left - page.left,
            y: r.top - page.top,
            width: r.width,
            height: r.height,
          });
        }
      }
      const lines = mergeLineRects(rects);
      if (lines.length === 0) return;
      dispatch({
        kind: "addItem",
        item: {
          kind: "annotation",
          id: newId(shape),
          pageId: entry.id,
          shape,
          color:
            shape === "highlight"
              ? props.highlightColor
              : props.annotationColor,
          width: 0,
          rects: lines.map((l) => geometry.rectToPdf(l)),
        },
      });
      selection.removeAllRanges();
    };
    document.addEventListener("pointerup", onUp);
    return () => document.removeEventListener("pointerup", onUp);
  }, [
    tool,
    dispatch,
    entry.id,
    geometry,
    props.highlightColor,
    props.annotationColor,
  ]);

  useEffect(() => {
    const el = textareaRef.current;
    if (draft?.pageId !== entry.id || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [draft, entry.id]);

  // Extract the page text ahead of the first click with the edit-text tool.
  const { textBoxes: loadTextBoxes } = props;
  useEffect(() => {
    if (tool === "editText") void loadTextBoxes();
  }, [tool, loadTextBoxes]);

  const startTextDraft = (p: Point) => {
    const size = props.textStyle.size * geometry.scale;
    const lineHeight = size * props.textStyle.lineHeight;
    props.onDraft({
      pageId: entry.id,
      itemId: null,
      at: geometry.toPdf({ x: p.x, y: p.y + baselineOffset(size, lineHeight) }),
      rotate: pageRotation,
    });
  };

  const startReplaceDraft = async (p: Point) => {
    const q = geometry.toPdf(p);
    const edited = items.find(
      (i): i is TextEditItem =>
        i.kind === "textEdit" &&
        q.x >= i.area.x &&
        q.x <= i.area.x + i.area.width &&
        q.y >= i.area.y &&
        q.y <= i.area.y + i.area.height,
    );
    if (edited) {
      props.onDraft({
        pageId: entry.id,
        itemId: edited.id,
        at: edited.at,
        rotate: edited.rotate,
        replace: edited,
      });
      return;
    }
    // Spec 010: a line recognized by OCR in this app.
    for (const item of items) {
      if (item.kind !== "ocr") continue;
      const index = lineAt(item, q);
      if (index < 0) continue;
      startImageDraft(
        ocrImageLine(entry.id, item.rotate, item.lines[index]!, q),
        item.lines.filter((_, i) => i !== index),
      );
      return;
    }
    const boxes = await props.textBoxes();
    const box = boxAt(boxes, q);
    if (!box) {
      // A scanned page without recognized text: offer OCR.
      if (boxes.length === 0 || entry.source.kind === "scan")
        props.onNeedOcr?.();
      return;
    }
    const replace = textEditFor(box, entry.id, "", box.text);
    const next: TextDraft = {
      pageId: entry.id,
      itemId: null,
      at: box.at,
      rotate: box.rotate,
      replace,
    };
    props.onDraft(next);
    const style = await props.probeStyle?.(box).catch(() => null);
    if (!style) return;
    // Invisible text (the OCR layer of a scanned PDF): its line is edited in
    // the image (spec 010).
    if (style.invisible) {
      if (draftRef.current === next)
        startImageDraft(invisibleImageLine(entry.id, boxes, box));
      return;
    }
    // Only if the user is still editing the same text: the state may have
    // moved on (committed, or another text opened) while the style loaded.
    const styled: TextDraft = {
      ...next,
      replace: {
        ...replace,
        color: style.color,
        bold: style.bold,
        italic: style.italic,
        previewFont: previewFamily(box, style.substitute),
      },
    };
    props.onDraft((current) => (current !== next ? current : styled));
    if (style.bold || !props.pagePixels) return;
    // The font says regular: bold may still be in its strokes.
    const others = boxes.filter((b) => b !== box && b.rotate === box.rotate);
    const pixels = await props.pagePixels().catch(() => null);
    if (
      !pixels ||
      !boldByStrokes(
        pixels,
        box.area,
        others.map((b) => b.area),
      )
    )
      return;
    props.onDraft((current) =>
      current !== styled
        ? current
        : { ...styled, replace: { ...styled.replace!, bold: true } },
    );
  };

  /**
   * Opens a line of a scanned image (spec 010): at once with the size of its
   * box, then with the paper, ink, size and baseline measured in the pixels.
   */
  const startImageDraft = (line: ImageLine, others: OcrBox[] = []) => {
    const replace = imageEditFor(line);
    const next: TextDraft = {
      pageId: entry.id,
      itemId: null,
      at: replace.at,
      rotate: replace.rotate,
      replace,
    };
    props.onDraft(next);
    props
      .pagePixels?.()
      .then((pixels) => {
        const measured = measuredEdit(replace, line, pixels, others);
        props.onDraft((current) =>
          current !== next
            ? current
            : { ...next, at: measured.at, replace: measured },
        );
      })
      .catch(() => {});
  };

  /** Opens the text of a new note or free text at `p`. */
  const startAnnotDraft = (shape: "note" | "freeText", p: Point) => {
    const at = geometry.toPdf(p);
    const style = props.textStyle;
    const rect =
      shape === "note"
        ? { x: at.x, y: at.y - 20, width: 20, height: 20 }
        : {
            x: at.x,
            y: at.y - style.size * 1.4,
            width: FREE_TEXT_WIDTH,
            height: style.size * 1.4,
          };
    setAnnotDraft({
      isNew: true,
      item: {
        kind: "annotation",
        id: newId(shape),
        pageId: entry.id,
        shape,
        color: shape === "note" ? (props.noteColor ?? "#ffd400") : style.color,
        width: 0,
        rects: [rect],
        text: "",
        ...(shape === "freeText"
          ? { font: style.font, fontSize: style.size }
          : {}),
      },
    });
  };

  const commitAnnotDraft = (text: string) => {
    if (!annotDraft) return;
    setAnnotDraft(null);
    const { item, isNew } = annotDraft;
    if (isNew && text.trim() === "") return;
    if (!isNew && text === item.text) return;
    let next: AnnotationItem = { ...item, text };
    // A free text box grows to fit its lines.
    if (item.shape === "freeText") {
      const r = item.rects![0]!;
      const lines = text.split("\n").length;
      const height = Math.max(
        r.height,
        lines * (item.fontSize ?? 12) * 1.2 + 4,
      );
      next = {
        ...next,
        rects: [{ ...r, y: r.y + r.height - height, height }],
      };
    }
    if (isNew) {
      dispatch({ kind: "addItem", item: next });
      onSelect(next.id);
    } else commitItem(next);
  };

  /** Creates a form field of the chosen type at `p` (spec 005, HU3). */
  const createField = (p: Point) => {
    const type = props.fieldType ?? "text";
    const size = NEW_FIELD_SIZE[type];
    const width = size.width * geometry.scale;
    const height = size.height * geometry.scale;
    const taken = props.fieldNames?.() ?? new Set<string>();
    const fresh = (base: string) => {
      let i = 1;
      while (taken.has(`${base}_${i}`)) i++;
      return `${base}_${i}`;
    };
    // A radio button created while another is selected joins its group.
    const selectedRadio = items.find(
      (i): i is FormFieldItem =>
        i.id === selectedId && i.kind === "formField" && i.field === "radio",
    );
    const groupSize = selectedRadio
      ? items.filter(
          (i) =>
            i.kind === "formField" &&
            i.field === "radio" &&
            i.name === selectedRadio.name,
        ).length
      : 0;
    const item: FormFieldItem = {
      kind: "formField",
      id: newId("field"),
      pageId: entry.id,
      field: type,
      name:
        type === "radio" && selectedRadio
          ? selectedRadio.name
          : fresh(t(FIELD_NAME[type])),
      rect: geometry.rectToPdf({ x: p.x, y: p.y, width, height }),
      align: "left",
      required: false,
      style: props.fieldStyle ?? {
        font: "Helvetica",
        size: 0,
        color: "#000000",
      },
      ...(type === "checkbox"
        ? { exportValue: t("editLayer.checkboxValue") }
        : {}),
      ...(type === "radio"
        ? { exportValue: t("editLayer.radioValue", groupSize + 1) }
        : {}),
      ...(type === "dropdown" || type === "list"
        ? { options: [1, 2, 3].map((n) => t("editLayer.option", n)) }
        : {}),
    };
    dispatch({ kind: "addItem", item });
    onSelect(item.id);
  };

  const placeImage = (p: Point) => {
    if (!pendingImage) return;
    const width = IMAGE_WIDTH * geometry.scale;
    const view = {
      x: p.x,
      y: p.y,
      width,
      height: (width * pendingImage.height) / pendingImage.width,
    };
    const id = newId("image");
    dispatch({
      kind: "addItem",
      item: {
        kind: "image",
        id,
        pageId: entry.id,
        rect: geometry.rectToPdf(view),
        mime: pendingImage.mime,
        data: pendingImage.data,
        rotate: pageRotation,
      },
    });
    props.onImagePlaced();
    onSelect(id);
  };

  const place = (p: Point) => {
    const placing = props.placing;
    if (!placing) return;
    const id = newId(placing.kind);
    if (placing.kind === "text") {
      const size = props.textStyle.size * geometry.scale;
      const lineHeight = size * props.textStyle.lineHeight;
      dispatch({
        kind: "addItem",
        item: {
          kind: "text",
          id,
          pageId: entry.id,
          at: geometry.toPdf({
            x: p.x,
            y: p.y + baselineOffset(size, lineHeight),
          }),
          text: placing.text,
          style: props.textStyle,
          rotate: pageRotation,
        },
      });
    } else if (placing.kind === "field") {
      const size = FIELD_SIZE[placing.field];
      const width = size.width * geometry.scale;
      const height = size.height * geometry.scale;
      dispatch({
        kind: "addItem",
        item: {
          kind: "signField",
          id,
          pageId: entry.id,
          field: placing.field,
          signerId: placing.signerId,
          rect: geometry.rectToPdf({
            x: p.x - width / 2,
            y: p.y - height / 2,
            width,
            height,
          }),
        },
      });
    } else {
      // Upright on screen, centered on the click.
      const aspect = assetAspect(placing.asset);
      let height = SIGNATURE_HEIGHT[placing.role] * geometry.scale;
      let width = height * aspect;
      const maxWidth = geometry.viewWidth * 0.6;
      if (width > maxWidth) {
        width = maxWidth;
        height = width / aspect;
      }
      const ops: Operation[] = [
        {
          kind: "addItem",
          item: {
            kind: "signature",
            id,
            pageId: entry.id,
            role: placing.role,
            asset: placing.asset,
            rect: geometry.rectToPdf({
              x: p.x - width / 2,
              y: p.y - height / 2,
              width,
              height,
            }),
            rotate: pageRotation,
          },
        },
      ];
      // Spec 019: the date under the signature, in the same step.
      if (placing.date) {
        const style = { ...props.textStyle, size: 10 };
        const size = style.size * geometry.scale;
        const lineHeight = size * style.lineHeight;
        ops.push({
          kind: "addItem",
          item: {
            kind: "text",
            id: newId("text"),
            pageId: entry.id,
            at: geometry.toPdf({
              x: p.x - width / 2,
              y: p.y + height / 2 + 4 + baselineOffset(size, lineHeight),
            }),
            text: placing.date,
            style,
            rotate: pageRotation,
          },
        });
      }
      dispatch(ops);
    }
    props.onPlaced?.();
    onSelect(id);
  };

  const onRootPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (e.pointerType !== "mouse" && !DRAG_TOOLS.has(tool)) {
      // Keeps the focus where it is; scrolling is not prevented.
      if (!(tool === "select" || TEXT_TOOLS.has(tool))) e.preventDefault();
      tapRef.current = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        time: e.timeStamp,
      };
      return;
    }
    act(e);
  };

  /** What a click or a tap does with the current tool. */
  const act = (e: ReactPointerEvent<HTMLDivElement>) => {
    // A click outside an open text editor only closes it (blur commits).
    if (draft && textareaRef.current) {
      textareaRef.current.blur();
      return;
    }
    if (annotDraft && annotRef.current) {
      annotRef.current.blur();
      return;
    }
    // Selecting and marking text work on text selection (OCR text included).
    if (tool === "select" || TEXT_TOOLS.has(tool)) return;
    const p = local(e);
    // Keeps focus where it is (the new text box) and avoids selecting text.
    e.preventDefault();
    if (tool === "text") startTextDraft(p);
    else if (tool === "editText") void startReplaceDraft(p);
    else if (tool === "image") placeImage(p);
    else if (tool === "place") place(p);
    else if (tool === "note" || tool === "freeText") startAnnotDraft(tool, p);
    else if (tool === "formField") createField(p);
    else if (DRAG_TOOLS.has(tool)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ kind: "create", start: p, current: p, points: [p] });
    }
  };

  /**
   * preventDefault keeps the focus where it was: a toolbar control would keep
   * it, and Supr would not reach the selection.
   */
  const releaseFocus = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !rootRef.current?.contains(active))
      active.blur();
  };

  const onItemPointerDown = (
    e: ReactPointerEvent<HTMLElement>,
    item: Item,
    resize = false,
  ) => {
    if (e.button !== 0) return;
    if (tool === "text" && item.kind === "text") {
      e.stopPropagation();
      e.preventDefault();
      if (!draft) props.onDraft(draftFor(item));
      return;
    }
    // Fields created in pdfcraft are moved with their own tool; with the
    // select tool they are filled.
    const movable =
      tool === "formField"
        ? item.kind === "formField"
        : tool === "select" && item.kind !== "formField";
    if (!movable) return;
    e.stopPropagation();
    e.preventDefault();
    releaseFocus();
    onSelect(item.id);
    const p = local(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(
      resize
        ? {
            kind: "resize",
            id: item.id,
            start: p,
            current: p,
            keepAspect:
              (item.kind === "image" || item.kind === "signature") &&
              !e.shiftKey,
          }
        : { kind: "move", id: item.id, start: p, current: p },
    );
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return;
    const p = local(e);
    setDrag(
      drag.kind === "create"
        ? { ...drag, current: p, points: [...drag.points, p] }
        : { ...drag, current: p },
    );
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const tap = tapRef.current;
    tapRef.current = null;
    if (
      tap?.id === e.pointerId &&
      Math.hypot(e.clientX - tap.x, e.clientY - tap.y) <= TAP_SLOP &&
      e.timeStamp - tap.time <= TAP_TIME
    ) {
      e.preventDefault();
      act(e);
      return;
    }
    if (!drag) return;
    setDrag(null);
    if (drag.kind === "create") {
      const created = createdItem(drag);
      if (created) {
        dispatch({ kind: "addItem", item: created });
        if (created.kind === "whiteout") onSelect(created.id);
      }
      return;
    }
    const item = findItem(drag.id);
    if (!item) return;
    const moved = preview(item);
    if (moved !== item) commitItem(moved);
  };

  const createdItem = (d: Extract<Drag, { kind: "create" }>): Item | null => {
    const viewRect = rectFromCorners(d.start, d.current);
    const big = viewRect.width >= 3 || viewRect.height >= 3;
    const base = { pageId: entry.id };
    const annotation = {
      ...base,
      kind: "annotation" as const,
      color: props.annotationColor,
      width: props.strokeWidth,
    };
    switch (tool) {
      case "whiteout":
        return big
          ? {
              ...base,
              kind: "whiteout",
              id: newId("whiteout"),
              rect: minSize(geometry.rectToPdf(viewRect)),
            }
          : null;
      case "redact":
        return big
          ? {
              ...base,
              kind: "redaction",
              id: newId("redaction"),
              rect: minSize(geometry.rectToPdf(viewRect), 2),
              applied: false,
            }
          : null;
      case "square":
      case "circle":
        return big
          ? {
              ...annotation,
              id: newId(tool),
              shape: tool,
              rects: [minSize(geometry.rectToPdf(viewRect))],
              ...(props.fillColor ? { fill: props.fillColor } : {}),
            }
          : null;
      case "line":
      case "arrow":
        return big
          ? {
              ...annotation,
              id: newId(tool),
              shape: tool,
              paths: [[geometry.toPdf(d.start), geometry.toPdf(d.current)]],
            }
          : null;
      case "ink":
        return d.points.length > 1
          ? {
              ...annotation,
              id: newId("ink"),
              shape: "ink",
              paths: [d.points.map((p) => geometry.toPdf(p))],
            }
          : null;
      default:
        return null;
    }
  };

  /** The item as it looks during a move or resize drag. */
  const preview = (item: Item): Item => {
    if (!drag || drag.kind === "create" || drag.id !== item.id) return item;
    if (drag.kind === "move")
      return moveItem(item, pdfDelta(drag.start, drag.current));
    const rect = resizableRect(item);
    if (!rect) return item;
    const view = geometry.rectToView(rect);
    const width = Math.max(4, view.width + drag.current.x - drag.start.x);
    const height = drag.keepAspect
      ? (width * view.height) / view.width
      : Math.max(4, view.height + drag.current.y - drag.start.y);
    return withRect(
      item,
      geometry.rectToPdf({ x: view.x, y: view.y, width, height }),
    );
  };

  const draftFor = (item: TextItem): TextDraft => ({
    pageId: item.pageId,
    itemId: item.id,
    at: item.at,
    rotate: item.rotate,
  });

  const commitDraft = (value: string) => {
    if (!draft) return;
    props.onDraft(null);
    const existing = items.find((i) => i.id === draft.itemId);
    if (draft.replace) {
      const { replace } = draft;
      if (existing?.kind === "textEdit") {
        // Back to the original text: the edit is no longer needed.
        if (value === existing.originalText)
          dispatch({ kind: "removeItem", itemId: existing.id });
        else if (value !== existing.text)
          dispatch({ kind: "updateItem", item: { ...existing, text: value } });
      } else if (value !== replace.originalText)
        dispatch({
          kind: "addItem",
          item: { ...replace, id: newId("edit"), text: value },
        });
      return;
    }
    if (existing?.kind === "text") {
      if (value.trim() === "")
        dispatch({ kind: "removeItem", itemId: existing.id });
      else if (value !== existing.text)
        dispatch({ kind: "updateItem", item: { ...existing, text: value } });
      return;
    }
    if (value.trim() === "") return;
    const id = newId("text");
    dispatch({
      kind: "addItem",
      item: {
        kind: "text",
        id,
        pageId: entry.id,
        at: draft.at,
        text: value,
        style: props.textStyle,
        rotate: draft.rotate,
      },
    });
    onSelect(id);
  };

  /** Resize handle of the selected item, when its tool can resize it. */
  const handle = (item: Item, selected: boolean, raw: Item) =>
    selected &&
    resizableRect(item) &&
    (item.kind === "formField" ? tool === "formField" : tool === "select") ? (
      <span
        className="resize-handle"
        role="presentation"
        data-testid="resize-handle"
        onPointerDown={(e) => onItemPointerDown(e, raw, true)}
      />
    ) : null;

  const textTool = tool === "select" || TEXT_TOOLS.has(tool);
  const interactive = !textTool;
  const creating = drag?.kind === "create" ? drag : null;
  const draftHere = draft?.pageId === entry.id ? draft : null;
  const editedItem = draftHere?.itemId
    ? items.find((i) => i.id === draftHere.itemId)
    : undefined;
  const draftText = draftHere?.replace
    ? draftHere.replace.text
    : editedItem?.kind === "text"
      ? editedItem.text
      : "";
  const edited = useEditedRender(
    items,
    draftHere,
    geometry.scale,
    props.renderEdits,
  );
  // Spec 010: the paper color under a line of a scanned image being typed.
  const draftCover =
    draftHere?.replace && isImageTextEdit(draftHere.replace)
      ? geometry.rectToView(draftHere.replace.area)
      : null;
  const imageAreas = items
    .filter(
      (i): i is TextEditItem => i.kind === "textEdit" && isImageTextEdit(i),
    )
    .map((i) => i.area)
    .concat(draftHere?.replace && draftCover ? [draftHere.replace.area] : []);
  const draftStyle = draftHere?.replace
    ? editStyle(draftHere.replace)
    : editedItem?.kind === "text"
      ? editedItem.style
      : props.textStyle;

  return (
    <div
      ref={rootRef}
      className={`edit-overlay tool-${tool}${interactive ? " interactive" : ""}${DRAG_TOOLS.has(tool) ? "" : " tap-tool"}`}
      onPointerDown={onRootPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        tapRef.current = null;
        setDrag(null);
      }}
    >
      {edited && (
        // The page as it will be saved: original glyphs gone, new text in the
        // original font and color, background untouched.
        <img
          className="page-edited"
          src={edited.url}
          alt=""
          width={geometry.viewWidth}
          height={geometry.viewHeight}
        />
      )}
      <svg
        className="edit-shapes"
        width={geometry.viewWidth}
        height={geometry.viewHeight}
        aria-hidden="true"
      >
        {items.map((item) =>
          item.kind === "annotation" &&
          item.shape !== "note" &&
          item.shape !== "freeText" ? (
            <AnnotationShape
              key={item.id}
              item={preview(item) as AnnotationItem}
              geometry={geometry}
            />
          ) : null,
        )}
        {creating && (
          <CreationPreview
            tool={tool}
            drag={creating}
            color={props.annotationColor}
            width={props.strokeWidth * geometry.scale}
            fill={props.fillColor ?? null}
          />
        )}
      </svg>
      {textTool &&
        items.map((item) =>
          item.kind === "ocr" ? (
            <OcrTextLayer
              key={item.id}
              item={item}
              geometry={geometry}
              rotation={visualRotation(pageRotation, item.rotate)}
              covered={imageAreas}
            />
          ) : null,
        )}
      {props.showOcrLow &&
        items.map((item) =>
          item.kind === "ocr" ? (
            <OcrLowConfidence key={item.id} item={item} geometry={geometry} />
          ) : null,
        )}
      {tool === "select" &&
        existing.map((e) => {
          const id = existingItemId(e.source);
          const moved = e.item
            ? preview({ ...e.item, pageId: entry.id })
            : null;
          const bounds =
            (moved && viewBounds(moved, geometry)) ??
            geometry.rectToView(e.rect);
          return (
            <div
              key={id}
              className={`item item-existing${id === selectedId ? " selected" : ""}`}
              data-item-id={id}
              data-kind="existing"
              data-subtype={e.subtype}
              title={e.author ? `${e.subtype} (${e.author})` : e.subtype}
              style={{
                left: bounds.x,
                top: bounds.y,
                width: bounds.width,
                height: bounds.height,
              }}
              onPointerDown={(ev) => {
                if (e.item)
                  onItemPointerDown(ev, { ...e.item, pageId: entry.id });
                else if (ev.button === 0) {
                  ev.stopPropagation();
                  ev.preventDefault();
                  releaseFocus();
                  onSelect(id);
                }
              }}
              onDoubleClick={() => {
                if (
                  e.item &&
                  (e.item.shape === "note" || e.item.shape === "freeText")
                )
                  setAnnotDraft({
                    isNew: false,
                    item: { ...e.item, pageId: entry.id },
                  });
              }}
            />
          );
        })}
      {tool === "select" && props.widgets && props.onFormValue && (
        <FormLayer
          widgets={props.widgets}
          geometry={geometry}
          onValue={props.onFormValue}
        />
      )}
      {items.map((raw) => {
        if (raw === editedItem) return null;
        if (raw.id === annotDraft?.item.id) return null;
        // With the select tool, fields are filled through the form layer.
        if (raw.kind === "formField" && tool !== "formField") return null;
        const item = preview(raw);
        const selected = item.id === selectedId;
        const common = {
          "data-item-id": item.id,
          "data-kind": item.kind,
          onPointerDown: (e: ReactPointerEvent<HTMLElement>) =>
            onItemPointerDown(e, raw),
        };
        if (
          item.kind === "annotation" &&
          (item.shape === "note" || item.shape === "freeText")
        ) {
          const v = geometry.rectToView(item.rects![0]!);
          const isNote = item.shape === "note";
          return (
            <div
              key={item.id}
              {...common}
              data-shape={item.shape}
              className={`item item-${item.shape}${selected ? " selected" : ""}`}
              title={isNote ? item.text : undefined}
              style={{
                left: v.x,
                top: v.y,
                width: v.width,
                height: v.height,
                ...(isNote
                  ? { background: item.color }
                  : {
                      color: item.color,
                      fontFamily: CSS_FONT[item.font ?? "Helvetica"],
                      fontSize: `${(item.fontSize ?? 12) * geometry.scale}px`,
                    }),
              }}
              onDoubleClick={() =>
                tool === "select" &&
                setAnnotDraft({ isNew: false, item: raw as AnnotationItem })
              }
            >
              {item.shape === "freeText" ? item.text : null}
              {handle(item, selected, raw)}
            </div>
          );
        }
        const resizeHandle = handle(item, selected, raw);
        if (item.kind === "textEdit" && isImageTextEdit(item)) {
          // Being typed again: the draft shows it.
          if (item.id === draftHere?.itemId) return null;
          const cover = geometry.rectToView(item.area);
          return (
            <div key={item.id}>
              <div
                {...common}
                className={`item item-textEdit item-imageEdit${selected ? " selected" : ""}`}
                data-testid="image-edit"
                style={{
                  left: cover.x,
                  top: cover.y,
                  width: cover.width,
                  height: cover.height,
                  background: item.background,
                }}
              />
              <div
                className="item-textEdit-text"
                style={textBoxStyle(
                  item.at,
                  editStyle(item),
                  item.rotate,
                  pageRotation,
                  geometry,
                  item.previewFont,
                )}
              >
                {item.text}
              </div>
            </div>
          );
        }
        if (item.kind === "textEdit") {
          const mask = geometry.rectToView(item.area);
          return (
            <div key={item.id}>
              <div
                {...common}
                className={`item item-textEdit${selected ? " selected" : ""}`}
                style={{
                  left: mask.x,
                  top: mask.y,
                  width: mask.width,
                  height: mask.height,
                }}
              />
              {!edited?.current && (
                // Until the render with this edit is ready.
                <div
                  className="item-textEdit-text"
                  style={textBoxStyle(
                    item.at,
                    editStyle(item),
                    item.rotate,
                    pageRotation,
                    geometry,
                    item.previewFont,
                  )}
                >
                  {item.text}
                </div>
              )}
            </div>
          );
        }
        if (item.kind === "text")
          return (
            <div
              key={item.id}
              {...common}
              className={`item item-text${selected ? " selected" : ""}`}
              style={textBoxStyle(
                item.at,
                item.style,
                item.rotate,
                pageRotation,
                geometry,
              )}
            >
              {item.text}
            </div>
          );
        const bounds = viewBounds(item, geometry);
        if (!bounds) return null;
        return (
          <div
            key={item.id}
            {...common}
            className={`item item-${item.kind}${selected ? " selected" : ""}${
              item.kind === "redaction" && item.applied ? " applied" : ""
            }`}
            {...(item.kind === "redaction"
              ? {
                  role: "img",
                  "aria-label": t(
                    item.applied ? "redact.appliedMark" : "redact.pendingMark",
                  ),
                }
              : {})}
            style={{
              left: bounds.x,
              top: bounds.y,
              width: bounds.width,
              height: bounds.height,
            }}
          >
            {item.kind === "signField" && (
              <span className="sign-field-label">
                {signFieldLabel(item.field)}
                {props.signerNames?.[item.signerId]
                  ? `: ${props.signerNames[item.signerId]}`
                  : ""}
              </span>
            )}
            {item.kind === "signature" && (
              <SignaturePreview
                asset={item.asset}
                rotation={visualRotation(pageRotation, item.rotate)}
                width={bounds.width}
                height={bounds.height}
              />
            )}
            {item.kind === "image" && (
              <ImagePreview
                item={item}
                rotation={visualRotation(pageRotation, item.rotate)}
                width={bounds.width}
                height={bounds.height}
              />
            )}
            {item.kind === "formField" && (
              <span className="form-field-label">{item.name}</span>
            )}
            {resizeHandle}
          </div>
        );
      })}
      {annotDraft && (
        <textarea
          ref={annotRef}
          className={`annot-draft annot-draft-${annotDraft.item.shape}`}
          aria-label={t(
            annotDraft.item.shape === "note"
              ? "editLayer.noteText"
              : "editLayer.freeText",
          )}
          spellCheck={false}
          defaultValue={annotDraft.item.text ?? ""}
          style={annotDraftStyle(annotDraft.item, geometry)}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => commitAnnotDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setAnnotDraft(null);
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      )}
      {draftCover && (
        <div
          className="image-edit-cover"
          data-testid="image-edit-cover"
          style={{
            left: draftCover.x,
            top: draftCover.y,
            width: draftCover.width,
            height: draftCover.height,
            background: draftHere?.replace?.background,
          }}
        />
      )}
      {draftCover && draftHere?.replace?.lowConfidence && (
        <p
          className="draft-note"
          role="note"
          style={{
            left: draftCover.x,
            top: draftCover.y + draftCover.height + 4,
          }}
        >
          {t("editLayer.typedLook")}
        </p>
      )}
      {draftHere &&
        (mobile || touch) &&
        createPortal(
          <div
            className="draft-bar"
            role="group"
            aria-label={t("editLayer.draftActions")}
          >
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const el = textareaRef.current;
                if (!el) return;
                el.value = draftText;
                el.blur();
              }}
            >
              {t("editLayer.cancel")}
            </button>
            <button
              type="button"
              className="primary"
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => textareaRef.current?.blur()}
            >
              {t("editLayer.accept")}
            </button>
          </div>,
          document.body,
        )}
      {draftHere && (
        <textarea
          // A new text (or another line) gets a new box: the value is not
          // controlled.
          key={`${draftHere.itemId}:${draftHere.replace?.originalText ?? ""}`}
          ref={textareaRef}
          className="text-draft"
          aria-label={t("editLayer.text")}
          spellCheck={false}
          defaultValue={draftText}
          rows={1}
          style={{
            ...textBoxStyle(
              draftHere.at,
              draftStyle,
              draftHere.rotate,
              pageRotation,
              geometry,
              draftHere.replace?.previewFont,
            ),
            ...(draftHere.replace
              ? {
                  // Transparent: the render below has the original text removed
                  // and keeps the background.
                  background: "transparent",
                  minWidth: geometry.rectToView(draftHere.replace.area).width,
                }
              : {}),
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onInput={(e) => autosize(e.currentTarget)}
          onFocus={(e) => autosize(e.currentTarget)}
          onBlur={(e) => commitDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.currentTarget.value = draftText;
              e.currentTarget.blur();
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
        />
      )}
      {props.children}
    </div>
  );
}

/** Text box of a note (next to its icon) or a free text (in its box). */
function annotDraftStyle(
  item: AnnotationItem,
  geometry: PageGeometry,
): CSSProperties {
  const v = geometry.rectToView(item.rects![0]!);
  if (item.shape === "note")
    return { left: v.x + v.width + 4, top: v.y, width: 220, height: 90 };
  return {
    left: v.x,
    top: v.y,
    width: v.width,
    minHeight: v.height,
    color: item.color,
    fontFamily: CSS_FONT[item.font ?? "Helvetica"],
    fontSize: `${(item.fontSize ?? 12) * geometry.scale}px`,
    lineHeight: 1.2,
  };
}

/** Low-confidence words, marked on screen only (spec 003, CA6). */
function OcrLowConfidence({
  item,
  geometry,
}: {
  item: OcrItem;
  geometry: PageGeometry;
}) {
  const t = useT();
  return (
    <>
      {item.lines.flatMap((line, i) =>
        line.words
          .filter((w) => w.confidence < 60)
          .map((w, j) => {
            const v = geometry.rectToView(boxBounds(item.rotate, w));
            return (
              <div
                key={`${i}-${j}`}
                className="ocr-low"
                data-testid="ocr-low"
                title={t(
                  "editLayer.lowConfidence",
                  Math.round(w.confidence),
                  w.text,
                )}
                style={{
                  left: v.x,
                  top: v.y,
                  width: v.width,
                  height: v.height,
                }}
              />
            );
          }),
      )}
    </>
  );
}

/** Preview style of replaced page text (the family comes from `previewFont`). */
function editStyle(item: TextEditItem): TextStyle {
  const css = item.previewFont ?? "";
  return {
    font: /mono|courier|cousine/i.test(css)
      ? "Courier"
      : /tinos|caladea|(^|[ ,])serif/i.test(css)
        ? "Times"
        : "Helvetica",
    size: item.size,
    color: item.color,
    bold: item.bold ?? false,
    italic: item.italic ?? false,
    lineHeight: 1.2,
  };
}

function autosize(el: HTMLTextAreaElement) {
  const lines = el.value.split("\n");
  el.rows = Math.max(1, lines.length);
  el.cols = Math.max(4, ...lines.map((l) => l.length + 2));
}

/** Absolute position of a text box whose first baseline starts at `at`. */
function textBoxStyle(
  at: Point,
  style: TextStyle,
  rotate: number,
  pageRotation: number,
  geometry: PageGeometry,
  family?: string,
): CSSProperties {
  const v = geometry.toView(at);
  const size = style.size * geometry.scale;
  const lineHeight = size * style.lineHeight;
  const baseline = baselineOffset(size, lineHeight);
  return {
    left: v.x,
    top: v.y - baseline,
    fontFamily: family ?? CSS_FONT[style.font],
    // The PDF's own font already has its weight and slant: never fake them.
    ...(family ? { fontSynthesis: "none" } : {}),
    fontSize: `${size}px`,
    lineHeight: `${lineHeight}px`,
    fontWeight: style.bold ? "bold" : "normal",
    fontStyle: style.italic ? "italic" : "normal",
    color: style.color,
    transformOrigin: `0 ${baseline}px`,
    transform: `rotate(${visualRotation(pageRotation, rotate)}deg)`,
  };
}

/** On-screen bounding box of a non-text item, padded for thin strokes. */
function viewBounds(item: Item, geometry: PageGeometry): Rect | null {
  switch (item.kind) {
    case "image":
    case "whiteout":
    case "redaction":
    case "signature":
    case "signField":
    case "formField":
      return geometry.rectToView(item.rect);
    case "annotRemoval":
    case "formValue":
      return null;
    case "textEdit":
      return geometry.rectToView(item.area);
    case "annotation": {
      const points = [
        ...(item.rects ?? []).flatMap((r) => {
          const v = geometry.rectToView(r);
          return [
            { x: v.x, y: v.y },
            { x: v.x + v.width, y: v.y + v.height },
          ];
        }),
        ...(item.paths ?? []).flat().map((p) => geometry.toView(p)),
      ];
      if (points.length === 0) return null;
      const r = boundingRect(points);
      const pad = Math.max(4, (item.width * geometry.scale) / 2 + 2);
      return {
        x: r.x - pad,
        y: r.y - pad,
        width: r.width + 2 * pad,
        height: r.height + 2 * pad,
      };
    }
    case "text":
    case "ocr":
      return null;
  }
}

function AnnotationShape({
  item,
  geometry,
}: {
  item: AnnotationItem;
  geometry: PageGeometry;
}) {
  const stroke = {
    stroke: item.color,
    strokeWidth: item.width * geometry.scale,
    fill: item.fill ?? "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (item.shape) {
    case "highlight":
      return (
        <g className="shape-highlight">
          {(item.rects ?? []).map((r, i) => {
            const v = geometry.rectToView(r);
            return <rect key={i} {...v} fill={item.color} />;
          })}
        </g>
      );
    case "underline":
    case "strikeout":
      return (
        <g className={`shape-${item.shape}`}>
          {(item.rects ?? []).map((r, i) => {
            const v = geometry.rectToView(r);
            const y =
              v.y + v.height * (item.shape === "underline" ? 0.88 : 0.55);
            return (
              <line
                key={i}
                x1={v.x}
                x2={v.x + v.width}
                y1={y}
                y2={y}
                stroke={item.color}
                strokeWidth={Math.max(1, v.height / 14)}
              />
            );
          })}
        </g>
      );
    case "note":
    case "freeText":
      return null; // drawn as HTML by the edit layer
    case "square": {
      const v = geometry.rectToView(item.rects![0]!);
      return <rect {...v} {...stroke} />;
    }
    case "circle": {
      const v = geometry.rectToView(item.rects![0]!);
      return (
        <ellipse
          cx={v.x + v.width / 2}
          cy={v.y + v.height / 2}
          rx={v.width / 2}
          ry={v.height / 2}
          {...stroke}
        />
      );
    }
    case "line":
    case "ink":
    case "arrow":
      return (
        <g>
          {(item.paths ?? []).map((path, i) => {
            const points = path.map((p) => geometry.toView(p));
            return (
              <g key={i}>
                <polyline
                  points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                  {...stroke}
                  fill="none"
                />
                {item.shape === "arrow" && (
                  <ArrowHead
                    from={points[0]!}
                    to={points.at(-1)!}
                    size={Math.max(6, item.width * 4) * geometry.scale}
                    stroke={stroke}
                  />
                )}
              </g>
            );
          })}
        </g>
      );
  }
}

/** Open arrow head at `to`, for a line from `from`. */
function ArrowHead({
  from,
  to,
  size,
  stroke,
}: {
  from: Point;
  to: Point;
  size: number;
  stroke: Record<string, unknown>;
}) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const wing = (turn: number) =>
    `${to.x + size * Math.cos(angle + turn)},${to.y + size * Math.sin(angle + turn)}`;
  return (
    <polyline
      points={`${wing((5 * Math.PI) / 6)} ${to.x},${to.y} ${wing((-5 * Math.PI) / 6)}`}
      {...stroke}
      fill="none"
    />
  );
}

function CreationPreview({
  tool,
  drag,
  color,
  width,
  fill,
}: {
  tool: Tool;
  drag: Extract<Drag, { kind: "create" }>;
  color: string;
  width: number;
  fill: string | null;
}) {
  const r = rectFromCorners(drag.start, drag.current);
  const stroke = { stroke: color, strokeWidth: width, fill: fill ?? "none" };
  switch (tool) {
    case "whiteout":
      return <rect {...r} fill="#fff" stroke="#888" strokeDasharray="4 3" />;
    case "redact":
      return (
        <rect
          {...r}
          fill="rgb(211 47 47 / 0.12)"
          stroke="#d32f2f"
          strokeWidth={2}
          strokeDasharray="5 3"
        />
      );
    case "square":
      return <rect {...r} {...stroke} />;
    case "circle":
      return (
        <ellipse
          cx={r.x + r.width / 2}
          cy={r.y + r.height / 2}
          rx={r.width / 2}
          ry={r.height / 2}
          {...stroke}
        />
      );
    case "line":
    case "arrow":
      return (
        <g>
          <line
            x1={drag.start.x}
            y1={drag.start.y}
            x2={drag.current.x}
            y2={drag.current.y}
            {...stroke}
          />
          {tool === "arrow" && (
            <ArrowHead
              from={drag.start}
              to={drag.current}
              size={Math.max(6, width * 4)}
              stroke={{ ...stroke, fill: "none" }}
            />
          )}
        </g>
      );
    case "ink":
      return (
        <polyline
          points={drag.points.map((p) => `${p.x},${p.y}`).join(" ")}
          {...stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    default:
      return null;
  }
}

/**
 * Object URLs for image previews, one per image. Images stay referenced by the
 * undo history for the whole session, so the URLs are not revoked.
 */
const imageUrls = new WeakMap<Uint8Array, string>();
function imageUrl(data: Uint8Array, mime: string): string {
  let url = imageUrls.get(data);
  if (!url) {
    url = URL.createObjectURL(new Blob([data.slice()], { type: mime }));
    imageUrls.set(data, url);
  }
  return url;
}

function ImagePreview({
  item,
  rotation,
  width,
  height,
}: {
  item: Extract<Item, { kind: "image" }>;
  rotation: number;
  width: number;
  height: number;
}) {
  const url = imageUrl(item.data, item.mime);
  const sideways = rotation % 180 !== 0;
  const w = sideways ? height : width;
  const h = sideways ? width : height;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      style={{
        position: "absolute",
        width: w,
        height: h,
        left: (width - w) / 2,
        top: (height - h) / 2,
        transform: `rotate(${rotation}deg)`,
      }}
    />
  );
}
