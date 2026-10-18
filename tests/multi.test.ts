// Spec 004, F012/F014: several signers in order, parallel signers and the
// audit page (CA9, CA10).
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/engine/applyEdits";
import type { EditorState, PageEntry, TextItem } from "../src/model/document";
import { createSelfSigned, type Identity } from "../src/sign/certificates";
import {
  auditPageText,
  planStatus,
  preparePlan,
  readPlan,
  signAsSigner,
  type SigningPlan,
} from "../src/sign/multi";
import { verifyPdf } from "../src/sign/verify";
import { DEFAULT_TEXT_STYLE } from "../src/editor/itemOps";
import {
  fixture,
  openPdf,
  qpdfCheck,
  qpdfPath,
  stateFor,
  testDeps,
} from "./helpers";
import { opensslPath, opensslVerify, pdfSignatures, pem } from "./signHelpers";

const drawn = {
  kind: "drawn" as const,
  width: 80,
  height: 24,
  color: "#000000",
  strokes: [
    [
      { x: 2, y: 20, w: 2 },
      { x: 40, y: 2, w: 2 },
      { x: 78, y: 20, w: 2 },
    ],
  ],
};
const initials = {
  kind: "typed" as const,
  text: "XY",
  font: "Caveat" as const,
  color: "#000000",
};

/** The editor's output for a plan: the document plus the audit page. */
async function prepared(mode: SigningPlan["mode"]) {
  const base = await fixture("simple-text.pdf");
  const state: EditorState = await stateFor(base);
  const box = state.pages[0]!.box;
  const audit: PageEntry = {
    id: "audit",
    source: { kind: "blank" },
    box,
    baseRotation: 0,
    extraRotation: 0,
  };
  const texts: TextItem[] = auditPageText(box, "simple-text.pdf").map(
    (t, i) => ({
      kind: "text",
      id: `audit-${i}`,
      pageId: "audit",
      at: { x: t.x, y: t.y },
      text: t.text,
      style: { ...DEFAULT_TEXT_STYLE, size: t.size, bold: t.bold },
      rotate: 0,
    }),
  );
  const { bytes } = await applyEdits(
    base,
    { pages: [...state.pages, audit], items: texts },
    testDeps,
  );
  const plan: SigningPlan = {
    version: 1,
    mode,
    auditPage: 1,
    signers: [
      { id: "a", name: "Ana Uno", email: "ana@example.com", order: 1 },
      { id: "b", name: "Beto Dos", order: 2 },
      { id: "c", name: "Carla Dos", order: 2 },
    ],
    fields: [
      {
        id: "fa1",
        page: 0,
        rect: { x: 60, y: 120, width: 120, height: 36 },
        type: "signature",
        signerId: "a",
      },
      {
        id: "fa2",
        page: 0,
        rect: { x: 200, y: 120, width: 40, height: 24 },
        type: "initials",
        signerId: "a",
      },
      {
        id: "fa3",
        page: 0,
        rect: { x: 260, y: 120, width: 90, height: 16 },
        type: "date",
        signerId: "a",
      },
      {
        id: "fb1",
        page: 0,
        rect: { x: 60, y: 70, width: 120, height: 36 },
        type: "signature",
        signerId: "b",
      },
      {
        id: "fb2",
        page: 0,
        rect: { x: 200, y: 70, width: 140, height: 16 },
        type: "name",
        signerId: "b",
      },
      {
        id: "fc1",
        page: 0,
        rect: { x: 360, y: 70, width: 120, height: 36 },
        type: "signature",
        signerId: "c",
      },
      {
        id: "fc2",
        page: 0,
        rect: { x: 360, y: 40, width: 160, height: 16 },
        type: "text",
        signerId: "c",
      },
    ],
  };
  return { pdf: await preparePlan(bytes, plan), plan };
}

const common = {
  assets: { signature: drawn, initials },
  formatDate: (d: Date) => d.toISOString().slice(0, 10),
  loadFont: testDeps.loadFont,
  date: new Date("2026-10-14T09:00:00Z"),
};

/**
 * Fonts used by the annotations' appearances that point to nothing. pdf.js
 * draws such text anyway; other viewers (Android, Chrome, Acrobat, poppler)
 * leave it out, so the audit rows and dates did not show there.
 */
async function missingFonts(pdf: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const missing: string[] = [];
  for (const [i, page] of doc.getPages().entries()) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let j = 0; j < annots.size(); j++) {
      const annot = annots.lookup(j, PDFDict);
      const ap = annot.lookup(PDFName.of("AP"));
      const normal = ap instanceof PDFDict ? ap.lookup(PDFName.of("N")) : null;
      const dict = normal && "dict" in normal ? (normal.dict as PDFDict) : null;
      const resources = dict?.lookup(PDFName.of("Resources"));
      const fonts =
        resources instanceof PDFDict
          ? resources.lookup(PDFName.of("Font"))
          : null;
      if (!(fonts instanceof PDFDict)) continue;
      for (const [name, ref] of fonts.entries())
        if (!(doc.context.lookup(ref) instanceof PDFDict))
          missing.push(`page ${i + 1}, annotation ${j + 1}, ${name}`);
    }
  }
  return missing;
}

const canSign = async (pdf: Uint8Array, plan: SigningPlan) =>
  (await planStatus(pdf, plan))
    .filter((s) => s.canSign)
    .map((s) => s.signer.id);

