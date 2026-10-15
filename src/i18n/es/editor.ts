// Spanish messages: editor.
export const editor = {
  // Form field types (spec 005).
  "editor.fieldText": "Texto",
  "editor.fieldMultiline": "Texto multilínea",
  "editor.fieldCheckbox": "Casilla",
  "editor.fieldRadio": "Botón de opción",
  "editor.fieldDropdown": "Lista desplegable",
  "editor.fieldList": "Lista",

  // Field properties panel.
  "editor.fieldProperties": "Propiedades del campo",
  "editor.fieldName": "Nombre",
  "editor.fieldValue": "Valor",
  "editor.fieldOptions": "Opciones (una por línea)",
  "editor.fieldMultiSelect": "Varias opciones",
  "editor.fieldAlign": "Alineación",
  "editor.alignLeft": "Izquierda",
  "editor.alignCenter": "Centro",
  "editor.alignRight": "Derecha",
  "editor.fieldMaxLength": "Longitud máxima",
  "editor.fieldComb": "Dividir en casillas",
  "editor.fieldRequired": "Obligatorio",

  // Saving and signing.
  "editor.imageUnreadable":
    "No se pudo leer la imagen. Usa PNG, JPEG, WebP o GIF.",
  "editor.imageConvertFailed": "No se pudo convertir la imagen.",
  "editor.fontLoadFailed": (family: string, variant: string) =>
    `No se pudo cargar la fuente ${family} ${variant}.`,
  "editor.saved": "Guardado.",
  "editor.looksScannedShort": "Documento escaneado.",
  "editor.needOcr":
    "Para cambiar el texto de una página escaneada, primero hay que reconocerlo.",
  "editor.needOcrShort": "Primero reconoce el texto.",
  "editor.saveFailed": (reason: string) => `No se pudo guardar: ${reason}`,
  "editor.defaultSigner": "Firmante",
  "editor.savedVisual": "Guardado con la firma visual.",
  "editor.savedDigital": "Guardado y firmado digitalmente.",
  "editor.savedDigitalInvisible":
    "Guardado y firmado digitalmente (firma invisible: no colocó ninguna firma).",
  "editor.signFailed": (reason: string) => `No se pudo firmar: ${reason}`,
  // Joins the names of the next signers: "Ana y Luis".
  "editor.namesAnd": " y ",
  "editor.preparedSendTo": (names: string) =>
    `Preparado para firmar. Envíe el archivo a ${names}.`,
  "editor.prepareFailed": (reason: string) => `No se pudo preparar: ${reason}`,
  "editor.signedSendTo": (names: string) =>
    `Firmado y guardado. Envíe el archivo a ${names}.`,
  "editor.signedAllDone": "Firmado y guardado. Ya firmaron todos.",

  // File names of saved documents. The suffixes of both languages are
  // recognized when a prepared or signed file is signed again.
  "editor.defaultFileName": "documento.pdf",
  "editor.defaultBaseName": "documento",
  "editor.editedSuffix": "editado",
  "editor.signedSuffix": "firmado",
  "editor.toSignSuffix": "para firmar",

  // Page actions.
  "editor.rotateLeftPage": (page: number) =>
    `Girar a la izquierda la página ${page}`,
  "editor.rotateLeft": "Girar a la izquierda",
  "editor.rotateRightPage": (page: number) =>
    `Girar a la derecha la página ${page}`,
  "editor.rotateRight": "Girar a la derecha",
  "editor.moveUpPage": (page: number) => `Subir la página ${page}`,
  "editor.moveUp": "Subir",
  "editor.moveDownPage": (page: number) => `Bajar la página ${page}`,
  "editor.moveDown": "Bajar",
  "editor.insertBlankAfterPage": (page: number) =>
    `Insertar una página en blanco después de la página ${page}`,
  "editor.insertBlankAfter": "Insertar página en blanco después",
  "editor.deletePageN": (page: number) => `Eliminar la página ${page}`,
  "editor.deletePage": "Eliminar página",

  // Toolbar.
  "editor.undo": "Deshacer",
  "editor.undoHint": "Deshacer (Ctrl+Z)",
  "editor.redo": "Rehacer",
  "editor.redoHint": "Rehacer (Ctrl+Y)",
  "editor.saving": "Guardando…",
  "editor.savePdf": "Guardar PDF",
  "editor.signHint": "Crear su firma y colocarla en el documento",
  "editor.sign": "Firmar",
  "editor.ocrHint": "Reconocer el texto de páginas escaneadas",
  "editor.ocr": "OCR",
  "editor.tools": "Herramientas de edición",
  "editor.textStyle": "Estilo del texto",
  "editor.font": "Fuente",
  "editor.size": "Tamaño",
  "editor.textColor": "Color del texto",
  "editor.bold": "Negrita",
  "editor.boldIcon": "N",
  "editor.italic": "Cursiva",
  "editor.italicIcon": "K",
  "editor.highlightColor": "Color del resaltado",
  "editor.noteColor": "Color de la nota",
  "editor.annotation": "Anotación",
  "editor.annotationColor": "Color de la anotación",
  "editor.stroke": "Trazo",
  "editor.strokeColor": "Color del trazo",
  "editor.strokeWidth": "Grosor",
  "editor.points": (size: number) => `${size} pt`,
  "editor.fill": "Relleno",
  "editor.fillColor": "Color del relleno",
  "editor.field": "Campo",
  "editor.fieldType": "Tipo de campo",
  "editor.fieldFont": "Fuente del campo",
  "editor.fieldSize": "Tamaño del campo",
  "editor.fieldSizeAuto": "Auto",
  "editor.fieldColor": "Color del campo",
  "editor.flattenForm": "Aplanar formulario",

  // Notices.
  "editor.closeNotice": "Cerrar aviso",
  "editor.signatures": "Firmas",
  "editor.overwriteSigned":
    "Este PDF tiene firmas digitales. Guardar desde el editor reescribe el archivo y esas firmas dejarán de ser válidas.",
  "editor.saveAnyway": "Guardar de todos modos",
  "editor.cancel": "Cancelar",
  "editor.oneSignature": "Este documento tiene una firma digital.",
  "editor.manySignatures": (count: number) =>
    `Este documento tiene ${count} firmas digitales.`,
  "editor.someInvalid": "Alguna no es válida o el documento cambió después.",
  "editor.allIntact": "Todas son íntegras.",
  "editor.viewSignatures": "Ver firmas",
  "editor.planDone": (count: number) =>
    `Documento firmado por todos (${count}).`,
  "editor.planPending": (names: string) =>
    `Documento para firmar. Le toca a: ${names}.`,
  "editor.signAs": "Firmar como…",
  "editor.looksScanned":
    "Este documento parece escaneado: su texto es una imagen. Reconózcalo con OCR para poder buscarlo y copiarlo.",
  "editor.recognizeText": "Reconocer texto",
  "editor.closeScannedNotice": "Cerrar aviso de escaneo",
};
