// Spec 032: what the writer's toolbar and keys do to the document, and what
// the toolbar shows for the current selection.
import {
  baseKeymap,
  chainCommands,
  exitCode,
  toggleMark,
} from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import {
  InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { Mark, MarkType, Node, NodeType } from "prosemirror-model";
import {
  liftListItem,
  sinkListItem,
  splitListItem,
  wrapInList,
} from "prosemirror-schema-list";
import {
  EditorState,
  NodeSelection,
  Plugin,
  TextSelection,
  type Command,
  type Transaction,
} from "prosemirror-state";
import {
  DEFAULT_SPACING,
  schema,
  type Align,
  type HeadingLevel,
  type WriterFamily,
} from "./schema";

const { nodes, marks } = schema;

/** Applies `mark` to the selection, or to what is typed next. */
export function setMark(
  type: MarkType,
  attrs: Record<string, unknown> | null,
): Command {
  return (state, dispatch) => {
    const { from, to, empty } = state.selection;
    if (!dispatch) return true;
    const tr = state.tr;
    if (empty) {
      const stored = (
        state.storedMarks ?? state.selection.$from.marks()
      ).filter((m) => m.type !== type);
      tr.setStoredMarks(attrs ? [...stored, type.create(attrs)] : stored);
    } else {
      tr.removeMark(from, to, type);
      if (attrs) tr.addMark(from, to, type.create(attrs));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Removes every mark and turns the blocks into normal paragraphs. */
export const clearFormatting: Command = (state, dispatch) => {
  if (!dispatch) return true;
  const { from, to, empty } = state.selection;
  const tr = state.tr;
  if (empty) tr.setStoredMarks([]);
  else for (const type of Object.values(marks)) tr.removeMark(from, to, type);
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type === nodes.heading) {
      tr.setNodeMarkup(pos, nodes.paragraph, {
        align: node.attrs.align as Align,
        spacing: node.attrs.spacing as number,
      });
    }
  });
  dispatch(tr.scrollIntoView());
  return true;
};

/** Sets an attribute on every paragraph and heading of the selection. */
function setBlockAttr(name: "align" | "spacing", value: unknown): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    const tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === nodes.paragraph || node.type === nodes.heading)
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, [name]: value });
    });
    if (!tr.docChanged) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

export const setAlign = (align: Align) => setBlockAttr("align", align);
export const setSpacing = (spacing: number) => setBlockAttr("spacing", spacing);

/** Normal text (level 0) or a heading level, keeping alignment and spacing. */
export function setStyle(level: 0 | HeadingLevel): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    const tr = state.tr;
    state.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (!node.isTextblock) return true;
      // List items start with a paragraph: headings are not allowed there.
      if (level && parent?.type === nodes.list_item) return false;
      const attrs = {
        align: node.attrs.align as Align,
        spacing: node.attrs.spacing as number,
      };
      if (level) tr.setNodeMarkup(pos, nodes.heading, { ...attrs, level });
      else tr.setNodeMarkup(pos, nodes.paragraph, attrs);
      return false;
    });
    if (!tr.docChanged) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

/** The list the cursor is in, closest first: its type and position. */
function listAround(state: EditorState): { node: Node; pos: number } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type === nodes.bullet_list || node.type === nodes.ordered_list)
      return { node, pos: $from.before(d) };
  }
  return null;
}

/** Starts, ends or changes the kind of a list, as Word's list buttons. */
export function toggleList(type: NodeType): Command {
  return (state, dispatch) => {
    const list = listAround(state);
    if (list?.node.type === type)
      return liftListItem(nodes.list_item!)(state, dispatch);
    if (list) {
      dispatch?.(state.tr.setNodeMarkup(list.pos, type).scrollIntoView());
      return true;
    }
    // Headings become paragraphs first: list items start with a paragraph.
    // Both changes go in one transaction, one step for undo.
    const tr = state.tr;
    const { from, to } = state.selection;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type === nodes.heading)
        tr.setNodeMarkup(pos, nodes.paragraph, {
          align: node.attrs.align as Align,
          spacing: node.attrs.spacing as number,
        });
    });
    const prepared = tr.docChanged ? state.apply(tr) : state;
    let wrapped = false;
    wrapInList(type)(prepared, (wrap) => {
      wrap.steps.forEach((step) => tr.step(step));
      wrapped = true;
    });
    if (!wrapped) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

