/**
 * Several signers in order (spec 004, HU6, CA9) and the audit page (HU7,
 * CA10). The plan travels inside the PDF (catalog key /PdfcraftSigning), so
 * each signer opens the file in the app, signs their fields and passes it
 * on. Every signer's changes are one incremental update made of annotations
 * and widgets only, so earlier signatures stay valid.
 */
import {
  PDFDict,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  type PDFFont,
} from "pdf-lib";
import { FontCache, type LoadFont } from "../engine/fonts";
import { SubstituteFont } from "../engine/substituteFont";
import { BRAND } from "../brand";
import { locale, t } from "../i18n";
import type { Box, Rect } from "../model/geometry";
import type { SignatureAsset, SignFieldType } from "../model/signature";
import { certificateInfo, type Identity } from "./certificates";
import { IncrementalUpdate } from "./incremental";
import { addAnnotation, appearanceStream, formFields, signPdf } from "./pades";
import type { Timestamper } from "./timestamp";

export type PlanMode = "pades" | "visual";

export interface PlanSigner {
  id: string;
  name: string;
  email?: string;
  /** Signers with the same number sign in any order between them (H3). */
  order: number;
  /** Visual mode only: when the signer finished (ISO date). */
  signedAt?: string;
}

export interface PlanField {
  id: string;
  /** Page index (0-based) in the prepared file. */
  page: number;
  rect: Rect;
  type: SignFieldType;
  signerId: string;
}

export interface SigningPlan {
  version: 1;
  mode: PlanMode;
  signers: PlanSigner[];
  fields: PlanField[];
  /** Page index of the audit page, if any. */
  auditPage: number | null;
}

const PLAN_KEY = PDFName.of("PdfcraftSigning");

/** Name of the PAdES field of a signer: their first signature field. */
export const sigFieldName = (field: PlanField) => `pdfcraft-${field.id}`;

/** The PAdES field of each signer (their first signature field). */
export function primaryFields(plan: SigningPlan): Map<string, PlanField> {
  const out = new Map<string, PlanField>();
  for (const field of plan.fields)
    if (field.type === "signature" && !out.has(field.signerId))
      out.set(field.signerId, field);
  return out;
}

export async function readPlan(bytes: Uint8Array): Promise<SigningPlan | null> {
  const update = await IncrementalUpdate.load(bytes);
  return planOf(update);
}

function planOf(update: IncrementalUpdate): SigningPlan | null {
  const value = update.doc.catalog.get(PLAN_KEY);
  if (!(value instanceof PDFHexString || value instanceof PDFString))
    return null;
  try {
    const plan = JSON.parse(value.decodeText()) as SigningPlan;
    return plan.version === 1 ? plan : null;
  } catch {
    return null;
  }
}

function setPlan(update: IncrementalUpdate, plan: SigningPlan) {
  update.touch(update.context.trailerInfo.Root as PDFRef);
  update.doc.catalog.set(PLAN_KEY, PDFHexString.fromText(JSON.stringify(plan)));
}

export interface SignerStatus {
  signer: PlanSigner;
  done: boolean;
  /** Whether it is this signer's turn (all earlier orders are done). */
  canSign: boolean;
}

/** Who signed and whose turn it is, from the signatures in the file. */
export async function planStatus(
  bytes: Uint8Array,
  plan: SigningPlan,
): Promise<SignerStatus[]> {
  const update = await IncrementalUpdate.load(bytes);
  const current = planOf(update) ?? plan;
  const signed = new Set(
    formFields(update)
      .filter((f) => f.dict.get(PDFName.of("V")))
      .map((f) => (f.dict.get(PDFName.of("T")) as PDFString).decodeText()),
  );
  const primary = primaryFields(current);
  const done = (s: PlanSigner) =>
    current.mode === "pades"
      ? signed.has(sigFieldName(primary.get(s.id) ?? ({ id: "" } as PlanField)))
      : !!s.signedAt;
  const pending = current.signers.filter((s) => !done(s));
  const turn = Math.min(...pending.map((s) => s.order));
  return current.signers.map((signer) => ({
    signer,
    done: done(signer),
    canSign: !done(signer) && signer.order === turn,
  }));
}

/**
 * Writes the plan into `bytes` (prepared by the editor, with the audit page
 * already added) and, in PAdES mode, an empty signature field per signer.
 */
