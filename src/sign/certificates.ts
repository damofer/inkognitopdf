/**
 * Signing identities (spec 004, CA8): a self-signed certificate made on the
 * device, or a certificate and key imported from a PKCS#12 file. Private keys
 * are non-extractable WebCrypto keys and never leave the device.
 */
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { BRAND } from "../brand";
import { t } from "../i18n";

export type KeyAlgorithm = "ECDSA" | "RSA";

export interface Identity {
  /** DER of the signer certificate. */
  certificate: Uint8Array;
  /** DER of the other certificates of the chain (issuers), if any. */
  chain: Uint8Array[];
  privateKey: CryptoKey;
}

const OID = {
  commonName: "2.5.4.3",
  email: "1.2.840.113549.1.9.1",
  keyUsage: "2.5.29.15",
  basicConstraints: "2.5.29.19",
  rsa: "1.2.840.113549.1.1.1",
  ec: "1.2.840.10045.2.1",
  p256: "1.2.840.10045.3.1.7",
  p384: "1.3.132.0.34",
  p521: "1.3.132.0.35",
  shroudedKeyBag: "1.2.840.113549.1.12.10.1.2",
  keyBag: "1.2.840.113549.1.12.10.1.1",
  certBag: "1.2.840.113549.1.12.10.1.3",
  localKeyId: "1.2.840.113549.1.9.21",
} as const;

const subtle = () => globalThis.crypto.subtle;
const buffer = (b: Uint8Array) =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const der = (cert: pkijs.Certificate) =>
  new Uint8Array(cert.toSchema().toBER(false));

export const parseCertificate = (bytes: Uint8Array) =>
  pkijs.Certificate.fromBER(buffer(bytes));

function name(
  commonName: string,
  email?: string,
): pkijs.RelativeDistinguishedNames {
  const typesAndValues = [
    new pkijs.AttributeTypeAndValue({
      type: OID.commonName,
      value: new asn1js.Utf8String({ value: commonName }),
    }),
  ];
  if (email)
    typesAndValues.push(
      new pkijs.AttributeTypeAndValue({
        type: OID.email,
        value: new asn1js.IA5String({ value: email }),
      }),
    );
  return new pkijs.RelativeDistinguishedNames({ typesAndValues });
}

/** WebCrypto parameters for generating and using a key of `algorithm`. */
function keyParams(algorithm: KeyAlgorithm) {
  return algorithm === "ECDSA"
    ? { name: "ECDSA", namedCurve: "P-256" }
    : {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 3072,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      };
}

/**
 * A new self-signed certificate (5 years) for `commonName`. The private key
 * is created non-extractable.
 */