export const indent = sinkListItem(nodes.list_item!);
export const outdent = liftListItem(nodes.list_item!);

/** Inserts a block and puts the cursor in the paragraph after it. */
export function insertBlock(node: Node): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const tr = state.tr.replaceSelectionWith(node);
    // The inserted block ends where the selection is mapped to; typing must
    // go below it, not replace it.
    const inserted = tr.selection;
    const atom = inserted instanceof NodeSelection;
    if (atom || !inserted.$from.parent.isTextblock) {
      const after = Math.min(
        node
          ? inserted.to
          : inserted.$from.depth
            ? inserted.$from.after(1)
            : inserted.to,
        tr.doc.content.size,
      );
      if (!tr.doc.nodeAt(after)?.isTextblock)
        tr.insert(after, nodes.paragraph!.create());
      tr.setSelection(TextSelection.create(tr.doc, after + 1));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

export const insertPageBreak = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
) => insertBlock(nodes.page_break!.create())(state, dispatch);
export const insertRule = (
  state: EditorState,
  dispatch?: (tr: Transaction) => void,
) => insertBlock(nodes.horizontal_rule!.create())(state, dispatch);

/** Changes the width of the selected image. */
export function setImageWidth(width: number): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    if (!(sel instanceof NodeSelection) || sel.node.type !== nodes.image)
      return false;
    dispatch?.(
      state.tr.setNodeMarkup(sel.from, undefined, { ...sel.node.attrs, width }),
    );
    return true;
  };
}

const markActive = (state: EditorState, type: MarkType) => {
  const { from, to, empty, $from } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks ?? $from.marks());
  return state.doc.rangeHasMark(from, to, type);
};

/** The mark of a type at the cursor or at the start of the selection. */
function markAt(state: EditorState, type: MarkType): Mark | undefined {
  const { empty, $from, from, to } = state.selection;
  if (empty)
    return type.isInSet(state.storedMarks ?? $from.marks()) ?? undefined;
  let found: Mark | undefined;
  state.doc.nodesBetween(from, to, (node) => {
    if (found || !node.isText) return !found;
    found = type.isInSet(node.marks) ?? undefined;
    return false;
  });
  return found;
}

/** What the toolbar shows for the selection. */
export interface Formats {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string | null;
  highlight: string | null;
  family: WriterFamily | null;
  size: number | null;
  /** 0 for normal text. */
  level: 0 | HeadingLevel;
  align: Align;
  spacing: number;
  list: "bullet" | "ordered" | null;
  /** Width of the selected image, or null when no image is selected. */
  imageWidth: number | null;
}

export function formatsOf(state: EditorState): Formats {
  const block = state.selection.$from.parent;
  const list = listAround(state);
  const sel = state.selection;
  return {
    bold: markActive(state, marks.strong!),
    italic: markActive(state, marks.em!),
    underline: markActive(state, marks.underline!),
    strike: markActive(state, marks.strike!),
    color: (markAt(state, marks.color!)?.attrs.color as string) ?? null,
    highlight: (markAt(state, marks.highlight!)?.attrs.color as string) ?? null,
    family: (markAt(state, marks.font!)?.attrs.family as WriterFamily) ?? null,
    size: (markAt(state, marks.size!)?.attrs.size as number) ?? null,
    level:
      block.type === nodes.heading ? (block.attrs.level as HeadingLevel) : 0,
    align: (block.attrs.align as Align | undefined) ?? "left",
    spacing: (block.attrs.spacing as number | undefined) ?? DEFAULT_SPACING,
    list: !list
      ? null
      : list.node.type === nodes.ordered_list
        ? "ordered"
        : "bullet",
    imageWidth:
      sel instanceof NodeSelection && sel.node.type === nodes.image
        ? (sel.node.attrs.width as number)
        : null,
  };
}

