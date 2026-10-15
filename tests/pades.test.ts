// Spec 004, F006–F008: incremental updates and PAdES signatures, checked
// with qpdf and OpenSSL (CA7, CA8).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/engine/applyEdits";
import {
  certificateInfo,
  createSelfSigned,
  importPkcs12,
  type Identity,
} from "../src/sign/certificates";
import { IncrementalUpdate } from "../src/sign/incremental";
import { signPdf } from "../src/sign/pades";
import { fixture, qpdfCheck, qpdfPath, stateFor, testDeps } from "./helpers";
import { inkShare, renderPage } from "./renderHelpers";
import {
  openssl,
  opensslPath,
  opensslVerify,
  pdfSignatures,
  pem,
  tempDir,
} from "./signHelpers";

const asset = {
  kind: "drawn" as const,
  width: 100,
  height: 30,
  color: "#0b2f8f",
  strokes: [
    Array.from({ length: 20 }, (_, i) => ({
      x: 5 + i * 4.5,
      y: 15 + 10 * Math.sin(i / 2),
      w: 2,
    })),
  ],
};

const appearance = {
  page: 0,
  rect: { x: 320, y: 120, width: 150, height: 45 },
  rotate: 0 as const,
  asset,
};

/** simple-text.pdf has a classic xref table; pdf-lib saves an xref stream. */
async function bases() {
  const classic = await fixture("simple-text.pdf");
  const { bytes: stream } = await applyEdits(
    classic,
    await stateFor(classic),
    testDeps,
  );
  return { classic, stream };
}

async function sign(pdf: Uint8Array, identity: Identity, extra = {}) {
  return signPdf(pdf, {
    identity,
    appearance,
    name: "Ana Pérez",
    reason: "Conforme",
    loadFont: testDeps.loadFont,
    date: new Date("2026-10-14T12:00:00Z"),
    ...extra,
  });
}

