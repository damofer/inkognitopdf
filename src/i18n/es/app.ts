// Spanish messages: app shell (header, start screen, language switch).
export const app = {
  "app.version": "Versión de la app",
  "app.openPdf": "Abrir PDF",
  "app.blankDocument": "Documento en blanco",
  "app.blankShort": "En blanco",
  "app.scan": "Escanear",
  "app.newDocument": "Documento nuevo",
  "app.emptyHint":
    "Abre o arrastra un PDF, o empieza con un documento en blanco. Tus documentos se procesan solo en este dispositivo.",
  "app.merging": (files: number) => `Uniendo ${files} PDF…`,
  "app.opening": (name: string) => `Abriendo «${name}»…`,
  "app.home": "Ir a la página de inicio de InkognitoPDF",
  "app.sourceCode": "Código fuente",
  "app.sourceCodeHint": "Código abierto en GitHub (se abre en otra pestaña)",
  "app.description":
    "Editor de PDF open source que procesa tus documentos en tu dispositivo.",
  "draft.title": "Tienes trabajo sin guardar",
  "draft.detail": (name: string, when: string) =>
    `«${name}», editado ${when}. Está guardado solo en este dispositivo.`,
  "draft.resume": "Retomar",
  "draft.discard": "Descartar",
  "draft.resuming": (name: string) => `Recuperando «${name}»…`,
  "draft.failed": (reason: string) =>
    `No se pudo recuperar el trabajo sin guardar: ${reason}`,
  "lang.label": "Idioma",
  // Each language is named in itself, in both dictionaries.
  "lang.es": "Español",
  "lang.en": "English",
};