/**
 * After an image, a line or a page break at the end there is always a
 * paragraph, so the user can keep writing below it.
 */
const trailingParagraph = new Plugin({
  appendTransaction: (_trs, _old, state) => {
    const last = state.doc.lastChild;
    if (!last?.isAtom) return null;
    return state.tr.insert(state.doc.content.size, nodes.paragraph!.create());
  },
});

/** Word-like shortcuts while typing: "- " starts a list, "1. " a numbered one. */
const autoFormat = inputRules({
  rules: [
    wrappingInputRule(/^\s*([-*•])\s$/, nodes.bullet_list!),
    wrappingInputRule(
      /^(\d+)\.\s$/,
      nodes.ordered_list!,
      (match) => ({ order: Number(match[1]) }),
      (match, node) =>
        node.childCount + (node.attrs.order as number) === Number(match[1]),
    ),
    textblockTypeInputRule(/^(#{1,3})\s$/, nodes.heading!, (match) => ({
      level: match[1]!.length,
    })),
    new InputRule(/--$/, "–"),
  ],
});

const hardBreak = chainCommands(exitCode, (state, dispatch) => {
  dispatch?.(
    state.tr.replaceSelectionWith(nodes.hard_break!.create()).scrollIntoView(),
  );
  return true;
});

export function writerPlugins(): Plugin[] {
  return [
    autoFormat,
    keymap({
      "Mod-z": undo,
      // i18n-ignore: key name
      "Mod-y": redo,
      "Shift-Mod-z": redo,
      "Mod-b": toggleMark(marks.strong!),
      "Mod-i": toggleMark(marks.em!),
      "Mod-u": toggleMark(marks.underline!),
      "Alt-Shift-5": toggleMark(marks.strike!),
      "Mod-Shift-x": toggleMark(marks.strike!),
      "Mod-Alt-0": setStyle(0),
      "Mod-Alt-1": setStyle(1),
      "Mod-Alt-2": setStyle(2),
      "Mod-Alt-3": setStyle(3),
      "Mod-Shift-7": toggleList(nodes.ordered_list!),
      "Mod-Shift-8": toggleList(nodes.bullet_list!),
      "Mod-Shift-l": setAlign("left"),
      "Mod-Shift-e": setAlign("center"),
      "Mod-Shift-r": setAlign("right"),
      "Mod-Shift-j": setAlign("justify"),
      "Mod-Enter": insertPageBreak,
      "Shift-Enter": hardBreak,
      Enter: splitListItem(nodes.list_item!),
      Tab: (state, dispatch) =>
        listAround(state)
          ? (indent(state, dispatch), true)
          : (dispatch?.(state.tr.insertText("    ")), true),
      "Shift-Tab": (state, dispatch) =>
        listAround(state) ? (outdent(state, dispatch), true) : false,
    }),
    keymap(baseKeymap),
    history(),
    trailingParagraph,
  ];
}

export function emptyDoc(): Node {
  return nodes.doc!.create(null, nodes.paragraph!.create());
}

export function createState(doc: Node = emptyDoc()): EditorState {
  return EditorState.create({
    doc,
    plugins: writerPlugins(),
    selection: TextSelection.atStart(doc),
  });
}

/** True when nothing has been written yet. */
export const isEmptyDoc = (doc: Node) =>
  doc.childCount === 1 &&
  doc.firstChild!.type === nodes.paragraph &&
  doc.firstChild!.content.size === 0;

export { undo, redo, toggleMark };
