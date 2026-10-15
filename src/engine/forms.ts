import { t } from "../i18n";
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
  type PDFDocument,
  type PDFPage,
} from "pdf-lib";
import type {
  FontFamily,
  FormFieldItem,
  FormValueItem,
  Item,
} from "../model/document";
import { parseHexColor } from "./color";
import { STANDARD, type FontCache } from "./fonts";
import {
  FF,
  acroFormOf,
  annotPages,
  fieldKind,
  inherited,
  numberOf,
  onStateOf,
  optionsOf,
  parseDa,
  rawFields,
  rectOf,
  refKey,
  textOf,
  valueOf,
  type RawField,
} from "./formRead";
import {
  buttonAppearances,
  textAppearance,
  widgetLook,
} from "./formAppearance";

/**
 * Fills, creates and flattens AcroForm fields (spec 005, plan: forms). Only
 * fields that are filled or created get a new appearance; the rest keep
 * theirs.
 */

const SHORT: Record<FontFamily, string> = {
  Helvetica: "Helv",
  Times: "TiRo",
  Courier: "Cour",
};

const n = (v: number) => Number(v.toFixed(3));
const hex = (text: string) => PDFHexString.fromText(text);

function getOrCreateAcroForm(doc: PDFDocument): PDFDict {
  const existing = acroFormOf(doc);
  if (existing) return existing;
  const form = doc.context.obj({
    Fields: [],
    DA: PDFString.of("/Helv 0 Tf 0 g"),
  });
  doc.catalog.set(PDFName.of("AcroForm"), doc.context.register(form));
  return form;
}

function dictEntry(owner: PDFDict, key: string, doc: PDFDocument): PDFDict {
  const value = owner.lookup(PDFName.of(key));
  if (value instanceof PDFDict) return value;
  const dict = doc.context.obj({});
  owner.set(PDFName.of(key), dict);
  return dict;
}

function arrayEntry(owner: PDFDict, key: string, doc: PDFDocument): PDFArray {
  const value = owner.lookup(PDFName.of(key));
  if (value instanceof PDFArray) return value;
  const array = doc.context.obj([]);
  owner.set(PDFName.of(key), array);
  return array;
}

/** Puts the standard font of `family` in /DR under its short name. */
async function drFont(
  doc: PDFDocument,
  form: PDFDict,
  family: FontFamily,
  fonts: FontCache,
): Promise<string> {
  const name = SHORT[family];
  const dr = dictEntry(form, "DR", doc);
  const list = dictEntry(dr, "Font", doc);
  if (!list.has(PDFName.of(name)))
    list.set(
      PDFName.of(name),
      (await fonts.standard(STANDARD[family].Regular)).ref,
    );
  return name;
}

