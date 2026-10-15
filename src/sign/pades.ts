/**
 * PAdES B-B digital signature (spec 004, HU5): a signature field and widget,
 * a /Sig dictionary whose /ByteRange covers the whole file except /Contents,
 * and a detached CAdES (CMS) signature in /Contents. Written as an
 * incremental update, so earlier signatures stay valid.
 */
import * as asn1js from "asn1js";
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  type PDFObject,
} from "pdf-lib";
import * as pkijs from "pkijs";
import { FontCache, type LoadFont } from "../engine/fonts";
import { placeOperators, signatureXObject } from "../engine/signature";
import type { Rect } from "../model/geometry";
import type { SignatureAsset } from "../model/signature";
import { t } from "../i18n";
import type { Identity } from "./certificates";
import { IncrementalUpdate, latin1 } from "./incremental";

/** Bytes reserved for the CMS in /Contents (hex doubles it). */
export const CONTENTS_SIZE = 16384;
const PLACEHOLDER = "0000000000";

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  sha256: "2.16.840.1.101.3.4.2.1",
} as const;

const buffer = (b: Uint8Array) =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** PDF date, e.g. D:20261014153000+02'00'. */
export function pdfDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `D:${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}'${p(abs % 60)}'`
  );
}

/** A text string: PDFDocEncoding-safe ASCII as is, anything else UTF-16. */
const text = (s: string) =>
  /^[\x20-\x7e]*$/.test(s) ? PDFString.of(s) : PDFHexString.fromText(s);

/** Detached CMS SignedData (CAdES, PAdES B-B) over `data`. */
export async function cmsSign(
  data: Uint8Array,
  identity: Identity,
): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const cert = pkijs.Certificate.fromBER(buffer(identity.certificate));
  const digest = await subtle.digest("SHA-256", buffer(data));
  const certHash = await subtle.digest("SHA-256", buffer(identity.certificate));
  // SigningCertificateV2 ::= SEQUENCE { certs SEQUENCE OF ESSCertIDv2 }, with
  // ESSCertIDv2 ::= SEQUENCE { hashAlgorithm DEFAULT sha256, certHash,
  // issuerSerial }.
  const essCertId = new asn1js.Sequence({
    value: [
      new asn1js.OctetString({ valueHex: certHash }),
      new asn1js.Sequence({
        value: [
          new asn1js.Sequence({
            value: [
              new asn1js.Constructed({
                idBlock: { tagClass: 3, tagNumber: 4 },
                value: [cert.issuer.toSchema()],
              }),
            ],
          }),
          cert.serialNumber,
        ],
      }),
    ],
  });
  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: OID.data,
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
              values: [new asn1js.ObjectIdentifier({ value: OID.data })],
            }),
            new pkijs.Attribute({
              type: OID.messageDigest,
              values: [new asn1js.OctetString({ valueHex: digest })],
            }),
            new pkijs.Attribute({
              type: OID.signingCertificateV2,
              values: [
                new asn1js.Sequence({
                  value: [new asn1js.Sequence({ value: [essCertId] })],
                }),
              ],
            }),
          ],
        }),
      }),
    ],
    certificates: [
      cert,
      ...identity.chain.map((c) => pkijs.Certificate.fromBER(buffer(c))),
    ],
  });
  await signedData.sign(identity.privateKey, 0, "SHA-256");
  const contentInfo = new pkijs.ContentInfo({
    contentType: OID.signedData,
    content: signedData.toSchema(true),
  });
  return new Uint8Array(contentInfo.toSchema().toBER(false));
}

export interface SignatureAppearance {
  /** Page index (0-based) of the widget. */
  page: number;
  rect: Rect;
  rotate: 0 | 90 | 180 | 270;
  asset: SignatureAsset;
}

export interface SignOptions {
  identity: Identity;
  /** Visible signature; omitted for an invisible one. */
  appearance?: SignatureAppearance;
  /** Name of an existing empty signature field to fill (spec 004, HU6). */
  fieldName?: string;
  name?: string;
  reason?: string;
  location?: string;
  contactInfo?: string;
  date?: Date;
  loadFont: LoadFont;
  /** Extra changes made in the same update (annotations of a signer). */
  prepare?: (update: IncrementalUpdate) => Promise<void>;
}