export async function preparePlan(
  bytes: Uint8Array,
  plan: SigningPlan,
): Promise<Uint8Array> {
  const update = await IncrementalUpdate.load(bytes);
  const { context } = update;
  if (plan.mode === "pades") {
    const root = update.context.trailerInfo.Root as PDFRef;
    update.touch(root);
    let acroForm = update.doc.catalog.get(PDFName.of("AcroForm"));
    if (acroForm instanceof PDFRef) {
      update.touch(acroForm);
      acroForm = context.lookup(acroForm, PDFDict);
    }
    if (!(acroForm instanceof PDFDict)) {
      acroForm = context.obj({ Fields: [] });
      update.doc.catalog.set(PDFName.of("AcroForm"), acroForm);
    }
    const form = acroForm as PDFDict;
    let fields = form.get(PDFName.of("Fields"));
    if (fields instanceof PDFRef) {
      update.touch(fields);
      fields = context.lookup(fields);
    }
    if (!fields) {
      fields = context.obj([]);
      form.set(PDFName.of("Fields"), fields);
    }
    for (const field of primaryFields(plan).values()) {
      const { x, y, width, height } = field.rect;
      const widget = context.register(
        context.obj({
          Type: "Annot",
          Subtype: "Widget",
          FT: "Sig",
          T: PDFString.of(sigFieldName(field)),
          F: 4,
          Rect: [x, y, x + width, y + height],
        }),
      );
      (fields as unknown as { push(r: PDFRef): void }).push(widget);
      const pageRef = addAnnotation(update, field.page, widget);
      context.lookup(widget, PDFDict).set(PDFName.of("P"), pageRef);
    }
  }
  setPlan(update, plan);
  return update.write().bytes;
}

/** Appearance of a line (or lines) of text filling `rect`. */
async function textAppearance(
  update: IncrementalUpdate,
  lines: string[],
  rect: Rect,
  fonts: FontCache,
  maxSize = 12,
): Promise<PDFRef> {
  const joined = lines.join(" ");
  const font = await fonts.forText(joined, "Helvetica", false, false);
  const widthOf = (s: string, size: number) =>
    font instanceof SubstituteFont
      ? font.widthOf(s) * size
      : (font as PDFFont).widthOfTextAtSize(s, size);
  const encode = (s: string) =>
    font instanceof SubstituteFont
      ? font.encode(s).toString()
      : (font as PDFFont).encodeText(s).toString();
  const lineHeight = 1.25;
  let size = Math.min(
    maxSize,
    (rect.height / lines.length / lineHeight) * 0.95,
  );
  for (const line of lines)
    if (line && widthOf(line, size) > rect.width - 2)
      size = Math.min(size, ((rect.width - 2) / widthOf(line, size)) * size);
  const top = rect.height - size;
  const ops = ["BT", "0 g", `/F1 ${size.toFixed(2)} Tf`];
  lines.forEach((line, i) => {
    ops.push(
      `1 0 0 1 1 ${(top - i * size * lineHeight).toFixed(2)} Tm`,
      `${encode(line)} Tj`,
    );
  });
  ops.push("ET");
  return update.context.register(
    update.context.flateStream(new TextEncoder().encode(ops.join("\n")), {
      Type: "XObject",
      Subtype: "Form",
      BBox: [0, 0, rect.width, rect.height],
      Resources: { Font: { F1: font.ref } },
    }),
  );
}

/** A locked, printable stamp annotation with the given appearance. */
function addStamp(
  update: IncrementalUpdate,
  page: number,
  rect: Rect,
  appearance: PDFRef,
  contents: string,
) {
  const { context } = update;
  const ref = context.register(
    context.obj({
      Type: "Annot",
      Subtype: "Stamp",
      Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
      F: 132, // Print, Locked
      AP: { N: appearance },
      Contents: PDFHexString.fromText(contents),
      NM: PDFString.of(
        `pdfcraft-${Date.now().toString(36)}-${context.largestObjectNumber}`,
      ),
    }),
  );
  const pageRef = addAnnotation(update, page, ref);
  context.lookup(ref, PDFDict).set(PDFName.of("P"), pageRef);
}

const AUDIT = { margin: 56, firstRowFromTop: 150, rowHeight: 74 };

