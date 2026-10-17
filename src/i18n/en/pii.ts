// English messages: personal data detection (spec 016).
import type { pii as es } from "../es/pii";

export const pii: typeof es = {
  "pii.button": "Personal data",
  "pii.hint":
    "Find ID numbers, IBANs, cards, emails and phone numbers to redact them",
  "pii.title": "Personal data in the document",
  "pii.searching": "Searching every page…",
  "pii.none": "We found no personal data in the text of the document.",
  "pii.found": (n) =>
    n === 1
      ? "We found 1 piece of personal data. Choose whether to mark it for redaction."
      : `We found ${n} pieces of personal data. Choose which to mark for redaction.`,
  "pii.note":
    "ID numbers, accounts and cards are checked with their check digit. Review the list: something may be missing, especially in scans without OCR.",
  "pii.page": (n) => `p. ${n}`,
  "pii.marked": "already marked",
  "pii.all": "All",
  "pii.none2": "None",
  "pii.cancel": "Cancel",
  "pii.mark": (n) =>
    n === 1 ? "Mark 1 for redaction" : `Mark ${n} for redaction`,
  "pii.done": (n) =>
    n === 1
      ? "1 item marked. Review the marks and press “Apply redaction”."
      : `${n} items marked. Review the marks and press “Apply redaction”.`,
  "pii.kind.idEs": "DNI and NIE (Spain)",
  "pii.kind.taxIdEs": "Company CIF or NIF (Spain)",
  "pii.kind.idCo": "National ID (Colombia)",
  "pii.kind.nitCo": "NIT (Colombia)",
  "pii.kind.rutCl": "RUT (Chile)",
  "pii.kind.cuitAr": "CUIT or CUIL (Argentina)",
  "pii.kind.cpfBr": "CPF (Brazil)",
  "pii.kind.curpMx": "CURP (Mexico)",
  "pii.kind.iban": "IBAN accounts",
  "pii.kind.card": "Cards",
  "pii.kind.email": "Email addresses",
  "pii.kind.phone": "Phone numbers",
  "pii.kind.birthDate": "Dates of birth",
};