const lookupDict = (update: IncrementalUpdate, obj: PDFObject | undefined) =>
  obj instanceof PDFRef
    ? update.context.lookup(obj, PDFDict)
    : obj instanceof PDFDict
      ? obj
      : undefined;

/** All terminal fields of the AcroForm, with their reference. */
export function formFields(
  update: IncrementalUpdate,
): { ref: PDFRef; dict: PDFDict }[] {
  const acroForm = lookupDict(
    update,
    update.doc.catalog.get(PDFName.of("AcroForm")),
  );
  const out: { ref: PDFRef; dict: PDFDict }[] = [];
  const visit = (array: PDFObject | undefined) => {
    const fields =
      array instanceof PDFRef ? update.context.lookup(array) : array;
    if (!(fields instanceof PDFArray)) return;
    for (const item of fields.asArray()) {
      if (!(item instanceof PDFRef)) continue;
      const dict = update.context.lookup(item, PDFDict);
      const kids = dict.get(PDFName.of("Kids"));
      if (kids) visit(kids);
      else out.push({ ref: item, dict });
    }
  };
  visit(acroForm?.get(PDFName.of("Fields")));
  return out;
}

/** The AcroForm dictionary, made indirect-safe and marked as changed. */
function editableAcroForm(update: IncrementalUpdate): PDFDict {
  const { catalog } = update.doc;
  const current = catalog.get(PDFName.of("AcroForm"));
  if (current instanceof PDFRef) {
    update.touch(current);
    return update.context.lookup(current, PDFDict);
  }
  update.touch(update.context.trailerInfo.Root as PDFRef);
  if (current instanceof PDFDict) return current;
  const dict = update.context.obj({ Fields: [] });
  catalog.set(PDFName.of("AcroForm"), dict);
  return dict;
}

/** The Fields array of the AcroForm, marked as changed. */
function editableFields(
  update: IncrementalUpdate,
  acroForm: PDFDict,
): PDFArray {
  const fields = acroForm.get(PDFName.of("Fields"));
  if (fields instanceof PDFRef) {
    update.touch(fields);
    return update.context.lookup(fields, PDFArray);
  }
  if (fields instanceof PDFArray) return fields;
  const array = update.context.obj([]);
  acroForm.set(PDFName.of("Fields"), array);
  return array;
}

/** Adds `annot` to the page's /Annots, marking whatever holds it as changed. */
export function addAnnotation(
  update: IncrementalUpdate,
  pageIndex: number,
  annot: PDFRef,
): PDFRef {
  const page = update.doc.getPage(pageIndex);
  const annots = page.node.get(PDFName.of("Annots"));
  if (annots instanceof PDFRef) {
    update.touch(annots);
    update.context.lookup(annots, PDFArray).push(annot);
  } else {
    update.touch(page.ref);
    if (annots instanceof PDFArray) annots.push(annot);
    else page.node.set(PDFName.of("Annots"), update.context.obj([annot]));
  }
  return page.ref;
}

/** Appearance stream of a widget or stamp of `rect` drawing `asset`. */
export async function appearanceStream(
  update: IncrementalUpdate,
  asset: SignatureAsset,
  rect: Rect,
  rotate: 0 | 90 | 180 | 270,
  fonts: FontCache,
): Promise<PDFRef> {
  const xobject = await signatureXObject(update.doc, asset, fonts);
  const content = placeOperators(
    "Sig",
    xobject,
    { x: 0, y: 0, width: rect.width, height: rect.height },
    rotate,
  );
  return update.context.register(
    update.context.flateStream(new TextEncoder().encode(content), {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, rect.width, rect.height],
      Resources: { XObject: { Sig: xobject.ref } },
    }),
  );
}