/**
 * Text items of a new audit page (spec 004, CA10), drawn by the editor in
 * the interface language in use when the plan is prepared.
 */
export function auditPageText(box: Box, documentName: string) {
  const top = box[3] - AUDIT.margin;
  return [
    { text: t("signEngine.auditTitle"), size: 18, bold: true, y: top - 18 },
    {
      text: t("signEngine.auditDocument", documentName),
      size: 10,
      bold: false,
      y: top - 44,
    },
    {
      text: t("signEngine.auditNote1", BRAND),
      size: 8,
      bold: false,
      y: top - 62,
    },
    { text: t("signEngine.auditNote2"), size: 8, bold: false, y: top - 73 },
  ].map((item) => ({ ...item, x: box[0] + AUDIT.margin }));
}

export interface AuditEntry {
  index: number;
  name: string;
  email?: string;
  date: Date;
  mode: PlanMode;
  certificateFingerprint?: string;
  /** SHA-256 of the file before this signer's update. */
  documentHash: string;
}

const hex = (b: ArrayBuffer) =>
  [...new Uint8Array(b)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    ),
  );
}

/**
 * Local date and time with the UTC offset, in the interface language:
 * "14/10/2026 12:30:05 (UTC+02:00)" in Spanish,
 * "10/14/2026 12:30:05 PM (UTC+02:00)" in English.
 */
