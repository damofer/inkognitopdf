// Spanish messages: PDF engine, document model and storage.
export const engine = {
  // Field types of a signing plan (model/signature.ts).
  "signField.signature": "Firma",
  "signField.initials": "Iniciales",
  "signField.date": "Fecha",
  "signField.name": "Nombre",
  "signField.text": "Texto",

  // Saving (engine/applyEdits.ts, textEdit.ts, forms.ts, ttfSubset.ts).
  "engine.encrypted":
    "El PDF está cifrado. Esta versión todavía no puede guardar PDFs protegidos.",
  "engine.fallbackFonts":
    "Algunos caracteres no existen en las fuentes estándar; se usó su equivalente libre (Arimo, Tinos o Cousine).",
  "engine.missingPage": (page: number) =>
    `La página ${page} no existe en el original.`,
  "engine.substituteFont": (text: string, font: string) =>
    `La fuente original de «${text}» no tiene todos los caracteres del texto nuevo; se usó una fuente sustituta (${font}).`,
  "engine.textNotFound": (text: string) =>
    `No se encontró el texto «${text}» en el contenido de la página; se tapó con blanco, pero puede seguir en el archivo.`,
  "engine.notTrueType": "La fuente no es TrueType con contornos glyf.",
  /** Default name of a new form field (a PDF field name: no spaces). */
  "engine.defaultFieldName": "campo",
  /** Export value of a radio button without one (a PDF name: no spaces). */
  "engine.defaultOption": (n: number) => `Opcion${n}`,

  // Page and item operations (model/operations.ts).
  "operations.unknownPage": (id: string) => `Página desconocida: ${id}`,
  "operations.duplicateItem": (id: string) => `Elemento duplicado: ${id}`,
  "operations.unknownItem": (id: string) => `Elemento desconocido: ${id}`,
  "operations.lastPage": "Un PDF debe conservar al menos una página.",
  "operations.duplicatePage": (id: string) => `Página duplicada: ${id}`,

  // Storage.
  "storage.noIndexedDb": "IndexedDB no disponible.",
  "storage.notAPdf": (name: string) =>
    `«${name}» no parece un PDF (no se encontró la cabecera %PDF-).`,
};
