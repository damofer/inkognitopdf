// Spanish messages: editing overlay of a page.
export const editLayer = {
  "editLayer.text": "Texto",
  "editLayer.noteText": "Texto de la nota",
  "editLayer.freeText": "Texto libre",
  // Spec 010: text of a scanned image.
  "editLayer.typedLook":
    "Esta línea parece manuscrita o poco clara: el texto nuevo se verá escrito a máquina.",
  "editLayer.draftActions": "Texto en edición",
  "editLayer.cancel": "Cancelar",
  "editLayer.accept": "Aceptar",
  // Spec 026: the button on the selected item.
  "editLayer.delete": "Eliminar",
  "editLayer.deleteKey": "Eliminar (Supr)",
  "editLayer.lowConfidence": (confidence: number, text: string) =>
    `Confianza baja (${confidence}): «${text}»`,
  // Bases of the names of new form fields (texto_1, casilla_1…).
  "editLayer.fieldText": "texto",
  "editLayer.fieldCheckbox": "casilla",
  "editLayer.fieldRadio": "grupo",
  "editLayer.fieldDropdown": "lista_desplegable",
  "editLayer.fieldList": "lista",
  // Default values of new fields: export values are PDF names (no accents).
  "editLayer.checkboxValue": "Si",
  "editLayer.radioValue": (n: number) => `Opcion${n}`,
  "editLayer.option": (n: number) => `Opción ${n}`,
};