/** Signs `pdf` (PAdES B-B) as an incremental update. */
export async function signPdf(
  pdf: Uint8Array,
  options: SignOptions,
): Promise<Uint8Array> {
  const update = await IncrementalUpdate.load(pdf);
  const { context } = update;
  const fonts = new FontCache(update.doc, options.loadFont);
  const date = options.date ?? new Date();

  const acroForm = editableAcroForm(update);
  acroForm.set(PDFName.of("SigFlags"), PDFNumber.of(3));

  // The widget: an existing empty field, or a new one.
  let widget: PDFDict;
  let widgetRef: PDFRef;
  const existing = options.fieldName
    ? formFields(update).find(
        (f) =>
          f.dict.get(PDFName.of("T"))?.toString() ===
            PDFString.of(options.fieldName!).toString() ||
          (
            f.dict.get(PDFName.of("T")) as PDFString | PDFHexString | undefined
          )?.decodeText() === options.fieldName,
      )
    : undefined;
  if (options.fieldName && !existing)
    throw new Error(t("signEngine.fieldNotFound", options.fieldName));
  if (existing) {
    if (existing.dict.get(PDFName.of("V")))
      throw new Error(t("signEngine.fieldAlreadySigned"));
    widget = existing.dict;
    widgetRef = existing.ref;
    update.touch(widgetRef);
  } else {
    const count = formFields(update).filter(
      (f) => f.dict.get(PDFName.of("FT"))?.toString() === "/Sig",
    ).length;
    widget = context.obj({
      Type: "Annot",
      Subtype: "Widget",
      FT: "Sig",
      T: PDFString.of(t("signEngine.defaultFieldName", count + 1)),
      F: 132, // Print, Locked
      Rect: [0, 0, 0, 0],
    });
    widgetRef = context.register(widget);
    editableFields(update, acroForm).push(widgetRef);
    const pageIndex = options.appearance?.page ?? 0;
    widget.set(PDFName.of("P"), addAnnotation(update, pageIndex, widgetRef));
  }

  if (options.appearance) {
    const { rect, rotate, asset } = options.appearance;
    widget.set(
      PDFName.of("Rect"),
      context.obj([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]),
    );
    widget.set(
      PDFName.of("AP"),
      context.obj({
        N: await appearanceStream(update, asset, rect, rotate, fonts),
      }),
    );
  }

  await options.prepare?.(update);
  await fonts.embedSubstitutes();

  // The signature dictionary, written by hand to know where /Contents is.
  const sigRef = update.reserve();
  widget.set(PDFName.of("V"), sigRef);
  const entries = [
    "/Type /Sig",
    "/Filter /Adobe.PPKLite",
    "/SubFilter /ETSI.CAdES.detached",
    `/ByteRange [0 ${PLACEHOLDER} ${PLACEHOLDER} ${PLACEHOLDER}]`,
    `/Contents <${"0".repeat(CONTENTS_SIZE * 2)}>`,
    `/M ${PDFString.of(pdfDate(date)).toString()}`,
    options.name ? `/Name ${text(options.name).toString()}` : "",
    options.reason ? `/Reason ${text(options.reason).toString()}` : "",
    options.location ? `/Location ${text(options.location).toString()}` : "",
    options.contactInfo
      ? `/ContactInfo ${text(options.contactInfo).toString()}`
      : "",
  ].filter(Boolean);
  update.setRaw(sigRef, latin1(`<< ${entries.join(" ")} >>`));

  const { bytes, offsets } = update.write();

  // Fill /ByteRange, then sign everything but the /Contents hex string.
  const at = offsets.get(sigRef.objectNumber)!;
  const head = new TextDecoder("latin1").decode(bytes.subarray(at, at + 400));
  const rangeAt = at + head.indexOf("/ByteRange [0 ") + "/ByteRange [0 ".length;
  const contentsStart = at + head.indexOf("/Contents <");
  const start = contentsStart + "/Contents ".length; // at "<"
  const end = start + CONTENTS_SIZE * 2 + 2; // after ">"
  const range = [start, end, bytes.length - end];
  const field = (n: number) => String(n).padEnd(PLACEHOLDER.length, " ");
  bytes.set(latin1(range.map(field).join(" ")), rangeAt);

  const signed = new Uint8Array(start + (bytes.length - end));
  signed.set(bytes.subarray(0, start), 0);
  signed.set(bytes.subarray(end), start);
  const cms = await cmsSign(signed, options.identity);
  if (cms.length > CONTENTS_SIZE)
    throw new Error(t("signEngine.signatureTooLarge"));
  const hexCms = [...cms]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  bytes.set(latin1(hexCms), start + 1);
  return bytes;
}