export function auditDate(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const day = date.toLocaleDateString(locale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  // Recent ICU puts a narrow no-break space before "PM", which the standard
  // PDF fonts lack: use a plain space.
  const time = date
    .toLocaleTimeString(locale(), {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    .replace(/\s/g, " ");
  return `${day} ${time} (UTC${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)})`;
}

export function auditLines(entry: AuditEntry): string[] {
  return [
    `${entry.index + 1}. ${entry.name}${entry.email ? ` <${entry.email}>` : ""}`,
    t(
      "signEngine.auditDateType",
      auditDate(entry.date),
      entry.mode === "pades"
        ? t("signEngine.auditModePades")
        : t("signEngine.auditModeVisual"),
    ),
    entry.certificateFingerprint
      ? t("signEngine.auditCertificate", entry.certificateFingerprint)
      : t("signEngine.auditNoCertificate"),
    t("signEngine.auditDocumentHash", entry.documentHash),
  ];
}

/** Adds the audit row of `entry` to the audit page. */
export async function addAuditRow(
  update: IncrementalUpdate,
  page: number,
  entry: AuditEntry,
  fonts: FontCache,
) {
  const { x, y, width, height } = update.doc.getPage(page).getMediaBox();
  const rowsPerPage = Math.floor(
    (height - AUDIT.firstRowFromTop - AUDIT.margin) / AUDIT.rowHeight,
  );
  const row = Math.min(entry.index, rowsPerPage - 1);
  const rect = {
    x: x + AUDIT.margin,
    y: y + height - AUDIT.firstRowFromTop - (row + 1) * AUDIT.rowHeight + 10,
    width: width - 2 * AUDIT.margin,
    height: AUDIT.rowHeight - 14,
  };
  const lines = auditLines(entry);
  const appearance = await textAppearance(update, lines, rect, fonts, 9);
  addStamp(update, page, rect, appearance, lines.join("\n"));
}

export interface SignAsOptions {
  plan: SigningPlan;
  signerId: string;
  assets: Partial<Record<"signature" | "initials", SignatureAsset>>;
  /** Values of the signer's text fields, by field id. */
  texts?: Record<string, string>;
  identity?: Identity;
  /** Adds a trusted timestamp to the PAdES signature (spec 040). */
  timestamp?: Timestamper;
  date?: Date;
  formatDate: (date: Date) => string;
  loadFont: LoadFont;
}

/** The file signed by one signer of the plan (one incremental update). */
export async function signAsSigner(
  bytes: Uint8Array,
  options: SignAsOptions,
): Promise<Uint8Array> {
  const date = options.date ?? new Date();
  const status = await planStatus(bytes, options.plan);
  const me = status.find((s) => s.signer.id === options.signerId);
  if (!me) throw new Error(t("signEngine.signerNotInDocument"));
  if (me.done) throw new Error(t("signEngine.alreadySigned", me.signer.name));
  if (!me.canSign) throw new Error(t("signEngine.notYourTurn", me.signer.name));
  const plan = options.plan;
  const signer = me.signer;
  const mine = plan.fields.filter((f) => f.signerId === signer.id);
  const primary = primaryFields(plan).get(signer.id);
  const documentHash = await sha256Hex(bytes);
  const signedCount = status.filter((s) => s.done).length;

  const need = (role: "signature" | "initials") => {
    const asset = options.assets[role];
    if (!asset)
      throw new Error(
        role === "signature"
          ? t("signEngine.missingSignature")
          : t("signEngine.missingInitials"),
      );
    return asset;
  };

  const fill = async (update: IncrementalUpdate, fonts: FontCache) => {
    for (const field of mine) {
      if (plan.mode === "pades" && field === primary) continue;
      const rotate = update.doc.getPage(field.page).getRotation().angle as
        0 | 90 | 180 | 270;
      if (field.type === "signature" || field.type === "initials") {
        const ap = await appearanceStream(
          update,
          need(field.type),
          field.rect,
          rotate,
          fonts,
        );
        addStamp(
          update,
          field.page,
          field.rect,
          ap,
          `${t(`signField.${field.type}`)}: ${signer.name}`,
        );
      } else {
        const value =
          field.type === "date"
            ? options.formatDate(date)
            : field.type === "name"
              ? signer.name
              : (options.texts?.[field.id] ?? "");
        if (!value.trim()) continue;
        const ap = await textAppearance(update, [value], field.rect, fonts, 14);
        addStamp(update, field.page, field.rect, ap, value);
      }
    }
    if (plan.auditPage !== null) {
      const certificateFingerprint = options.identity
        ? (await certificateInfo(options.identity.certificate)).fingerprint
        : undefined;
      await addAuditRow(
        update,
        plan.auditPage,
        {
          index: signedCount,
          name: signer.name,
          email: signer.email,
          date,
          mode: plan.mode,
          certificateFingerprint,
          documentHash,
        },
        fonts,
      );
    }
  };

  if (plan.mode === "pades") {
    if (!options.identity) throw new Error(t("signEngine.missingCertificate"));
    if (!primary) throw new Error(t("signEngine.noSignatureField"));
    const page = primary.page;
    const pdfPage = (await IncrementalUpdate.load(bytes)).doc.getPage(page);
    const rotate = pdfPage.getRotation().angle as 0 | 90 | 180 | 270;
    return signPdf(bytes, {
      identity: options.identity,
      fieldName: sigFieldName(primary),
      appearance: {
        page,
        rect: primary.rect,
        rotate,
        asset: need("signature"),
      },
      name: signer.name,
      contactInfo: signer.email,
      date,
      loadFont: options.loadFont,
      timestamp: options.timestamp,
      prepare: async (update) => {
        const fonts = new FontCache(update.doc, options.loadFont);
        await fill(update, fonts);
        await fonts.embedAll();
      },
    });
  }

  const update = await IncrementalUpdate.load(bytes);
  const fonts = new FontCache(update.doc, options.loadFont);
  await fill(update, fonts);
  await fonts.embedAll();
  const current = planOf(update) ?? plan;
  setPlan(update, {
    ...current,
    signers: current.signers.map((s) =>
      s.id === signer.id ? { ...s, signedAt: date.toISOString() } : s,
    ),
  });
  return update.write().bytes;
}

/**
 * The audit row of a single signer (spec 004, HU7), as a `prepare` step of
 * `signPdf` or applied on its own to a visual-only signed file.
 */
export function auditRowStep(
  page: number,
  entry: AuditEntry,
  loadFont: LoadFont,
) {
  return async (update: IncrementalUpdate) => {
    const fonts = new FontCache(update.doc, loadFont);
    await addAuditRow(update, page, entry, fonts);
    await fonts.embedAll();
  };
}

/** `bytes` with the audit row added as an incremental update. */
export async function withAuditRow(
  bytes: Uint8Array,
  page: number,
  entry: AuditEntry,
  loadFont: LoadFont,
): Promise<Uint8Array> {
  const update = await IncrementalUpdate.load(bytes);
  await auditRowStep(page, entry, loadFont)(update);
  return update.write().bytes;
}
