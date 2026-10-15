import { describe, expect, it } from "vitest";
import {
  NotAPdfError,
  createPdfFile,
  hasPdfHeader,
  openPdfFile,
} from "./pdfFile";

const pdfBytes = () =>
  new TextEncoder().encode("%PDF-1.7\n%fake body\n%%EOF\n");

describe("hasPdfHeader", () => {
  it("accepts a header at the start", () => {
    expect(hasPdfHeader(pdfBytes())).toBe(true);
  });

  it("accepts a header after leading junk within 1024 bytes", () => {
    const junk = new Uint8Array(100).fill(0x20);
    expect(hasPdfHeader(new Uint8Array([...junk, ...pdfBytes()]))).toBe(true);
  });

  it("rejects files without a header", () => {
    expect(hasPdfHeader(new TextEncoder().encode("hola mundo"))).toBe(false);
    expect(hasPdfHeader(new Uint8Array())).toBe(false);
  });
});

describe("createPdfFile", () => {
  it("throws a readable error for non-PDF input", () => {
    expect(() =>
      createPdfFile("foto.jpg", new Uint8Array([0xff, 0xd8])),
    ).toThrow(NotAPdfError);
  });

  it("keeps the original intact when the input buffer changes later", () => {
    const input = pdfBytes();
    const file = createPdfFile("a.pdf", input);
    input.fill(0);
    expect(hasPdfHeader(file.copyBytes())).toBe(true);
  });

  it("returns independent copies that callers may mutate or transfer", () => {
    const file = createPdfFile("a.pdf", pdfBytes());
    const first = file.copyBytes();
    first.fill(0);
    structuredClone(first.buffer, { transfer: [first.buffer] }); // detaches, like pdf.js does
    expect(first.byteLength).toBe(0);
    expect(file.copyBytes()).toEqual(pdfBytes());
    expect(file.size).toBe(pdfBytes().length);
  });
});

describe("openPdfFile", () => {
  it("reads a Blob with a name", async () => {
    const blob = Object.assign(new Blob([pdfBytes()]), { name: "doc.pdf" });
    const file = await openPdfFile(blob);
    expect(file.name).toBe("doc.pdf");
    expect(file.copyBytes()).toEqual(pdfBytes());
  });
});