describe.skipIf(!opensslPath)("PAdES signature", () => {
  for (const algorithm of ["ECDSA", "RSA"] as const)
    for (const kind of ["classic", "stream"] as const)
      it(`${algorithm}, ${kind} xref: valid for OpenSSL, appended only`, async () => {
        const base = (await bases())[kind];
        const identity = await createSelfSigned({
          commonName: "Ana Pérez",
          email: "ana@example.com",
          algorithm,
        });
        const signed = await sign(base, identity);

        // The original bytes are untouched (incremental update).
        expect(signed.subarray(0, base.length)).toEqual(base);
        if (qpdfPath)
          expect(await qpdfCheck(signed)).toMatch(
            /No syntax or stream encoding errors/,
          );

        const [sig] = pdfSignatures(signed);
        expect(sig).toBeDefined();
        // The range covers the whole file except /Contents.
        const [a, b, c, d] = sig!.byteRange;
        expect(a).toBe(0);
        expect(c + d).toBe(signed.length);
        expect(String.fromCharCode(signed[b]!, signed[c - 1]!)).toBe("<>");

        const plain = await opensslVerify(sig!);
        expect(plain.out).toMatch(/Verification successful/);
        const trusted = await opensslVerify(sig!, pem(identity.certificate));
        expect(trusted.out).toMatch(/Verification successful/);

        // PAdES B-B attributes in the CMS.
        const dir = await tempDir();
        await writeFile(join(dir, "sig.der"), sig!.cms);
        const dump = await openssl(
          ["cms", "-cmsout", "-print", "-inform", "DER", "-in", "sig.der"],
          dir,
        );
        expect(dump.out).toMatch(
          /signingCertificateV2|id-smime-aa-signingCertificateV2/,
        );
        expect(dump.out).toMatch(/messageDigest/);
        expect(dump.out).not.toMatch(/signingTime/);

        // One changed byte outside /Contents breaks it.
        const tampered = signed.slice();
        const i = tampered.length - 40;
        tampered[i] = tampered[i] === 0x20 ? 0x21 : 0x20;
        const bad = await opensslVerify(pdfSignatures(tampered)[0]!);
        expect(bad.ok).toBe(false);
      });

  it("the widget shows the signature and the dictionary has the PAdES filter", async () => {
    const { classic } = await bases();
    const signed = await sign(
      classic,
      await createSelfSigned({ commonName: "Ana" }),
    );
    const page = await renderPage(signed);
    expect(inkShare(page, appearance.rect)).toBeGreaterThan(0.01);
    const text = new TextDecoder("latin1").decode(
      signed.subarray(classic.length),
    );
    expect(text).toContain("/SubFilter /ETSI.CAdES.detached");
    expect(text).toContain("/Filter /Adobe.PPKLite");
    expect(text).toMatch(/\/FT \/Sig/);
    expect(text).toMatch(/\/SigFlags 3/);
    const doc = await PDFDocument.load(signed);
    expect(
      doc
        .getForm()
        .getFields()
        .map((f) => f.getName()),
    ).toEqual(["Firma1"]);
  });

  it("three signatures in a row: every one still verifies", async () => {
    const { stream } = await bases();
    let pdf = stream;
    const ids: Identity[] = [];
    for (const who of ["Uno", "Dos", "Tres"]) {
      const identity = await createSelfSigned({ commonName: who });
      ids.push(identity);
      pdf = await sign(pdf, identity, {
        appearance: {
          ...appearance,
          rect: { ...appearance.rect, y: 120 + 60 * ids.length },
        },
      });
    }
    const sigs = pdfSignatures(pdf);
    expect(sigs).toHaveLength(3);
    for (const [i, sig] of sigs.entries())
      expect((await opensslVerify(sig, pem(ids[i]!.certificate))).out).toMatch(
        /Verification successful/,
      );
    // Only the last one covers the whole file.
    expect(sigs[2]!.byteRange[2] + sigs[2]!.byteRange[3]).toBe(pdf.length);
    expect(sigs[0]!.byteRange[2] + sigs[0]!.byteRange[3]).toBeLessThan(
      pdf.length,
    );
    if (qpdfPath)
      expect(await qpdfCheck(pdf)).toMatch(
        /No syntax or stream encoding errors/,
      );
  });

  it("an empty incremental update keeps the file valid", async () => {
    const { classic } = await bases();
    const update = await IncrementalUpdate.load(classic);
    update.touch(update.doc.getPage(0).ref);
    const { bytes } = update.write();
    if (qpdfPath)
      expect(await qpdfCheck(bytes)).toMatch(
        /No syntax or stream encoding errors/,
      );
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});

describe.skipIf(!opensslPath)("PKCS#12 (CA8)", () => {
  async function p12(keyArgs: string[], extra: string[] = []) {
    const dir = await tempDir();
    const made = await openssl(
      [
        "req",
        "-x509",
        ...keyArgs,
        "-nodes",
        "-keyout",
        "key.pem",
        "-out",
        "cert.pem",
        "-days",
        "30",
        "-subj",
        "/CN=Prueba PKCS12/emailAddress=p12@example.com",
      ],
      dir,
    );
    expect(made.ok, made.out).toBe(true);
    const exported = await openssl(
      [
        "pkcs12",
        "-export",
        "-inkey",
        "key.pem",
        "-in",
        "cert.pem",
        "-out",
        "id.p12",
        "-passout",
        "pass:clave secreta",
        ...extra,
      ],
      dir,
    );
    expect(exported.ok, exported.out).toBe(true);
    return {
      file: new Uint8Array(await readFile(join(dir, "id.p12"))),
      cert: await readFile(join(dir, "cert.pem"), "utf8"),
    };
  }

  for (const [label, keyArgs] of [
    ["EC P-256", ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256"]],
    ["RSA 2048", ["-newkey", "rsa:2048"]],
  ] as const)
    it(`${label}: imported and used to sign`, async () => {
      const { file, cert } = await p12([...keyArgs]);
      const identity = await importPkcs12(file, "clave secreta");
      expect(identity.privateKey.extractable).toBe(false);
      const info = await certificateInfo(identity.certificate);
      expect(info.subject).toBe("Prueba PKCS12");
      expect(info.email).toBe("p12@example.com");
      const { classic } = await bases();
      const signed = await sign(classic, identity);
      expect(
        (await opensslVerify(pdfSignatures(signed)[0]!, cert)).out,
      ).toMatch(/Verification successful/);
    });

  it("a wrong password is reported", async () => {
    const { file } = await p12([
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
    ]);
    await expect(importPkcs12(file, "otra")).rejects.toThrow(/contraseña/);
  });

  it("self-signed identities: non-extractable key, 5 years", async () => {
    const now = new Date("2026-10-14T00:00:00Z");
    const identity = await createSelfSigned({ commonName: "Ana", now });
    expect(identity.privateKey.extractable).toBe(false);
    const info = await certificateInfo(identity.certificate);
    expect(info.selfSigned).toBe(true);
    expect(info.notAfter.getUTCFullYear()).toBe(2031);
    expect(info.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });
});