/** Creates the dictionaries of the fields made in pdfcraft (CA5). */
async function createFields(
  doc: PDFDocument,
  items: FormFieldItem[],
  pagesById: Map<string, PDFPage>,
  fonts: FontCache,
): Promise<Set<string>> {
  const created = new Set<string>();
  if (items.length === 0) return created;
  const ctx = doc.context;
  const form = getOrCreateAcroForm(doc);
  const fields = arrayEntry(form, "Fields", doc);
  const taken = new Set(rawFields(doc).map((f) => f.name));
  const groups = new Map<string, { ref: PDFRef; kids: PDFArray }>();
  const unique = (name: string) => {
    let candidate = name.trim() || t("engine.defaultFieldName");
    for (let i = 2; taken.has(candidate); i++) candidate = `${name}_${i}`;
    taken.add(candidate);
    return candidate;
  };

  for (const item of items) {
    const page = pagesById.get(item.pageId);
    if (!page) continue;
    const { rect, style } = item;
    const [r, g, b] = parseHexColor(style.color);
    const short = await drFont(doc, form, style.font, fonts);
    const da = `/${short} ${n(style.size)} Tf ${n(r)} ${n(g)} ${n(b)} rg`;
    const widget = ctx.obj({
      Type: "Annot",
      Subtype: "Widget",
      Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height].map(n),
      P: page.ref,
      F: 4,
      MK: { BC: [0.5, 0.5, 0.5] },
      BS: { W: 1, S: "S" },
    });
    let ff = item.required ? FF.required : 0;
    const q = { left: 0, center: 1, right: 2 }[item.align];

    if (item.field === "radio") {
      let group = groups.get(item.name);
      if (!group) {
        const name = unique(item.name);
        const kids = ctx.obj([]);
        const parent = ctx.obj({
          FT: "Btn",
          T: hex(name),
          Ff: ff | FF.radio | FF.noToggleToOff,
          V: "Off",
          Kids: kids,
        });
        group = { ref: ctx.register(parent), kids };
        groups.set(item.name, group);
        fields.push(group.ref);
        created.add(name);
      }
      const look = widgetLook(widget);
      const { on, off } = buttonAppearances(doc, look, "radio", style.color);
      const state =
        item.exportValue || t("engine.defaultOption", group.kids.size() + 1);
      widget.set(PDFName.of("Parent"), group.ref);
      widget.set(PDFName.of("AS"), PDFName.of("Off"));
      widget.set(PDFName.of("AP"), ctx.obj({ N: { [state]: on, Off: off } }));
      widget.set(PDFName.of("DA"), PDFString.of(da));
      const ref = ctx.register(widget);
      group.kids.push(ref);
      page.node.addAnnot(ref);
      continue;
    }

    const name = unique(item.name);
    widget.set(PDFName.of("T"), hex(name));
    widget.set(PDFName.of("DA"), PDFString.of(da));
    widget.set(PDFName.of("Q"), PDFNumber.of(q));
    switch (item.field) {
      case "text":
      case "multiline":
        widget.set(PDFName.of("FT"), PDFName.of("Tx"));
        if (item.field === "multiline") ff |= FF.multiline;
        if (item.maxLength) {
          widget.set(PDFName.of("MaxLen"), PDFNumber.of(item.maxLength));
          if (item.comb && item.field === "text")
            ff |= FF.comb | FF.doNotScroll;
        }
        widget.set(PDFName.of("V"), hex(""));
        break;
      case "checkbox": {
        widget.set(PDFName.of("FT"), PDFName.of("Btn"));
        const state = item.exportValue || "Yes";
        const look = widgetLook(widget);
        const { on, off } = buttonAppearances(
          doc,
          look,
          "checkbox",
          style.color,
        );
        widget.set(PDFName.of("V"), PDFName.of("Off"));
        widget.set(PDFName.of("AS"), PDFName.of("Off"));
        widget.set(PDFName.of("AP"), ctx.obj({ N: { [state]: on, Off: off } }));
        break;
      }
      case "dropdown":
      case "list": {
        widget.set(PDFName.of("FT"), PDFName.of("Ch"));
        const options = item.options ?? [];
        widget.set(PDFName.of("Opt"), ctx.obj(options.map(hex)));
        if (item.field === "dropdown") {
          ff |= FF.combo;
          widget.set(PDFName.of("V"), hex(options[0] ?? ""));
        } else if (item.multiSelect) ff |= FF.multiSelect;
        break;
      }
    }
    widget.set(PDFName.of("Ff"), PDFNumber.of(ff));
    const ref = ctx.register(widget);
    fields.push(ref);
    page.node.addAnnot(ref);
    created.add(name);
  }
  return created;
}

