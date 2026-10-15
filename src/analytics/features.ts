// Spec 011: which feature an item added to the document stands for.
import type { Item } from "../model/document";
import type { EventName } from "./events";

export function featureOf(item: Item): EventName | null {
  switch (item.kind) {
    case "text":
      return "add_text";
    case "image":
      return "add_image";
    case "whiteout":
      return "whiteout";
    case "annotation":
    case "annotRemoval":
      return "annotate";
    case "textEdit":
      return item.background === undefined ? "edit_text" : "edit_scan_text";
    case "ocr":
      return "ocr_run";
    case "signature":
    case "signField":
      return "sign_document";
    case "formValue":
      return "fill_form";
    case "formField":
      return "create_field";
    case "redaction":
      return "redact";
  }
}
