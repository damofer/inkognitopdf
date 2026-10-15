// Spanish messages: scan.
export const scan = {
  "scan.title": "Escanear documento",
  "scan.takePhoto": "Hacer foto",
  "scan.chooseImages": "Elegir imágenes",
  "scan.autoDetect": "Detección automática",
  "scan.size": "Tamaño",
  "scan.pageSize": "Tamaño de página",
  "scan.sizeAuto": "Automático",
  "scan.sizeLetter": "Carta",
  "scan.withOcr": "Reconocer texto (OCR)",
  "scan.savePdf": "Guardar PDF",
  "scan.addToDocument": "Añadir al documento",
  "scan.openInEditor": "Abrir en el editor",
  "scan.close": "Cerrar",
  "scan.hint":
    "Haz una foto de una hoja o elige imágenes. Se procesan solo en este dispositivo.",

  "scan.cornersCross":
    "Las esquinas se cruzan: colócalas en el orden de la hoja.",
  "scan.detectedEdges": "Bordes detectados",
  "scan.fullImage": "Imagen completa",
  "scan.continue": "Continuar",
  "scan.cornerTopLeft": "Esquina superior izquierda",
  "scan.cornerTopRight": "Esquina superior derecha",
  "scan.cornerBottomRight": "Esquina inferior derecha",
  "scan.cornerBottomLeft": "Esquina inferior izquierda",
  "scan.photoAlt": (name: string) => `Foto ${name}`,

  "scan.resultAlt": (page: number) => `Página escaneada ${page}`,
  "scan.mode": "Modo",
  "scan.modeOriginal": "Original",
  "scan.modeGray": "Grises",
  "scan.modeBw": "Fotocopia",
  "scan.rotateLeft": "Girar a la izquierda",
  "scan.rotateRight": "Girar a la derecha",
  "scan.adjustEdges": "Ajustar bordes",

  "scan.pages": "Páginas escaneadas",
  "scan.thumb": (page: number, name: string) => `Página ${page}: ${name}`,
  "scan.moveBefore": (page: number) => `Mover la página ${page} antes`,
  "scan.moveAfter": (page: number) => `Mover la página ${page} después`,
  "scan.remove": (page: number) => `Quitar la página ${page}`,

  "scan.reading": (name: string) => `Leyendo «${name}»…`,
  "scan.pageNotFound":
    "No se encontró la página en una foto: se propone la imagen completa. Ajusta las esquinas.",
  "scan.unreadable": (name: string) =>
    `No se pudo leer «${name}». Usa JPEG, PNG o WebP.`,
  "scan.processing": "Procesando…",
  "scan.processingPages": "Procesando páginas…",
  "scan.recognizing": (page: number, total: number) =>
    `Reconociendo texto: página ${page} de ${total}…`,
  "scan.saving": "Guardando…",
  "scan.saved": "Guardado.",
  "scan.saveFailed": (error: string) => `No se pudo guardar: ${error}`,
  "scan.fileName": "escaneo.pdf",

  "scan.photoGone": "La foto ya no está disponible.",
  "scan.invalidQuad": "El recorte no es un cuadrilátero válido.",
  "scan.closed": "El escáner se cerró.",

  // Phone layout (spec 009).
  "scan.shortTitle": "Escanear",
  "scan.pageOf": (page: number, total: number) => `Página ${page} de ${total}`,
  "scan.pageCount": (total: number) =>
    total === 1 ? "1 página" : `${total} páginas`,
  "scan.settings": "Ajustes del escáner",
  "scan.closeSettings": "Cerrar los ajustes",
  "scan.settingsRemembered": "Los ajustes se recuerdan en este dispositivo.",
  "scan.addPage": "Añadir página",
  "scan.editPage": (page: number) => `Ajustar la página ${page}`,
  "scan.ocrFailed": (error: string) =>
    `No se pudo reconocer el texto: ${error}`,
};
