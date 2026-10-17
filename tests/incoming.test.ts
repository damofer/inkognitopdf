// Spec 017: only PDFs are opened from «Open with» and shares.
import { describe, expect, it } from "vitest";
import { isPdf } from "../src/storage/incoming";

describe("isPdf", () => {
  it.each([
    [{ name: "a.pdf", type: "application/pdf" }, true],
    [{ name: "CONTRATO.PDF", type: "" }, true],
    [{ name: "scan", type: "application/pdf" }, true],
    [{ name: "foto.jpg", type: "image/jpeg" }, false],
    [{ name: "notas.txt", type: "text/plain" }, false],
  ])("%o → %s", (file, expected) => {
    expect(isPdf(file)).toBe(expected);
  });
});
