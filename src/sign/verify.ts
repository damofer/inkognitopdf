/**
 * Verification of the digital signatures of a PDF (spec 004, HU8, CA11):
 * integrity of each signature (hash of /ByteRange and the CMS signature),
 * changes made after it, signer certificate and trust in the roots the user
 * imported. No network: no revocation checks, no timestamps (CA13).
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFObject,
} from "pdf-lib";
import * as pkijs from "pkijs";
import { t } from "../i18n";
import { certificateInfo, type CertificateInfo } from "./certificates";

export type Integrity = "valid" | "invalid";
/**
 * none: the signature covers the whole file. annotations: later revisions
 * only add signatures, form fields, annotations or their appearances.
 * modified: later revisions change page content or other parts.
 */
export type LaterChanges = "none" | "annotations" | "modified";
export type Trust = "trusted" | "selfSigned" | "unknown";

export interface SignatureReport {
  field: string;
  integrity: Integrity;
  /** Why the integrity check failed, in Spanish. */
  problem?: string;
  laterChanges: LaterChanges;
  trust: Trust;
  signer: CertificateInfo | null;
  signedAt: Date | null;
  reason?: string;
  location?: string;
  subFilter?: string;
  /** Byte where the signed revision ends. */
  revisionEnd: number;
}

const buffer = (b: Uint8Array) =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

function decodeText(obj: PDFObject | undefined): string | undefined {
  if (obj instanceof PDFString || obj instanceof PDFHexString)
    return obj.decodeText();
  return undefined;
}

/** PDF date (D:YYYYMMDDHHmmSS+HH'mm') to a Date. */
export function parsePdfDate(text: string | undefined): Date | null {
  const m =
    /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(
      text ?? "",
    );
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", tz, th, tm] =
    m;
  const utc = Date.UTC(+y!, +mo - 1, +d, +h, +mi, +s);
  const offset =
    tz === "+" || tz === "-"
      ? (tz === "-" ? -1 : 1) * ((+(th ?? 0) * 60 + +(tm ?? 0)) * 60000)
      : 0;
  return new Date(utc - offset);
}

interface SigField {
  name: string;
  sig: PDFDict;
}

function signatureFields(doc: PDFDocument): SigField[] {
  const { context, catalog } = doc;
  const deref = (o: PDFObject | undefined) =>
    o instanceof PDFRef ? context.lookup(o) : o;
  const acroForm = deref(catalog.get(PDFName.of("AcroForm")));
  if (!(acroForm instanceof PDFDict)) return [];
  const out: SigField[] = [];
  const visit = (
    fields: PDFObject | undefined,
    prefix: string,
    ft?: string,
  ) => {
    const array = deref(fields);
    if (!(array instanceof PDFArray)) return;
    for (const item of array.asArray()) {
      const dict = deref(item);
      if (!(dict instanceof PDFDict)) continue;
      const partial = decodeText(dict.get(PDFName.of("T")));
      const name = partial
        ? prefix
          ? `${prefix}.${partial}`
          : partial
        : prefix;
      const type = dict.get(PDFName.of("FT"))?.toString() ?? ft;
      const kids = dict.get(PDFName.of("Kids"));
      if (kids && !dict.get(PDFName.of("V"))) {
        visit(kids, name, type);
        continue;
      }
      const v = deref(dict.get(PDFName.of("V")));
      if (type === "/Sig" && v instanceof PDFDict) out.push({ name, sig: v });
    }
  };
  visit(acroForm.get(PDFName.of("Fields")), "");
  return out;
}

const KEYS_ALLOWED_ON_PAGES = new Set(["/Annots"]);
const KEYS_ALLOWED_ON_CATALOG = new Set([
  "/AcroForm",
  "/DSS",
  "/Perms",
  "/PdfcraftSigning",
  "/Metadata",
]);

/** What the revisions after `end` change (see `LaterChanges`). */
async function laterChanges(
  bytes: Uint8Array,
  end: number,
  full: PDFDocument,
): Promise<LaterChanges> {
  const appended = latin1(bytes.subarray(end));
  if (appended.trim() === "") return "none";
  if (/\/Type\s*\/ObjStm/.test(appended)) return "modified"; // not analyzed
  let before: PDFDocument;
  try {
    before = await PDFDocument.load(bytes.subarray(0, end), {
      updateMetadata: false,
      ignoreEncryption: true,
    });
  } catch {
    return "modified";
  }
  const pageRefs = new Set(before.getPages().map((p) => p.ref.objectNumber));
  const contentRefs = new Set<number>();
  for (const page of before.getPages()) {
    const contents = page.node.get(PDFName.of("Contents"));
    if (contents instanceof PDFRef) contentRefs.add(contents.objectNumber);
    if (contents instanceof PDFArray)
      for (const c of contents.asArray())
        if (c instanceof PDFRef) contentRefs.add(c.objectNumber);
    const array =
      contents instanceof PDFRef ? before.context.lookup(contents) : null;
    if (array instanceof PDFArray)
      for (const c of array.asArray())
        if (c instanceof PDFRef) contentRefs.add(c.objectNumber);
  }
  const rootNumber = (before.context.trailerInfo.Root as PDFRef).objectNumber;

  const differs = (a: PDFDict, b: PDFDict, allowed: Set<string>) => {
    const keys = new Set([...a.keys(), ...b.keys()].map((k) => k.toString()));
    for (const key of keys) {
      if (allowed.has(key)) continue;
      const name = PDFName.of(key.slice(1));
      if (String(a.get(name)) !== String(b.get(name))) return true;
    }
    return false;
  };

  for (const m of appended.matchAll(/(\d+)\s+(\d+)\s+obj\b/g)) {
    const num = Number(m[1]);
    const ref = PDFRef.of(num, Number(m[2]));
    const old = before.context.lookup(ref);
    if (old === undefined) continue; // a new object
    const now = full.context.lookup(ref);
    if (contentRefs.has(num)) return "modified";
    if (pageRefs.has(num)) {
      if (
        !(old instanceof PDFDict) ||
        !(now instanceof PDFDict) ||
        differs(old, now, KEYS_ALLOWED_ON_PAGES)
      )
        return "modified";
      continue;
    }
    if (num === rootNumber) {
      if (
        !(old instanceof PDFDict) ||
        !(now instanceof PDFDict) ||
        differs(old, now, KEYS_ALLOWED_ON_CATALOG)
      )
        return "modified";
      continue;
    }
    if (old instanceof PDFArray) continue; // /Annots or /Fields arrays
    if (old instanceof PDFStream) return "modified";
    if (old instanceof PDFDict) {
      const type = String(old.get(PDFName.of("Type")) ?? "");
      const subtype = String(old.get(PDFName.of("Subtype")) ?? "");
      const isForm =
        old.get(PDFName.of("Fields")) !== undefined ||
        old.get(PDFName.of("FT")) !== undefined;
      if (type === "/Annot" || subtype === "/Widget" || isForm) continue;
    }
    return "modified";
  }
  return "annotations";
}

