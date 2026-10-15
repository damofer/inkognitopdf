// English messages: editing overlay of a page.
import type { editLayer as es } from "../es/editLayer";

export const editLayer: typeof es = {
  "editLayer.text": "Text",
  "editLayer.noteText": "Note text",
  "editLayer.freeText": "Free text",
  "editLayer.typedLook":
    "This line looks handwritten or unclear: the new text will look typed.",
  "editLayer.draftActions": "Text being edited",
  "editLayer.cancel": "Cancel",
  "editLayer.accept": "Accept",
  "editLayer.lowConfidence": (confidence: number, text: string) =>
    `Low confidence (${confidence}): “${text}”`,
  "editLayer.fieldText": "text",
  "editLayer.fieldCheckbox": "checkbox",
  "editLayer.fieldRadio": "group",
  "editLayer.fieldDropdown": "dropdown",
  "editLayer.fieldList": "list",
  "editLayer.checkboxValue": "Yes",
  "editLayer.radioValue": (n: number) => `Option${n}`,
  "editLayer.option": (n: number) => `Option ${n}`,
};
