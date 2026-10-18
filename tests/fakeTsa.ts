// A timestamp authority for the tests (spec 040): answers RFC 3161 requests
// with a token signed by its own self-signed certificate, which carries the
// critical timeStamping extended key usage that verifiers require.
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

const OID = {
  tstInfo: "1.2.840.113549.1.9.16.1.4",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  commonName: "2.5.4.3",
  basicConstraints: "2.5.29.19",
  keyUsage: "2.5.29.15",
  extKeyUsage: "2.5.29.37",
  timeStamping: "1.3.6.1.5.5.7.3.8",
  policy: "1.3.6.1.4.1.99999.1",
};

const buffer = (b: Uint8Array) =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

export interface FakeTsa {
  /** The authority's certificate (DER). */
  certificate: Uint8Array;
  /** Answers a TimeStampReq (DER) with a TimeStampResp (DER). */
  respond(request: Uint8Array): Promise<Uint8Array>;
}

export async function fakeTsa(
  options: { name?: string; time?: Date } = {},
): Promise<FakeTsa> {
  const subtle = globalThis.crypto.subtle;
  const keys = (await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const name = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({
        type: OID.commonName,
        value: new asn1js.Utf8String({ value: options.name ?? "Test TSA" }),
      }),
    ],
  });
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 4242 });
  cert.subject = name;
  cert.issuer = name;
  cert.notBefore.value = new Date(Date.now() - 86_400_000);
  cert.notAfter.value = new Date(Date.now() + 365 * 86_400_000);
  cert.extensions = [
    new pkijs.Extension({
      extnID: OID.basicConstraints,
      critical: true,
      extnValue: new pkijs.BasicConstraints({ cA: false })
        .toSchema()
        .toBER(false),
    }),
    new pkijs.Extension({
      extnID: OID.keyUsage,
      critical: true,
      // digitalSignature, nonRepudiation
      extnValue: new asn1js.BitString({
        valueHex: new Uint8Array([0b11000000]).buffer,
        unusedBits: 6,
      }).toBER(false),
    }),
    new pkijs.Extension({
      extnID: OID.extKeyUsage,
      critical: true,
      extnValue: new pkijs.ExtKeyUsage({
        keyPurposes: [OID.timeStamping],
      })
        .toSchema()
        .toBER(false),
    }),
  ];
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(keys.privateKey, "SHA-256");
  const certificate = new Uint8Array(cert.toSchema().toBER(false));
  let serial = 1;

  const respond = async (request: Uint8Array) => {
    const req = pkijs.TimeStampReq.fromBER(buffer(request));
    const info = new pkijs.TSTInfo({
      version: 1,
      policy: OID.policy,
      messageImprint: req.messageImprint,
      serialNumber: new asn1js.Integer({ value: serial++ }),
      genTime: options.time ?? new Date(),
      ...(req.nonce ? { nonce: req.nonce } : {}),
    });
    const content = info.toSchema().toBER(false);
    const digest = await subtle.digest("SHA-256", content);
    const certHash = await subtle.digest("SHA-256", buffer(certificate));
    const signed = new pkijs.SignedData({
      version: 3,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({
        eContentType: OID.tstInfo,
        eContent: new asn1js.OctetString({ valueHex: content }),
      }),
      signerInfos: [
        new pkijs.SignerInfo({
          version: 1,
          sid: new pkijs.IssuerAndSerialNumber({
            issuer: cert.issuer,
            serialNumber: cert.serialNumber,
          }),
          signedAttrs: new pkijs.SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new pkijs.Attribute({
                type: OID.contentType,
                values: [new asn1js.ObjectIdentifier({ value: OID.tstInfo })],
              }),
              new pkijs.Attribute({
                type: OID.messageDigest,
                values: [new asn1js.OctetString({ valueHex: digest })],
              }),
              new pkijs.Attribute({
                type: OID.signingCertificateV2,
                values: [
                  new asn1js.Sequence({
                    value: [
                      new asn1js.Sequence({
                        value: [
                          new asn1js.Sequence({
                            value: [
                              new asn1js.OctetString({ valueHex: certHash }),
                            ],
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        }),
      ],
      certificates: req.certReq ? [cert] : [],
    });
    // DER, as a real authority sends it: pkijs would split it into a
    // constructed OCTET STRING.
    signed.encapContentInfo.eContent = new asn1js.OctetString({
      valueHex: content,
    });
    await signed.sign(keys.privateKey, 0, "SHA-256");
    const token = new pkijs.ContentInfo({
      contentType: OID.signedData,
      content: signed.toSchema(true),
    });
    const response = new pkijs.TimeStampResp({
      status: new pkijs.PKIStatusInfo({ status: 0 }),
      timeStampToken: token,
    });
    return new Uint8Array(response.toSchema().toBER(false));
  };
  return { certificate, respond };
}
