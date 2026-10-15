// English messages: editing tools (names and hints).
import type { tools as es } from "../es/tools";

export const tools: typeof es = {
  "tools.select": "Select",
  "tools.text": "Text",
  "tools.editText": "Edit text",
  "tools.image": "Image",
  "tools.whiteout": "Whiteout",
  "tools.highlight": "Highlight",
  "tools.underline": "Underline",
  "tools.strikeout": "Strikethrough",
  "tools.note": "Note",
  "tools.freeText": "Free text",
  "tools.ink": "Draw",
  "tools.line": "Line",
  "tools.arrow": "Arrow",
  "tools.square": "Rectangle",
  "tools.circle": "Ellipse",
  "tools.formField": "Fields",
  "tools.redact": "Secure redaction",

  "tools.selectHint":
    "Click an item or an annotation to select it; drag it to move it. Delete removes it. Double-click a note or a free text to change its text. Form fields are filled in here.",
  "tools.textHint": "Click the page to type. Ctrl+Enter finishes; Esc cancels.",
  "tools.editTextHint":
    "Click text in the document to change it, also on scanned pages with recognized text (OCR). Ctrl+Enter finishes; Esc cancels.",
  "tools.imageHint":
    "Click the page to place the image. Hold Shift while resizing to change the proportions.",
  "tools.whiteoutHint":
    'Drag to cover an area with white. Warning: whiteout is not secure redaction; the text underneath is still in the file. To remove it, use "Secure redaction".',
  "tools.highlightHint": "Select text on the page to highlight it.",
  "tools.underlineHint": "Select text on the page to underline it.",
  "tools.strikeoutHint": "Select text on the page to strike it through.",
  "tools.noteHint":
    "Click the page to leave a note. Ctrl+Enter finishes; Esc cancels.",
  "tools.freeTextHint":
    "Click the page to type a free text (an annotation). Ctrl+Enter finishes; Esc cancels.",
  "tools.inkHint": "Drag to draw freehand.",
  "tools.lineHint": "Drag to draw a line.",
  "tools.arrowHint": "Drag to draw an arrow.",
  "tools.squareHint": "Drag to draw a rectangle.",
  "tools.circleHint": "Drag to draw an ellipse.",
  "tools.formFieldHint":
    "Click the page to create a field of the chosen type. Click a created field to change its properties, move it or resize it; Delete removes it.",
  "tools.redactHint":
    'Drag to mark areas to redact, or search for a word or a pattern. Then "Apply redaction": saving removes everything underneath from the file.',
  "tools.placeHint":
    "Click the page to place the item. Then you can move it and resize it. Esc cancels.",

  "tools.selectHintTouch":
    "Tap an item or an annotation to select it; drag it to move it. Double-tap a note or free text to change its text. Form fields are filled in here.",
  "tools.textHintTouch": "Tap the page to type.",
  "tools.editTextHintTouch":
    "Tap text in the document to change it, also on scanned pages with recognized text (OCR).",
  "tools.imageHintTouch": "Tap the page to place the image.",
  "tools.noteHintTouch": "Tap the page to leave a note.",
  "tools.freeTextHintTouch": "Tap the page to type free text (an annotation).",
  "tools.formFieldHintTouch":
    "Tap the page to create a field of the chosen type. Tap a created field to change its properties, move it or resize it.",
  "tools.redactHintTouch":
    'Drag to mark areas to redact, or search for a word or a pattern. Then "Apply redaction": saving removes everything underneath from the file.',
  "tools.placeHintTouch":
    "Tap the page to place the item. Then you can move and resize it.",
};
