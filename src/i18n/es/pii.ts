// Spanish messages: personal data detection (spec 016).
export const pii = {
  "pii.button": "Datos personales",
  "pii.hint":
    "Buscar DNI, cédulas, IBAN, tarjetas, correos y teléfonos para borrarlos",
  "pii.title": "Datos personales en el documento",
  "pii.searching": "Buscando en todas las páginas…",
  "pii.none": "No encontramos datos personales en el texto del documento.",
  "pii.found": (n: number) =>
    n === 1
      ? "Encontramos 1 dato personal. Elige cuál marcar para borrar."
      : `Encontramos ${n} datos personales. Elige cuáles marcar para borrar.`,
  "pii.note":
    "Los números de identidad, cuentas y tarjetas se comprueban con su dígito de control. Revisa la lista: puede faltar algo, sobre todo en escaneos sin OCR.",
  "pii.page": (n: number) => `pág. ${n}`,
  "pii.marked": "ya marcado",
  "pii.all": "Todos",
  "pii.none2": "Ninguno",
  "pii.cancel": "Cancelar",
  "pii.mark": (n: number) =>
    n === 1 ? "Marcar 1 para borrar" : `Marcar ${n} para borrar`,
  "pii.done": (n: number) =>
    n === 1
      ? "1 dato marcado. Revisa las marcas y pulsa «Aplicar borrado»."
      : `${n} datos marcados. Revisa las marcas y pulsa «Aplicar borrado».`,
  "pii.kind.idEs": "DNI y NIE (España)",
  "pii.kind.taxIdEs": "CIF o NIF de empresa (España)",
  "pii.kind.idCo": "Cédula (Colombia)",
  "pii.kind.nitCo": "NIT (Colombia)",
  "pii.kind.rutCl": "RUT (Chile)",
  "pii.kind.cuitAr": "CUIT o CUIL (Argentina)",
  "pii.kind.cpfBr": "CPF (Brasil)",
  "pii.kind.curpMx": "CURP (México)",
  "pii.kind.iban": "Cuentas IBAN",
  "pii.kind.card": "Tarjetas",
  "pii.kind.email": "Correos electrónicos",
  "pii.kind.phone": "Teléfonos",
  "pii.kind.birthDate": "Fechas de nacimiento",
};
