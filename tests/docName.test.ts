// Spec 034: what is typed in the header becomes the name before ".pdf".
import { describe, expect, test } from "vitest";
import { cleanStem, MAX_STEM } from "../src/DocName";

describe("cleanStem", () => {
  test("keeps an ordinary name", () => {
    expect(cleanStem("Contrato de arriendo 2026")).toBe(
      "Contrato de arriendo 2026",
    );
  });

  test("the .pdf stays outside: a typed one is dropped", () => {
    expect(cleanStem("factura.pdf")).toBe("factura");
    expect(cleanStem("factura.PDF.pdf")).toBe("factura");
    expect(cleanStem("v1.2 final")).toBe("v1.2 final");
  });

  test("drops what file systems refuse", () => {
    expect(cleanStem('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij");
    expect(cleanStem("línea\nnueva\t")).toBe("líneanueva");
    expect(cleanStem("  acta.  ")).toBe("acta");
  });

  test("nothing usable is empty", () => {
    expect(cleanStem("   ")).toBe("");
    expect(cleanStem(".pdf")).toBe("");
    expect(cleanStem("///")).toBe("");
  });

  test("long names are cut", () => {
    expect(cleanStem("x".repeat(300))).toHaveLength(MAX_STEM);
  });
});