/** Writes `value` in a field and redraws its widgets (CA1–CA3). */
async function setField(
  doc: PDFDocument,
  fonts: FontCache,
  raw: RawField,
  value: string | string[] | undefined,
): Promise<void> {
  const kind = fieldKind(raw.chain);
  if (!kind || kind === "signature" || kind === "button" || kind === "password")
    return;
  const form = acroFormOf(doc);
  const dr = form?.lookup(PDFName.of("DR"));
  const formDa = textOf(form?.lookup(PDFName.of("DA"))) ?? "/Helv 0 Tf 0 g";
  const current = valueOf(raw.chain, kind);
  const next = value ?? current;
  const one = Array.isArray(next) ? (next[0] ?? "") : next;

  if (kind === "checkbox" || kind === "radio") {
    const state = one || "Off";
    raw.dict.set(PDFName.of("V"), PDFName.of(state));
    for (const { dict } of raw.widgets)
      dict.set(
        PDFName.of("AS"),
        PDFName.of(onStateOf(dict) === state ? state : "Off"),
      );
    return;
  }

  const options = optionsOf(raw.chain);
  const maxLength = numberOf(inherited(raw.chain, "MaxLen"));
  const ff = numberOf(inherited(raw.chain, "Ff")) ?? 0;
  let shown = one;
  let selected: number[] = [];
  if (kind === "text" || kind === "multiline") {
    if (maxLength !== undefined) shown = [...one].slice(0, maxLength).join("");
    raw.dict.set(PDFName.of("V"), hex(shown));
  } else if (kind === "dropdown") {
    raw.dict.set(PDFName.of("V"), hex(one));
    shown = options.find((o) => o.value === one)?.label ?? one;
  } else {
    const values = Array.isArray(next) ? next : next ? [next] : [];
    selected = values
      .map((v) => options.findIndex((o) => o.value === v))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    raw.dict.set(
      PDFName.of("V"),
      values.length === 1 ? hex(values[0]!) : doc.context.obj(values.map(hex)),
    );
    raw.dict.set(PDFName.of("I"), doc.context.obj(selected));
  }
  const q = numberOf(inherited(raw.chain, "Q")) ?? 0;
  for (const { dict } of raw.widgets) {
    const da =
      textOf(dict.lookup(PDFName.of("DA"))) ??
      textOf(inherited(raw.chain, "DA")) ??
      formDa;
    const ap = await textAppearance(doc, fonts, widgetLook(dict), {
      kind,
      value: shown,
      options: options.map((o) => o.label),
      selected,
      topIndex: numberOf(inherited(raw.chain, "TI")) ?? 0,
      align: (numberOf(dict.lookup(PDFName.of("Q"))) ?? q) as 0 | 1 | 2,
      maxLength,
      comb: (ff & FF.comb) !== 0 && maxLength !== undefined,
      style: parseDa(da, dr instanceof PDFDict ? dr : undefined),
    });
    dict.set(PDFName.of("AP"), doc.context.obj({ N: ap }));
  }
}

/**
 * Creates the fields of `items`, then writes the values (the last value of a
 * name wins). Runs before page items are drawn.
 */
export async function applyForms(
  doc: PDFDocument,
  items: Item[],
  pagesById: Map<string, PDFPage>,
  fonts: FontCache,
): Promise<void> {
  const fieldItems = items.filter(
    (i): i is FormFieldItem => i.kind === "formField",
  );
  const values = new Map<string, string | string[]>();
  for (const i of items)
    if (i.kind === "formValue") values.set((i as FormValueItem).name, i.value);
  if (fieldItems.length === 0 && values.size === 0) return;
  const created = await createFields(doc, fieldItems, pagesById, fonts);
  const form = acroFormOf(doc);
  // A hybrid XFA form would show its own data instead of these values.
  form?.delete(PDFName.of("XFA"));
  for (const raw of rawFields(doc))
    if (values.has(raw.name) || created.has(raw.name))
      await setField(doc, fonts, raw, values.get(raw.name));
}

/** True when the document has fields other than signatures. */
export function hasFillableFields(doc: PDFDocument): boolean {
  return rawFields(doc).some((f) => {
    const kind = fieldKind(f.chain);
    return kind !== null && kind !== "signature";
  });
}

/**
 * Draws every visible widget into its page and removes the fields, except
 * signature fields (CA6). `beforeDraw` runs once per page that receives
 * content, so the original content can be isolated first.
 */
