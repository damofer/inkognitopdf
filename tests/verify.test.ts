// Spec 004, F010: verification of signatures (CA11) on files signed by the
// app and by OpenSSL-made identities.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/engine/applyEdits";
import { createSelfSigned, importPkcs12 } from "../src/sign/certificates";
import { IncrementalUpdate } from "../src/sign/incremental";
import { signPdf } from "../src/sign/pades";
import { parsePdfDate, verifyPdf } from "../src/sign/verify";
import { fixture, stateFor, testDeps } from "./helpers";
import { openssl, opensslPath, tempDir } from "./signHelpers";

const sign = (
  pdf: Uint8Array,
  identity: Awaited<ReturnType<typeof createSelfSigned>>,
  y = 100,
) =>
  signPdf(pdf, {
    identity,
    appearance: {
      page: 0,
      rect: { x: 300, y, width: 120, height: 40 },
      rotate: 0,
      asset: { kind: "typed", text: "Firma", font: "Caveat", color: "#000000" },
    },
    reason: "Aprobado",
    loadFont: testDeps.loadFont,
    date: new Date("2026-10-14T10:30:00Z"),
  });

async function base() {
  const pdf = await fixture("simple-text.pdf");
  return (await applyEdits(pdf, await stateFor(pdf), testDeps)).bytes;
}

describe("verifyPdf", () => {
  it("an unsigned PDF has no signatures", async () => {
    expect(await verifyPdf(await base())).toEqual([]);
  });

  it(
    "three signers: all valid, earlier ones only followed by signatures",
    { timeout: 30_000 },
    async () => {
      let pdf = await base();
      const ids = [];
      for (const [i, who] of ["Uno", "Dos", "Tres"].entries()) {
        const id = await createSelfSigned({ commonName: who });
        ids.push(id);
        pdf = await sign(pdf, id, 100 + i * 60);
      }
      const reports = await verifyPdf(pdf);
      expect(reports.map((r) => r.signer?.subject)).toEqual([
        "Uno",
        "Dos",
        "Tres",
      ]);
      expect(reports.map((r) => r.integrity)).toEqual([
        "valid",
        "valid",
        "valid",
      ]);
      expect(reports.map((r) => r.laterChanges)).toEqual([
        "annotations",
        "annotations",
        "none",
      ]);
      expect(reports.every((r) => r.trust === "selfSigned")).toBe(true);
      expect(reports[0]!.signedAt?.toISOString()).toBe(
        "2026-10-14T10:30:00.000Z",
      );
      expect(reports[0]!.reason).toBe("Aprobado");
      expect(reports[0]!.subFilter).toBe("ETSI.CAdES.detached");

      // Importing a signer's certificate as a root makes it trusted.
      const trusted = await verifyPdf(pdf, [ids[1]!.certificate]);
      expect(trusted.map((r) => r.trust)).toEqual([
        "selfSigned",
        "trusted",
        "selfSigned",
      ]);
    },
  );

  it("a changed byte makes the signature invalid", async () => {
    const pdf = await sign(
      await base(),
      await createSelfSigned({ commonName: "Ana" }),
    );
    const text = new TextDecoder("latin1").decode(pdf);
    // Change a digit of the page's MediaBox, inside the signed range.
    const at = text.indexOf("595.28");
    const tampered = pdf.slice();
    tampered[at] = "4".charCodeAt(0);
    const [report] = await verifyPdf(tampered);
    expect(report!.integrity).toBe("invalid");
    expect(report!.problem).toMatch(/cambió|no corresponde/);
  });

  it("new page content after signing is reported as a modification", async () => {
    const signed = await sign(
      await base(),
      await createSelfSigned({ commonName: "Ana" }),
    );
    const update = await IncrementalUpdate.load(signed);
    const page = update.doc.getPage(0);
    page.drawText("Añadido después", { x: 50, y: 50, size: 12 });
    update.touch(page.ref);
    const { bytes } = update.write();
    const [report] = await verifyPdf(bytes);
    expect(report!.integrity).toBe("valid");
    expect(report!.laterChanges).toBe("modified");
  });

  it("parses PDF dates with time zones", () => {
    expect(parsePdfDate("D:20261014123000+02'00'")?.toISOString()).toBe(
      "2026-10-14T10:30:00.000Z",
    );
    expect(parsePdfDate("D:20261014")?.toISOString()).toBe(
      "2026-10-14T00:00:00.000Z",
    );
  });
});

describe.skipIf(!opensslPath)("certificate chains", () => {
  it("a CA-issued signer is trusted only with the CA imported", async () => {
    const dir = await tempDir();
    const run = async (args: string[]) => {
      const r = await openssl(args, dir);
      expect(r.ok, r.out).toBe(true);
    };
    await run([
      "req",
      "-x509",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-keyout",
      "ca.key",
      "-out",
      "ca.pem",
      "-days",
      "30",
      "-subj",
      "/CN=CA de prueba",
    ]);
    await run([
      "req",
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-nodes",
      "-keyout",
      "leaf.key",
      "-out",
      "leaf.csr",
      "-subj",
      "/CN=Firmante de prueba",
    ]);
    await run([
      "x509",
      "-req",
      "-in",
      "leaf.csr",
      "-CA",
      "ca.pem",
      "-CAkey",
      "ca.key",
      "-CAcreateserial",
      "-out",
      "leaf.pem",
      "-days",
      "30",
    ]);
    await run([
      "pkcs12",
      "-export",
      "-inkey",
      "leaf.key",
      "-in",
      "leaf.pem",
      "-certfile",
      "ca.pem",
      "-out",
      "id.p12",
      "-passout",
      "pass:x",
    ]);
    const identity = await importPkcs12(
      new Uint8Array(await readFile(join(dir, "id.p12"))),
      "x",
    );
    expect(identity.chain).toHaveLength(1);
    const pdf = await sign(await base(), identity);
    const [plain] = await verifyPdf(pdf);
    expect(plain!.integrity).toBe("valid");
    expect(plain!.signer?.subject).toBe("Firmante de prueba");
    expect(plain!.signer?.issuer).toBe("CA de prueba");
    expect(plain!.trust).toBe("unknown");
    const caDer = await openssl(
      ["x509", "-in", "ca.pem", "-outform", "DER", "-out", "ca.der"],
      dir,
    );
    expect(caDer.ok).toBe(true);
    const [trusted] = await verifyPdf(pdf, [
      new Uint8Array(await readFile(join(dir, "ca.der"))),
    ]);
    expect(trusted!.trust).toBe("trusted");
  });
});
