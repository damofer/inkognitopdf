// Spanish messages: ocr.
export const ocr = {
  "ocr.langSpa": "Español",
  "ocr.langEng": "Inglés",
  "ocr.langSpaEng": "Español e inglés",

  "ocr.title": "Reconocer texto",
  "ocr.heading": "Reconocer texto (OCR)",
  "ocr.close": "Cerrar OCR",
  "ocr.pages": "Páginas",
  "ocr.scopeScanned": "Solo las escaneadas",
  "ocr.scopeAll": "Todas",
  "ocr.scopeRange": "Rango",
  "ocr.rangeLabel": "Rango de páginas",
  "ocr.includeText": "Incluir páginas que ya tienen texto",
  "ocr.language": "Idioma",
  "ocr.cancel": "Cancelar",
  "ocr.recognize": "Reconocer",
  "ocr.exportTxt": "Exportar .txt",
  "ocr.note":
    "El texto se reconoce en este dispositivo; no sale de él. Las palabras dudosas se marcan en naranja (solo en pantalla).",
  "ocr.defaultFileName": "documento",

  "ocr.statusLoadingCore": "Cargando el motor",
  "ocr.statusInitializing": "Iniciando el motor",
  "ocr.statusLoadingLang": "Cargando el idioma",
  "ocr.statusInitApi": "Preparando",
  "ocr.statusRecognizing": "Reconociendo",

  "ocr.pageOf": (page: number, total: number) => `Página ${page} de ${total}`,
  "ocr.checking": (label: string) => `${label}: comprobando`,
  "ocr.progress": (label: string, status: string, percent: number) =>
    `${label}: ${status} ${percent} %`,
  "ocr.preparing": (label: string) => `${label}: preparando la imagen`,
  "ocr.cancelled": "OCR cancelado.",
  "ocr.done": (done: number, skipped: number) =>
    (done === 1 ? "Reconocida 1 página." : `Reconocidas ${done} páginas.`) +
    (skipped > 0 ? ` ${skipped} sin cambios (con texto o en blanco).` : ""),
  "ocr.error": (message: string) => `Error en el OCR: ${message}`,
};
