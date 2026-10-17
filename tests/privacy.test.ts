// Spec 015: privacy x-ray. Every finding on PDFs built here, and cleaning.
import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  CLEAN_BY_DEFAULT,
  cleanPrivacy,
  previousVersions,
  scanPrivacy,
  type PrivacyKind,
  type PrivacyReport,
} from "../src/engine/privacy";
import { pageText, textRuns } from "./helpers";
import { leaky } from "./privacyFixture";

const kinds = (report: PrivacyReport) => report.findings.map((f) => f.kind);
const finding = (report: PrivacyReport, kind: PrivacyKind) =>
  report.findings.find((f) => f.kind === kind);

describe("the report", () => {
  it("finds everything the file hides", async () => {
    const report = await scanPrivacy(await leaky());
    expect(kinds(report)).toEqual([
      "versions",
      "hiddenText",
      "attachments",
      "javascript",
      "metadata",
      "whiteText",
      "authors",
      "hiddenLayers",
      "thumbnails",
      "pieceInfo",
      "links",
      "ocrText",
    ]);
    expect(report.previousVersions).toHaveLength(1);
    expect(finding(report, "versions")!.level).toBe("high");
    const meta = finding(report, "metadata")!.details;
    expect(meta).toContainEqual({ key: "Author", text: "Ana Secreta" });
    expect(meta).toContainEqual({ key: "Title", text: "Contrato final" });
    const hidden = finding(report, "hiddenText")!.details.map((d) => d.key);
    expect(hidden.sort()).toEqual(["hidden", "outside", "tiny"]);
    expect(
      finding(report, "hiddenText")!.details.find((d) => d.key === "hidden")!
        .text,
    ).toBe("INVISIBLE SECRETO");
    expect(finding(report, "whiteText")!.details).toEqual([
      { key: "white", page: 1, text: "TEXTO BLANCO OCULTO", size: 1 },
    ]);
    expect(finding(report, "ocrText")!.details[0]!.text).toBe("capa ocr");
    expect(finding(report, "attachments")!.details[0]).toMatchObject({
      text: "nomina.csv",
    });
    expect(finding(report, "javascript")!.details[0]).toMatchObject({
      key: "document",
      text: "app.alert('hola');",
    });
    expect(finding(report, "links")!.details).toEqual([
      { text: "www.ejemplo.com", size: 1 },
    ]);
    expect(finding(report, "authors")!.details).toEqual([
      { text: "Pedro Revisor", size: 1 },
    ]);
    expect(finding(report, "hiddenLayers")!.details).toEqual([
      { text: "Borrador" },
    ]);
    expect(finding(report, "pieceInfo")!.details).toEqual([
      { text: "Illustrator" },
    ]);
  });

  it("finds nothing in a plain document", async () => {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText("Hola", { x: 50, y: 700, size: 12, font });
    const report = await scanPrivacy(await doc.save());
    expect(report.findings).toEqual([]);
  });

  it("keeps the earlier version readable, with what it said", async () => {
    const bytes = await leaky();
    const [end] = (await scanPrivacy(bytes)).previousVersions;
    const old = await PDFDocument.load(bytes.slice(0, end), {
      updateMetadata: false,
    });
    expect(old.getTitle()).toBe("Contrato de alquiler");
  });

  it("does not count the first part of a linearized file", () => {
    const part = (n: number) =>
      `${n} 0 obj\n<< >>\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< >>\n`;
    const build = (dict: string) => {
      const first = `%PDF-1.7\n1 0 obj\n${dict}\nendobj\n${part(2)}`;
      const a = `${first}startxref\n${first.indexOf("xref")}\n%%EOF\n`;
      const second = a + part(3);
      const file = `${second}startxref\n${second.lastIndexOf("xref")}\n%%EOF\n`;
      return {
        end: a.length,
        bytes: Uint8Array.from(file, (c) => c.charCodeAt(0)),
      };
    };
    expect(previousVersions(build("<< /Linearized 1 >>").bytes)).toEqual([]);
    const plain = build("<< >>");
    expect(previousVersions(plain.bytes)).toEqual([plain.end]);
  });
});

describe("cleaning", () => {
  it("removes what is checked by default and keeps what shows", async () => {
    const bytes = await leaky();
    const before = await textRuns(bytes);
    const clean = await cleanPrivacy(bytes, CLEAN_BY_DEFAULT);
    const report = await scanPrivacy(clean);
    expect(kinds(report)).toEqual(["links", "ocrText"]);

    const text = await pageText(clean);
    for (const gone of [
      "TEXTO BLANCO",
      "INVISIBLE",
      "MINI",
      "FUERA",
      "CAPA OCULTA",
    ])
      expect(text).not.toContain(gone);
    // What shows stays where it was.
    const after = await textRuns(clean);
    for (const kept of ["Contrato visible", "Titulo en banner", "capa ocr"]) {
      const a = before.find((r) => r.str === kept)!;
      expect(after).toContainEqual(
        expect.objectContaining({ str: kept, x: a.x, y: a.y }),
      );
    }
    // The comment stays, without its author.
    const doc = await PDFDocument.load(clean);
    const annots = doc.getPages()[0]!.node.Annots()!.asArray();
    const comment = annots
      .map((a) => doc.context.lookup(a, PDFDict))
      .find((a) => a.get(PDFName.of("Subtype")) === PDFName.of("Text"))!;
    expect(comment.has(PDFName.of("T"))).toBe(false);
    expect(doc.getAuthor()).toBeUndefined();
    // Written whole: no earlier version, nothing nobody points to.
    expect(previousVersions(clean)).toEqual([]);
  });

  it("removes links and the OCR text when asked", async () => {
    const clean = await cleanPrivacy(
      await leaky(),
      new Set<PrivacyKind>([...CLEAN_BY_DEFAULT, "links", "ocrText"]),
    );
    expect((await scanPrivacy(clean)).findings).toEqual([]);
    expect(await pageText(clean)).not.toContain("capa ocr");
  });

  it("keeps everything not asked for", async () => {
    const clean = await cleanPrivacy(await leaky(), new Set(["javascript"]));
    expect(kinds(await scanPrivacy(clean))).toEqual([
      "hiddenText",
      "attachments",
      "metadata",
      "whiteText",
      "authors",
      "hiddenLayers",
      "thumbnails",
      "pieceInfo",
      "links",
      "ocrText",
    ]);
  });
});
