// Spanish messages: merging and splitting (spec 013).
export const organize = {
  "organize.encrypted": (file: string) =>
    `«${file}» está protegido con contraseña; todavía no se puede unir.`,
  "organize.unreadable": (file: string) =>
    `No se pudo leer «${file}» como PDF.`,
  "organize.badRange": (part: string) =>
    `«${part}» no es un rango de páginas (ejemplos: 3, 1-4, 8-).`,
  "organize.outOfRange": (part: string, count: number) =>
    `El rango «${part}» no está entre 1 y ${count}.`,
  "organize.noRanges": "Escribe al menos un rango de páginas.",
  "organize.badEvery": "El número de páginas por archivo debe ser 1 o más.",
  "organize.insert": "Insertar PDF",
  "organize.insertHint": "Añade al final las páginas de otros PDF",
  "organize.inserting": "Insertando…",
  "organize.inserted": (pages: number) =>
    pages === 1
      ? "Se añadió 1 página al final."
      : `Se añadieron ${pages} páginas al final.`,
  "organize.insertFailed": (reason: string) =>
    `No se pudo insertar el PDF: ${reason}`,
  "organize.dragHint": "Arrastra las miniaturas para cambiar el orden.",
  "organize.split": "Dividir",
  "organize.splitHint": "Divide el documento o extrae páginas",
  "organize.splitTitle": "Dividir o extraer páginas",
  "organize.mode": "Cómo dividir",
  "organize.byRanges": "Por rangos",
  "organize.byEvery": "Cada N páginas",
  "organize.bySelection": "Páginas elegidas",
  "organize.ranges": "Rangos de páginas",
  "organize.rangesHelp": "Un archivo por rango, separados por comas.",
  "organize.every": "Páginas por archivo",
  "organize.pick": "Páginas que se extraen",
  "organize.page": (n: number) => `Página ${n}`,
  "organize.all": "Todas",
  "organize.none": "Ninguna",
  "organize.pickNone": "Elige al menos una página.",
  "organize.preview": (files: number) =>
    files === 1
      ? "Se descargará 1 archivo:"
      : `Se descargarán ${files} archivos en un ZIP:`,
  "organize.more": (files: number) => `y ${files} más…`,
  "organize.download": (files: number) =>
    files === 1 ? "Descargar PDF" : `Descargar ZIP (${files} archivos)`,
  "organize.working": "Preparando…",
  "organize.pagesSuffix": (pages: string) => `páginas ${pages}`,
  "organize.partsSuffix": "partes",
  "organize.splitDone": (files: number) =>
    files === 1 ? "PDF descargado." : `ZIP descargado con ${files} archivos.`,
  "organize.splitFailed": (reason: string) => `No se pudo dividir: ${reason}`,
  "organize.close": "Cerrar",
};
