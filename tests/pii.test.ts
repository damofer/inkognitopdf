// Spec 016: personal data with check digits.
import { describe, expect, it } from "vitest";
import {
  findPersonalData,
  validCard,
  validCpf,
  validCuit,
  validCurp,
  validIban,
  validNit,
  validRut,
  validSpanishCif,
  validSpanishId,
} from "../src/model/pii";

describe("check digits", () => {
  it.each([
    [validSpanishId, "12345678Z", "12345678A"],
    [validSpanishId, "X1234567L", "X1234567M"],
    [validSpanishCif, "B12345674", "B12345675"],
    [
      validIban,
      "ES91 2100 0418 4502 0005 1332",
      "ES92 2100 0418 4502 0005 1332",
    ],
    [validCard, "4111 1111 1111 1111", "4111 1111 1111 1112"],
    [validNit, "900.373.123-2", "900.373.123-3"],
    [validRut, "12.345.678-5", "12.345.678-6"],
    [validCuit, "20-12345678-6", "20-12345678-7"],
    [validCpf, "529.982.247-25", "529.982.247-26"],
    [validCurp, "GODE561231HDFRRN00", "GODE561231HDFRRN01"],
  ])("%o: %s yes, %s no", (valid, good, bad) => {
    expect(valid(good)).toBe(true);
    expect(valid(bad)).toBe(false);
  });
});

describe("finding personal data in text", () => {
  const kinds = (text: string) =>
    findPersonalData(text).map((m) => [m.kind, m.value]);

  it("finds each kind with its value", () => {
    expect(
      kinds(
        "D. Juan, DNI 12345678Z, NIE X-1234567-L, empresa B12345674.\n" +
          "IBAN ES91 2100 0418 4502 0005 1332; tarjeta 4111-1111-1111-1111.\n" +
          "Escribir a juan.perez@correo.es o llamar al +34 612 345 678 o al 612345678.\n" +
          "C.C. 1.020.304.050 de Bogotá, NIT 900.373.123-2, celular 310 555 1234.\n" +
          "RUT 12.345.678-5, CUIT 20-12345678-6, CPF 529.982.247-25, CURP GODE561231HDFRRN00.\n" +
          "Fecha de nacimiento: 07/03/1985.",
      ),
    ).toEqual([
      ["idEs", "12345678Z"],
      ["idEs", "X-1234567-L"],
      ["taxIdEs", "B12345674"],
      ["iban", "ES91 2100 0418 4502 0005 1332"],
      ["card", "4111-1111-1111-1111"],
      ["email", "juan.perez@correo.es"],
      ["phone", "+34 612 345 678"],
      ["phone", "612345678"],
      ["idCo", "1.020.304.050"],
      ["nitCo", "900.373.123-2"],
      ["phone", "310 555 1234"],
      ["rutCl", "12.345.678-5"],
      ["cuitAr", "20-12345678-6"],
      ["cpfBr", "529.982.247-25"],
      ["curpMx", "GODE561231HDFRRN00"],
      ["birthDate", "07/03/1985"],
    ]);
  });

  it("leaves out numbers whose check digit is wrong, and plain amounts", () => {
    expect(
      kinds(
        "Factura 12345678A por 1.234.567 pesos, pedido 4111 1111 1111 1112, " +
          "año 2024, código postal 28001, referencia 900.373.123-3.",
      ),
    ).toEqual([]);
  });

  it("gives ranges that point to the text", () => {
    const text = "Contacto: ana@ejemplo.com.";
    const [m] = findPersonalData(text);
    expect(text.slice(m!.start, m!.end)).toBe("ana@ejemplo.com");
  });
});
