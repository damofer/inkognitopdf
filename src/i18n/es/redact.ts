// Spanish messages: secure redaction (spec 012).
export const redact = {
  "redact.label": "Borrado seguro",
  "redact.pendingMark": "Zona marcada para borrar (sin aplicar)",
  "redact.appliedMark": "Zona borrada",
  "redact.search": "Buscar para borrar",
  "redact.searchPlaceholder": "Palabra, número o patrón",
  "redact.regex": "Expresión regular",
  "redact.markMatches": "Marcar coincidencias",
  "redact.found": (n: number) =>
    n === 1 ? "1 coincidencia marcada." : `${n} coincidencias marcadas.`,
  "redact.notFound": "No se encontró en el texto del documento.",
  "redact.badRegex": "La expresión regular no es válida.",
  "redact.searching": "Buscando…",
  "redact.apply": (n: number) => `Aplicar borrado (${n})`,
  "redact.confirmTitle": "¿Aplicar el borrado seguro?",
  "redact.confirmBody": (n: number) =>
    `${n === 1 ? "La zona marcada se borrará" : `Las ${n} zonas marcadas se borrarán`} al guardar: el texto, las imágenes, los dibujos, las anotaciones y los campos que haya debajo se eliminan del archivo y se tapan en negro.`,
  "redact.confirmWarning":
    "No se podrá deshacer en el archivo guardado. En el editor puedes deshacer hasta que guardes.",
  "redact.clearMetadata":
    "Borrar también los metadatos del documento (título, autor, asunto, palabras clave, programa)",
  "redact.elsewhereSearching":
    "Buscando el mismo texto en otras partes del archivo…",
  "redact.elsewhereTitle": "Ese texto también aparece fuera de las zonas, en:",
  "redact.elsewhereAnnotations": (n: number) =>
    n === 1 ? "1 nota o comentario" : `${n} notas o comentarios`,
  "redact.elsewhereBookmarks": (n: number) =>
    n === 1 ? "1 marcador" : `${n} marcadores`,
  "redact.elsewhereAttachments": (n: number) =>
    n === 1 ? "1 archivo adjunto" : `${n} archivos adjuntos`,
  "redact.elsewhereFields": (n: number) =>
    n === 1 ? "1 campo de formulario" : `${n} campos de formulario`,
  "redact.elsewhereMetadata": (n: number) =>
    n === 1
      ? "1 dato de los metadatos (título, autor, asunto o palabras clave)"
      : `${n} datos de los metadatos (título, autor, asunto o palabras clave)`,
  "redact.elsewhereRemove": "Quitar también estas apariciones",
  "redact.elsewhereRemoveNote":
    "Se eliminan las notas y los adjuntos que lo contienen, se quitan los marcadores (sus submarcadores se conservan), se vacían los campos y se borran esos metadatos.",
  "redact.elsewhereKept":
    "Si no las quitas, ese texto seguirá en el archivo guardado aunque las zonas se borren.",
  "redact.elsewhereNone":
    "No aparece en notas, marcadores, adjuntos, campos ni metadatos.",
  "redact.confirm": "Aplicar borrado",
  "redact.cancel": "Cancelar",
  "redact.imageRemoved": (page: number) =>
    `Una imagen de la página ${page} bajo una zona de borrado no se pudo procesar y se quitó entera de la página.`,
  "redact.pending": (n: number) =>
    n === 1
      ? "Hay 1 zona marcada para borrar sin aplicar: su contenido no se borró."
      : `Hay ${n} zonas marcadas para borrar sin aplicar: su contenido no se borró.`,
};
