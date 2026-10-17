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
  "scan.closeAdd": "Cerrar",
  "scan.editPage": (page: number) => `Ajustar la página ${page}`,
  "scan.ocrFailed": (error: string) =>
    `No se pudo reconocer el texto: ${error}`,

  // Live camera and ID card mode (spec 020).
  "scan.cameraOpen": "Escanear con la cámara",
  "scan.cameraTitle": "Escaneo con la cámara",
  "scan.cameraAuto": "Disparo automático",
  "scan.cameraTake": "Hacer la foto",
  "scan.cameraDone": (count: number) =>
    count === 0 ? "Listo" : `Listo (${count})`,
  "scan.cameraSearching": "Buscando la hoja: ponla sobre un fondo oscuro.",
  "scan.cameraHold": "Hoja encontrada. Sujeta el móvil quieto…",
  "scan.cameraReady": "Hoja encontrada. Pulsa el botón para hacer la foto.",
  "scan.cameraNext": "Hecho. Pon la siguiente hoja.",
  "scan.cameraFront": "Enfoca el anverso de la tarjeta.",
  "scan.cameraBack": "Ahora el reverso de la tarjeta.",
  "scan.cameraFlip": "Hecho. Da la vuelta a la tarjeta.",
  "scan.cameraName": (n: number) => `Foto ${n}`,
  "scan.cameraFailed":
    "No se pudo abrir la cámara. Permite el acceso o usa «Hacer foto».",
  "scan.idCard": "Modo DNI (dos caras en un A4)",
  "scan.idHint":
    "Modo DNI: cada dos fotos (anverso y reverso) van juntas en una hoja A4, a tamaño real.",
  "scan.idSides": (sides: number) => {
    const pages = Math.ceil(sides / 2);
    return `${sides === 1 ? "1 cara" : `${sides} caras`} en ${pages === 1 ? "1 hoja" : `${pages} hojas`}`;
  },
};