/** Whether the chain of `signer` (with `extra` intermediates) reaches a root. */
async function trustOf(
  signer: pkijs.Certificate,
  extra: pkijs.Certificate[],
  roots: pkijs.Certificate[],
): Promise<Trust> {
  const der = (c: pkijs.Certificate) =>
    new Uint8Array(c.toSchema().toBER(false)).join(",");
  const rootDers = new Set(roots.map(der));
  let current = signer;
  for (let depth = 0; depth < 6; depth++) {
    if (rootDers.has(der(current))) return "trusted";
    const issuer = [...roots, ...extra].find(
      (c) => c !== current && c.subject.isEqual(current.issuer),
    );
    if (!issuer || !(await current.verify(issuer).catch(() => false))) break;
    current = issuer;
  }
  return signer.subject.isEqual(signer.issuer) ? "selfSigned" : "unknown";
}

export async function verifyPdf(
  bytes: Uint8Array,
  trustedRoots: Uint8Array[] = [],
): Promise<SignatureReport[]> {
  const doc = await PDFDocument.load(bytes, {
    updateMetadata: false,
    ignoreEncryption: true,
  });
  const roots = trustedRoots.flatMap((r) => {
    try {
      return [pkijs.Certificate.fromBER(buffer(r))];
    } catch {
      return [];
    }
  });
  const reports: SignatureReport[] = [];
  for (const { name, sig } of signatureFields(doc)) {
    const report: SignatureReport = {
      field: name,
      integrity: "invalid",
      laterChanges: "modified",
      trust: "unknown",
      signer: null,
      signedAt: parsePdfDate(decodeText(sig.get(PDFName.of("M")))),
      reason: decodeText(sig.get(PDFName.of("Reason"))),
      location: decodeText(sig.get(PDFName.of("Location"))),
      subFilter: sig.get(PDFName.of("SubFilter"))?.toString().slice(1),
      revisionEnd: 0,
    };
    reports.push(report);
    const range = sig.get(PDFName.of("ByteRange"));
    const contents = sig.get(PDFName.of("Contents"));
    const numbers =
      range instanceof PDFArray
        ? range
            .asArray()
            .map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN))
        : [];
    const [a, b, c, d] = numbers;
    if (
      numbers.length !== 4 ||
      a !== 0 ||
      !(b! > 0 && c! > b! && c! + d! <= bytes.length) ||
      !(contents instanceof PDFHexString || contents instanceof PDFString)
    ) {
      report.problem = t("signEngine.badByteRange");
      continue;
    }
    report.revisionEnd = c! + d!;
    // The gap must be exactly the /Contents string.
    const gap = latin1(bytes.subarray(b!, c!));
    if (!/^<[0-9A-Fa-f\s]*>$/.test(gap)) {
      report.problem = t("signEngine.byteRangeGap");
      continue;
    }
    const data = new Uint8Array(b! + d!);
    data.set(bytes.subarray(0, b!), 0);
    data.set(bytes.subarray(c!, c! + d!), b!);
    try {
      const cms = contents.asBytes();
      const info = pkijs.ContentInfo.fromBER(buffer(cms));
      const signed = new pkijs.SignedData({ schema: info.content });
      const certs = (signed.certificates ?? []).filter(
        (x): x is pkijs.Certificate => x instanceof pkijs.Certificate,
      );
      const result = await signed.verify({
        signer: 0,
        data: buffer(data),
        checkChain: false,
        extendedMode: true,
      });
      const signer = result.signerCertificate ?? null;
      if (signer) {
        report.signer = await certificateInfo(
          new Uint8Array(signer.toSchema().toBER(false)),
        );
        report.trust = await trustOf(signer, certs, roots);
      }
      if (result.signatureVerified) report.integrity = "valid";
      else report.problem = t("signEngine.signatureMismatch");
    } catch (cause) {
      const message =
        (cause as { message?: string })?.message ?? String(cause ?? "");
      report.problem = /digest/i.test(message)
        ? t("signEngine.digestMismatch")
        : t("signEngine.verifyFailed", message);
    }
    report.laterChanges = await laterChanges(bytes, report.revisionEnd, doc);
  }
  return reports;
}