describe("several signers, PAdES", () => {
  it(
    "order, parallel signers, every signature valid, audit rows",
    { timeout: 30_000 },
    async () => {
      const prep = await prepared("pades");
      const plan = prep.plan;
      let pdf = prep.pdf;
      expect(await readPlan(pdf)).toEqual(plan);
      expect(await canSign(pdf, plan)).toEqual(["a"]);

      const ids: Record<string, Identity> = {};
      for (const who of ["a", "b", "c"])
        ids[who] = await createSelfSigned({ commonName: who });

      // Not B's turn yet.
      await expect(
        signAsSigner(pdf, { ...common, plan, signerId: "b", identity: ids.b }),
      ).rejects.toThrow(/Todavía no le toca/);

      pdf = await signAsSigner(pdf, {
        ...common,
        plan,
        signerId: "a",
        identity: ids.a,
      });
      expect(await canSign(pdf, plan)).toEqual(["b", "c"]);
      // Parallel: C before B.
      pdf = await signAsSigner(pdf, {
        ...common,
        plan,
        signerId: "c",
        identity: ids.c,
        texts: { fc2: "Conforme con reservas" },
      });
      pdf = await signAsSigner(pdf, {
        ...common,
        plan,
        signerId: "b",
        identity: ids.b,
      });
      expect(await canSign(pdf, plan)).toEqual([]);
      expect((await planStatus(pdf, plan)).every((s) => s.done)).toBe(true);

      const reports = await verifyPdf(pdf);
      expect(reports.map((r) => r.field)).toEqual([
        "pdfcraft-fa1",
        "pdfcraft-fb1",
        "pdfcraft-fc1",
      ]);
      expect(reports.every((r) => r.integrity === "valid")).toBe(true);
      // Signed in the order a, c, b: only b's covers the whole file, and the
      // others are followed by annotations only.
      const byField = Object.fromEntries(
        reports.map((r) => [r.field, r.laterChanges]),
      );
      expect(byField).toEqual({
        "pdfcraft-fa1": "annotations",
        "pdfcraft-fc1": "annotations",
        "pdfcraft-fb1": "none",
      });
      if (opensslPath)
        for (const [i, sig] of pdfSignatures(pdf).entries())
          expect(
            (
              await opensslVerify(
                sig,
                pem(ids[["a", "c", "b"][i]!]!.certificate),
              )
            ).out,
          ).toMatch(/Verification successful/);
      if (qpdfPath)
        expect(await qpdfCheck(pdf)).toMatch(
          /No syntax or stream encoding errors/,
        );
      expect(await missingFonts(pdf)).toEqual([]);

      // Filled fields and audit rows are annotations, in signing order.
      const doc = await openPdf(pdf);
      const page1 = await (await doc.getPage(2)).getAnnotations();
      const rows = page1.map((a) => String(a.contentsObj?.str ?? ""));
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatch(/^1\. Ana Uno <ana@example.com>/);
      expect(rows[1]).toMatch(/^2\. Carla Dos/);
      expect(rows[2]).toMatch(/^3\. Beto Dos/);
      expect(rows[0]).toMatch(/firma digital \(PAdES\)/);
      expect(rows[0]).toMatch(
        /Certificado SHA-256: ([0-9A-F]{2}:){31}[0-9A-F]{2}/,
      );
      expect(rows[0]).toMatch(
        /Documento SHA-256 antes de firmar: [0-9A-F]{64}/,
      );
      const page0 = (await (await doc.getPage(1)).getAnnotations()).map((a) =>
        String(a.contentsObj?.str ?? ""),
      );
      expect(page0).toEqual(
        expect.arrayContaining([
          "2026-10-14",
          "Beto Dos",
          "Conforme con reservas",
        ]),
      );
      await doc.loadingTask.destroy();
    },
  );

  it("a signer cannot sign twice", async () => {
    const prep = await prepared("pades");
    const plan = prep.plan;
    let pdf = prep.pdf;
    const id = await createSelfSigned({ commonName: "a" });
    pdf = await signAsSigner(pdf, {
      ...common,
      plan,
      signerId: "a",
      identity: id,
    });
    await expect(
      signAsSigner(pdf, { ...common, plan, signerId: "a", identity: id }),
    ).rejects.toThrow(/ya firmó/);
  });
});

describe("several signers, visual only", () => {
  it("keeps the order through the plan, without digital signatures", async () => {
    const prep = await prepared("visual");
    const plan = prep.plan;
    let pdf = prep.pdf;
    pdf = await signAsSigner(pdf, { ...common, plan, signerId: "a" });
    expect(await canSign(pdf, plan)).toEqual(["b", "c"]);
    pdf = await signAsSigner(pdf, { ...common, plan, signerId: "b" });
    pdf = await signAsSigner(pdf, { ...common, plan, signerId: "c" });
    expect((await planStatus(pdf, plan)).every((s) => s.done)).toBe(true);
    expect(await verifyPdf(pdf)).toEqual([]);
    const doc = await openPdf(pdf);
    const rows = (await (await doc.getPage(2)).getAnnotations()).map((a) =>
      String(a.contentsObj?.str ?? ""),
    );
    expect(rows[0]).toMatch(/solo visual/);
    await doc.loadingTask.destroy();
    expect(await missingFonts(pdf)).toEqual([]);
    if (qpdfPath)
      expect(await qpdfCheck(pdf)).toMatch(
        /No syntax or stream encoding errors/,
      );
  });
});
