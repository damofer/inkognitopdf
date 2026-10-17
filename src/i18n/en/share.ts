// English messages: open with InkognitoPDF and share (spec 017).
import type { share as es } from "../es/share";

export const share: typeof es = {
  "share.button": "Share",
  "share.saveShort": "Save",
  "share.hint": "Send the PDF to another app: email, messaging, Drive…",
  "share.preparing": "Preparing…",
  "share.readyTitle": "The PDF is ready to share",
  "share.ready": (name: string) =>
    `"${name}" is ready. Tap "Share" to choose the app.`,
  "share.now": "Share",
  "share.cancel": "Cancel",
  "share.failed": (reason: string) => `Could not share: ${reason}`,
  "share.nothing": "No PDF arrived to open.",
};