export async function createSelfSigned(options: {
  commonName: string;
  email?: string;
  algorithm?: KeyAlgorithm;
  now?: Date;
}): Promise<Identity> {
  const algorithm = options.algorithm ?? "ECDSA";
  const keys = (await subtle().generateKey(keyParams(algorithm), false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const now = options.now ?? new Date();
  const cert = new pkijs.Certificate();
  cert.version = 2;
  const serial = globalThis.crypto.getRandomValues(new Uint8Array(16));
  serial[0] = serial[0]! & 0x7f; // positive
  cert.serialNumber = new asn1js.Integer({ valueHex: serial });
  const subject = name(options.commonName, options.email);
  cert.subject = subject;
  cert.issuer = subject;
  cert.notBefore.value = new Date(now.getTime() - 60 * 60 * 1000);
  const notAfter = new Date(now);
  notAfter.setFullYear(notAfter.getFullYear() + 5);
  cert.notAfter.value = notAfter;
  // digitalSignature, nonRepudiation and keyCertSign (it signs itself).
  const usage = new asn1js.BitString({
    valueHex: new Uint8Array([0b11000100]).buffer,
    unusedBits: 2,
  });
  cert.extensions = [
    new pkijs.Extension({
      extnID: OID.basicConstraints,
      critical: true,
      extnValue: new pkijs.BasicConstraints({ cA: false })
        .toSchema()
        .toBER(false),
      parsedValue: new pkijs.BasicConstraints({ cA: false }),
    }),
    new pkijs.Extension({
      extnID: OID.keyUsage,
      critical: true,
      extnValue: usage.toBER(false),
    }),
  ];
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(keys.privateKey, "SHA-256");
  return { certificate: der(cert), chain: [], privateKey: keys.privateKey };
}

export class Pkcs12Error extends Error {}

/** WebCrypto import parameters for a PKCS#8 private key. */
function importParams(key: pkijs.PrivateKeyInfo) {
  const oid = key.privateKeyAlgorithm.algorithmId;
  if (oid === OID.rsa) return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  if (oid === OID.ec) {
    const curve = (
      key.privateKeyAlgorithm.algorithmParams as asn1js.ObjectIdentifier
    ).valueBlock.toString();
    const namedCurve =
      curve === OID.p256
        ? "P-256"
        : curve === OID.p384
          ? "P-384"
          : curve === OID.p521
            ? "P-521"
            : null;
    if (namedCurve) return { name: "ECDSA", namedCurve };
  }
  throw new Pkcs12Error(t("signEngine.unsupportedKeyType"));
}

const hex = (b: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

function localKeyId(bag: pkijs.SafeBag): string | null {
  const attr = bag.bagAttributes?.find((a) => a.type === OID.localKeyId);
  const value = attr?.values[0] as asn1js.OctetString | undefined;
  return value ? hex(value.valueBlock.valueHexView) : null;
}

/**
 * Certificate, chain and private key from a PKCS#12 (.p12/.pfx) file. The
 * password is used here and not kept.
 */
export async function importPkcs12(
  file: Uint8Array,
  password: string,
): Promise<Identity> {
  const pass = buffer(new TextEncoder().encode(password));
  let pfx: pkijs.PFX;
  try {
    pfx = pkijs.PFX.fromBER(buffer(file));
  } catch {
    throw new Pkcs12Error(t("signEngine.notPkcs12"));
  }
  try {
    await pfx.parseInternalValues({ password: pass, checkIntegrity: true });
  } catch {
    throw new Pkcs12Error(t("signEngine.wrongPassword"));
  }
  const safe = pfx.parsedValue?.authenticatedSafe;
  if (!safe) throw new Pkcs12Error(t("signEngine.noData"));
  try {
    await safe.parseInternalValues({
      safeContents: safe.safeContents.map(() => ({ password: pass })),
    });
  } catch {
    throw new Pkcs12Error(t("signEngine.legacyCipher", BRAND));
  }

  const certs: { cert: pkijs.Certificate; id: string | null }[] = [];
  let key: { info: pkijs.PrivateKeyInfo; id: string | null } | null = null;
  for (const content of safe.parsedValue?.safeContents ?? [])
    for (const bag of (content.value as pkijs.SafeContents).safeBags) {
      if (bag.bagId === OID.certBag) {
        const value = (bag.bagValue as pkijs.CertBag).parsedValue;
        if (value instanceof pkijs.Certificate)
          certs.push({ cert: value, id: localKeyId(bag) });
      } else if (bag.bagId === OID.shroudedKeyBag) {
        const shrouded = bag.bagValue as pkijs.PKCS8ShroudedKeyBag;
        try {
          await (
            shrouded as unknown as {
              parseInternalValues(p: { password: ArrayBuffer }): Promise<void>;
            }
          ).parseInternalValues({ password: pass });
        } catch {
          throw new Pkcs12Error(t("signEngine.keyDecryptFailed"));
        }
        if (shrouded.parsedValue)
          key = { info: shrouded.parsedValue, id: localKeyId(bag) };
      } else if (bag.bagId === OID.keyBag) {
        key = {
          info: bag.bagValue as pkijs.PrivateKeyInfo,
          id: localKeyId(bag),
        };
      }
    }
  if (!key) throw new Pkcs12Error(t("signEngine.noPrivateKey"));
  if (certs.length === 0) throw new Pkcs12Error(t("signEngine.noCertificate"));

  const signer =
    certs.find((c) => key.id && c.id === key.id) ??
    // Otherwise: the certificate that issued no other one (the end entity).
    certs.find(
      (c) =>
        !certs.some(
          (o) =>
            o !== c &&
            o.cert.issuer.isEqual(c.cert.subject) &&
            !o.cert.subject.isEqual(c.cert.subject),
        ),
    ) ??
    certs[0]!;
  const privateKey = await subtle().importKey(
    "pkcs8",
    key.info.toSchema().toBER(false),
    importParams(key.info),
    false,
    ["sign"],
  );
  return {
    certificate: der(signer.cert),
    chain: certs.filter((c) => c !== signer).map((c) => der(c.cert)),
    privateKey,
  };
}

/** SHA-256 fingerprint as uppercase hex pairs separated by colons. */
export async function fingerprint(certificate: Uint8Array): Promise<string> {
  const digest = await subtle().digest("SHA-256", buffer(certificate));
  return hex(digest).toUpperCase().match(/../g)!.join(":");
}

/** A readable value of a name: CN, then O, then the first attribute. */
export function displayName(names: pkijs.RelativeDistinguishedNames): string {
  const find = (oid: string) =>
    names.typesAndValues.find((t) => t.type === oid)?.value.valueBlock.value as
      string | undefined;
  return (
    find(OID.commonName) ??
    find("2.5.4.10") ??
    String(names.typesAndValues[0]?.value.valueBlock.value ?? "")
  );
}

export function emailOf(names: pkijs.RelativeDistinguishedNames) {
  return names.typesAndValues.find((t) => t.type === OID.email)?.value
    .valueBlock.value as string | undefined;
}

export interface CertificateInfo {
  subject: string;
  email?: string;
  issuer: string;
  serial: string;
  notBefore: Date;
  notAfter: Date;
  fingerprint: string;
  selfSigned: boolean;
}

export async function certificateInfo(
  certificate: Uint8Array,
): Promise<CertificateInfo> {
  const cert = parseCertificate(certificate);
  return {
    subject: displayName(cert.subject),
    email: emailOf(cert.subject),
    issuer: displayName(cert.issuer),
    serial: hex(cert.serialNumber.valueBlock.valueHexView).toUpperCase(),
    notBefore: cert.notBefore.value,
    notAfter: cert.notAfter.value,
    fingerprint: await fingerprint(certificate),
    selfSigned: cert.subject.isEqual(cert.issuer),
  };
}