export async function flattenForms(
  doc: PDFDocument,
  fonts: FontCache,
  beforeDraw: (page: PDFPage) => void,
): Promise<void> {
  const ctx = doc.context;
  const pages = doc.getPages();
  const annotPage = annotPages(doc);
  const prepared = new Set<PDFPage>();
  let kept = 0;
  for (const raw of rawFields(doc)) {
    const kind = fieldKind(raw.chain);
    if (kind === "signature" || kind === null) {
      kept++;
      continue;
    }
    // Fields without an appearance (NeedAppearances) get one from their value.
    if (
      kind !== "checkbox" &&
      kind !== "radio" &&
      kind !== "button" &&
      raw.widgets.some(({ dict }) => !normalAppearance(dict))
    )
      await setField(doc, fonts, raw, undefined);

    for (const { ref, dict } of raw.widgets) {
      const index = ref ? (annotPage.get(refKey(ref)) ?? -1) : -1;
      const page = pages[index];
      const flags = numberOf(dict.lookup(PDFName.of("F"))) ?? 0;
      const appearanceRef = normalAppearance(dict);
      const rect = rectOf(dict.lookup(PDFName.of("Rect")));
      if (page && appearanceRef && rect && (flags & (2 | 32)) === 0) {
        const stream = ctx.lookup(appearanceRef);
        if (stream instanceof PDFStream) {
          if (!prepared.has(page)) {
            beforeDraw(page);
            prepared.add(page);
          }
          const m = placement(stream.dict, rect);
          if (m) {
            const key = page.node.newXObject("FlatWidget", appearanceRef);
            page.pushOperators(
              pushGraphicsState(),
              concatTransformationMatrix(...m),
              drawObject(key),
              popGraphicsState(),
            );
          }
        }
      }
      if (ref) {
        page?.node.removeAnnot(ref);
        ctx.delete(ref);
      }
    }
    removeFromParent(doc, raw);
    if (raw.ref) ctx.delete(raw.ref);
  }
  if (kept === 0) doc.catalog.delete(PDFName.of("AcroForm"));
  else acroFormOf(doc)?.delete(PDFName.of("XFA"));
}

/** Reference of the normal appearance shown now (by /AS for buttons). */
function normalAppearance(widget: PDFDict): PDFRef | null {
  const ap = widget.lookup(PDFName.of("AP"));
  if (!(ap instanceof PDFDict)) return null;
  let normal = ap.get(PDFName.of("N"));
  const resolved =
    normal instanceof PDFRef ? widget.context.lookup(normal) : normal;
  if (resolved instanceof PDFDict && !(resolved instanceof PDFStream)) {
    const state = widget.lookup(PDFName.of("AS"));
    normal = state instanceof PDFName ? resolved.get(state) : undefined;
  }
  if (normal instanceof PDFRef) return normal;
  if (normal instanceof PDFStream) return widget.context.register(normal);
  return null;
}

/**
 * Matrix that maps the appearance box, after its /Matrix, onto the widget
 * rect (ISO 32000-1, §12.5.5). The Do operator applies /Matrix itself.
 */
function placement(
  stream: PDFDict,
  rect: { x: number; y: number; width: number; height: number },
): [number, number, number, number, number, number] | null {
  const bbox = rectOf(stream.lookup(PDFName.of("BBox")));
  if (!bbox || bbox.width === 0 || bbox.height === 0) return null;
  const mArray = stream.lookup(PDFName.of("Matrix"));
  const m =
    mArray instanceof PDFArray && mArray.size() === 6
      ? mArray.asArray().map((v) => numberOf(v) ?? 0)
      : [1, 0, 0, 1, 0, 0];
  const corners = [
    [bbox.x, bbox.y],
    [bbox.x + bbox.width, bbox.y],
    [bbox.x, bbox.y + bbox.height],
    [bbox.x + bbox.width, bbox.y + bbox.height],
  ].map(([x, y]) => [
    m[0]! * x! + m[2]! * y! + m[4]!,
    m[1]! * x! + m[3]! * y! + m[5]!,
  ]);
  const xs = corners.map((c) => c[0]!);
  const ys = corners.map((c) => c[1]!);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const sx = rect.width / (Math.max(...xs) - x0 || 1);
  const sy = rect.height / (Math.max(...ys) - y0 || 1);
  return [sx, 0, 0, sy, rect.x - x0 * sx, rect.y - y0 * sy];
}

function removeFromParent(doc: PDFDocument, raw: RawField) {
  if (!raw.ref) return;
  const parent = raw.chain[1];
  const list = parent
    ? parent.lookup(PDFName.of("Kids"))
    : acroFormOf(doc)?.lookup(PDFName.of("Fields"));
  if (!(list instanceof PDFArray)) return;
  const index = list
    .asArray()
    .findIndex((e) => e instanceof PDFRef && refKey(e) === refKey(raw.ref!));
  if (index >= 0) list.remove(index);
}
