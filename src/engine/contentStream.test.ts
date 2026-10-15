import { describe, expect, it } from "vitest";
import {
  formatNumber,
  parseContentStream,
  type Operand,
} from "./contentStream";

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const text = (o: Operand) =>
  typeof o === "object" && o !== null && "type" in o && o.type === "string"
    ? String.fromCharCode(...o.bytes)
    : null;

describe("parseContentStream", () => {
  it("parses operators with their operands and byte ranges", () => {
    const src = "q 1 0 0 1 10.5 -20 cm\nBT /F1 12 Tf (Hola) Tj ET Q";
    const ops = parseContentStream(enc(src));
    expect(ops.map((o) => o.operator)).toEqual([
      "q",
      "cm",
      "BT",
      "Tf",
      "Tj",
      "ET",
      "Q",
    ]);
    expect(ops[1]!.operands).toEqual([1, 0, 0, 1, 10.5, -20]);
    expect(ops[3]!.operands).toEqual([{ type: "name", name: "F1" }, 12]);
    const tj = ops[4]!;
    expect(src.slice(tj.start, tj.end)).toBe("(Hola) Tj");
  });

  it("decodes literal strings: escapes, octal and balanced parentheses", () => {
    const [op] = parseContentStream(
      enc("(a\\(b\\) (c) \\101\\0533\\\\ d\\\ne) Tj"),
    );
    expect(text(op!.operands[0]!)).toBe("a(b) (c) A+3\\ de");
  });

  it("decodes hex strings, padding an odd digit", () => {
    const [op] = parseContentStream(enc("<48 65 6C6C 6F7> Tj"));
    const s = op!.operands[0] as { bytes: Uint8Array; hex: boolean };
    expect([...s.bytes]).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x70]);
    expect(s.hex).toBe(true);
  });

  it("parses TJ arrays, dictionaries, names with escapes and comments", () => {
    const ops = parseContentStream(
      enc(
        "% comment\n[(K) 30 (erning) -15.5] TJ /Span <</MCID 3 /Alt (x)>> BDC /A#20B gs EMC",
      ),
    );
    expect(ops.map((o) => o.operator)).toEqual(["TJ", "BDC", "gs", "EMC"]);
    const arr = ops[0]!.operands[0] as Operand[];
    expect(arr.map((o) => (typeof o === "number" ? o : text(o)))).toEqual([
      "K",
      30,
      "erning",
      -15.5,
    ]);
    expect(ops[1]!.operands[1]).toMatchObject({
      type: "dict",
      entries: { MCID: 3 },
    });
    expect(ops[2]!.operands[0]).toEqual({ type: "name", name: "A B" });
  });

  it("keeps inline images as one operation, even with EI-like bytes inside", () => {
    const src = "q BI /W 2 /H 1 /BPC 8 /CS /G ID \x00EIx\xff EI Q (t) Tj";
    const ops = parseContentStream(enc(src));
    expect(ops.map((o) => o.operator)).toEqual(["q", "BI", "Q", "Tj"]);
    expect(src.slice(ops[1]!.start, ops[1]!.end)).toBe(
      "BI /W 2 /H 1 /BPC 8 /CS /G ID \x00EIx\xff EI",
    );
  });

  it("handles ' and \" text operators", () => {
    const ops = parseContentStream(enc("(uno) ' 2 1 (dos) \""));
    expect(ops.map((o) => [o.operator, o.operands.length])).toEqual([
      ["'", 1],
      ['"', 3],
    ]);
  });
});

describe("formatNumber", () => {
  it("never uses exponents", () => {
    expect(formatNumber(1e-7)).toBe("0");
    expect(formatNumber(-1234.56789)).toBe("-1234.5679");
    expect(formatNumber(3)).toBe("3");
  });
});
