// Spanish messages: open with InkognitoPDF and share (spec 017).
export const share = {
  "share.button": "Compartir",
  /** «Guardar PDF» in the phone bar, next to the share icon. */
  "share.saveShort": "Guardar",
  "share.hint": "Enviar el PDF a otra app: correo, mensajería, Drive…",
  "share.preparing": "Preparando…",
  "share.readyTitle": "El PDF está listo para compartir",
  "share.ready": (name: string) =>
    `«${name}» está preparado. Toca «Compartir» para elegir la app.`,
  "share.now": "Compartir",
  "share.cancel": "Cancelar",
  "share.failed": (reason: string) => `No se pudo compartir: ${reason}`,
  "share.nothing": "No llegó ningún PDF para abrir.",
};
