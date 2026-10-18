/**
 * Trusted timestamps (RFC 3161) for PAdES signatures (spec 040): the time of
 * signing certified by a timestamp authority, instead of the device clock.
 * Only a SHA-256 hash of the signature value leaves the device, never the
 * document. Browsers cannot reach public TSAs directly (no CORS), so the
 * request goes to a relay on the site itself, `/tsa`, which forwards it.
 */
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { t } from "../i18n";

/** The relay on the same origin (firebase.json, docker/nginx.conf). */
export const TSA_URL = `${import.meta.env.BASE_URL}tsa`;

export const OID_TIMESTAMP_TOKEN = "1.2.840.113549.1.9.16.2.14";
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_TST_INFO = "1.2.840.113549.1.9.16.1.4";

const buffer = (b: Uint8Array) =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export class TimestampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimestampError";
  }
}

/** Gets a timestamp token (a CMS ContentInfo, DER) for a SHA-256 `imprint`. */
export type Timestamper = (imprint: Uint8Array) => Promise<Uint8Array>;

/**
 * Waits before asking again when the relay cannot be reached or answers
 * with a server error: a relay that has not run for a while takes some
 * seconds to start, and a connection to the authority can drop.
 */
export const RETRY_WAITS = [1_000, 3_000];

/** Answers worth asking again for: the relay is starting or overloaded. */
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);

/** Longest wait for one answer: a relay starting from cold included. */
const ATTEMPT_TIMEOUT = 30_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A timestamper that asks the TSA behind `url`. */
export function tsaTimestamper(
  url = TSA_URL,
  waits = RETRY_WAITS,
): Timestamper {
  return async (imprint) => {
    const nonce = crypto.getRandomValues(new Uint8Array(8));
    nonce[0] = (nonce[0]! & 0x7f) | 1; // positive, no leading zero byte
    const request = new pkijs.TimeStampReq({
      version: 1,
      messageImprint: new pkijs.MessageImprint({
        hashAlgorithm: new pkijs.AlgorithmIdentifier({
          algorithmId: OID_SHA256,
        }),
        hashedMessage: new asn1js.OctetString({ valueHex: buffer(imprint) }),
      }),
      nonce: new asn1js.Integer({ valueHex: buffer(nonce) }),
      certReq: true,
    });
    const body = request.toSchema().toBER(false);
    let reply: ArrayBuffer | undefined;
    for (let attempt = 0; !reply; attempt++) {
      let retry: boolean;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/timestamp-query" },
          body,
          signal:
            typeof AbortSignal.timeout === "function"
              ? AbortSignal.timeout(ATTEMPT_TIMEOUT)
              : undefined,
        });
        if (response.ok) reply = await response.arrayBuffer();
        retry = TRANSIENT.has(response.status);
      } catch {
        retry = true;
      }
      if (reply) break;
      if (!retry || attempt >= waits.length)
        throw new TimestampError(t("signEngine.timestampUnreachable"));
      await sleep(waits[attempt]!);
    }
    let token: pkijs.ContentInfo | undefined;
    try {
      const parsed = pkijs.TimeStampResp.fromBER(reply);
      // 0 granted, 1 granted with modifications.
      if (parsed.status.status <= 1) token = parsed.timeStampToken;
    } catch {
      token = undefined;
    }
    const refused = new TimestampError(t("signEngine.timestampRefused"));
    if (!token) throw refused;
    const der = new Uint8Array(token.toSchema().toBER(false));
    let info: pkijs.TSTInfo;
    try {
      info = tstInfo(der);
    } catch {
      throw refused;
    }
    // It must certify this very hash, in answer to this very request.
    if (
      !equal(
        info.messageImprint.hashedMessage.valueBlock.valueHexView,
        imprint,
      ) ||
      (info.nonce && !equal(info.nonce.valueBlock.valueHexView, nonce))
    )
      throw refused;
    return der;
  };
}

function tstInfo(token: Uint8Array): pkijs.TSTInfo {
  const info = pkijs.ContentInfo.fromBER(buffer(token));
  const signed = new pkijs.SignedData({ schema: info.content });
  const content = signed.encapContentInfo;
  if (content.eContentType !== OID_TST_INFO || !content.eContent)
    throw new TimestampError(t("signEngine.timestampRefused"));
  return pkijs.TSTInfo.fromBER(content.eContent.getValue());
}

export interface TimestampReport {
  time: Date;
  /** Common name (or organization) of the authority that signed it. */
  authority: string;
  /** The token is intact and certifies this very signature. */
  valid: boolean;
}

/**
 * The timestamp of a CMS signer, if it has one: checks that the token is
 * signed correctly and that its hash is the hash of `signature`.
 */
export async function readTimestamp(
  signerInfo: pkijs.SignerInfo,
): Promise<TimestampReport | null> {
  const attribute = signerInfo.unsignedAttrs?.attributes.find(
    (a) => a.type === OID_TIMESTAMP_TOKEN,
  );
  const value = attribute?.values[0] as asn1js.Sequence | undefined;
  if (!value) return null;
  const der = new Uint8Array(value.toBER(false));
  const info = tstInfo(der);
  const signed = new pkijs.SignedData({
    schema: pkijs.ContentInfo.fromBER(buffer(der)).content,
  });
  // pkijs checks the token's signature and that its imprint is the hash of
  // the data given: the signature value it certifies.
  const result = await signed
    .verify({
      signer: 0,
      checkChain: false,
      extendedMode: true,
      data: buffer(signerInfo.signature.valueBlock.valueHexView),
    })
    .catch((error: { signerCertificate?: pkijs.Certificate }) => ({
      signatureVerified: false,
      signerCertificate: error?.signerCertificate,
    }));
  const signer = result.signerCertificate;
  return {
    time: info.genTime,
    authority:
      (signer && (name(signer, "2.5.4.3") ?? name(signer, "2.5.4.10"))) ?? "",
    valid: result.signatureVerified === true,
  };
}

function name(cert: pkijs.Certificate, oid: string): string | undefined {
  const entry = cert.subject.typesAndValues.find((tv) => tv.type === oid);
  return entry?.value.valueBlock.value as string | undefined;
}
