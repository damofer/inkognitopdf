import { t } from "../i18n";

export type Tool =
  | "select"
  | "text"
  | "editText"
  | "image"
  | "whiteout"
  | "highlight"
  | "underline"
  | "strikeout"
  | "note"
  | "freeText"
  | "ink"
  | "line"
  | "arrow"
  | "square"
  | "circle"
  // Creates and edits form fields (spec 005).
  | "formField"
  // Marks areas for secure redaction (spec 012).
  | "redact"
  // Places the signature, initials or date chosen in the signing panel.
  | "place";

/** A tool of the toolbar; `label` is read in the current language. */
export interface ToolButton {
  tool: Tool;
  readonly label: string;
  icon: string;
}

const button = (tool: Exclude<Tool, "place">, icon: string): ToolButton => ({
  tool,
  icon,
  get label() {
    return t(`tools.${tool}`);
  },
});

export const TOOLS: ToolButton[] = [
  button("select", "⬉"),
  button("text", "T"),
  button("editText", "T✎"),
  button("image", "🖼"),
  button("whiteout", "▭"),
  button("redact", "▬"),
  button("highlight", "🖍"),
  button("underline", "U̲"),
  button("strikeout", "S̶"),
  button("note", "🗨"),
  button("freeText", "A▭"),
  button("ink", "✎"),
  button("line", "╱"),
  button("arrow", "↗"),
  button("square", "□"),
  button("circle", "◯"),
  button("formField", "☑"),
];

/** Hint of each tool, read in the current language. */
/** Help for each tool (and for placing an item). */
export const TOOL_HINTS: Readonly<Record<Tool, string>> =
  Object.defineProperties(
    {} as Record<Tool, string>,
    Object.fromEntries(
      [...TOOLS.map((b) => b.tool), "place" as const].map((tool) => [
        tool,
        { enumerable: true, get: () => t(`tools.${tool}Hint`) },
      ]),
    ),
  );

/** Help that says "tap" on touch screens, without keyboard shortcuts. */
const TOUCH_HINTS: Partial<
  Record<
    Tool,
    `tools.${"select" | "text" | "editText" | "image" | "note" | "freeText" | "formField" | "redact" | "place"}HintTouch`
  >
> = {
  select: "tools.selectHintTouch",
  text: "tools.textHintTouch",
  editText: "tools.editTextHintTouch",
  image: "tools.imageHintTouch",
  note: "tools.noteHintTouch",
  freeText: "tools.freeTextHintTouch",
  formField: "tools.formFieldHintTouch",
  redact: "tools.redactHintTouch",
  place: "tools.placeHintTouch",
};

/** The help for a tool, worded for a finger or for a mouse (spec 009). */
export function toolHint(tool: Tool, touch: boolean): string {
  const key = touch ? TOUCH_HINTS[tool] : undefined;
  return key ? t(key) : TOOL_HINTS[tool];
}

/** Tools whose drag on the page creates a shape. */
export const DRAG_TOOLS: ReadonlySet<Tool> = new Set([
  "whiteout",
  "redact",
  "ink",
  "line",
  "arrow",
  "square",
  "circle",
]);

/** Tools that mark selected page text (spec 005). */
export const TEXT_TOOLS: ReadonlySet<Tool> = new Set([
  "highlight",
  "underline",
  "strikeout",
]);
