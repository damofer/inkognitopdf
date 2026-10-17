// English messages: sign.
import type { sign as es } from "../es/sign";

export const sign: typeof es = {
  // Signing panel and signature pad.
  "sign.sign": "Sign",
  "sign.closeSign": "Close signing",
  "sign.roleSignature": "Signature",
  "sign.roleInitials": "Initials",
  "sign.notCreated": "Not created",
  "sign.change": "Change",
  "sign.create": "Create",
  "sign.placeSignature": "Place signature",
  "sign.placeInitials": "Place initials",
  "sign.rememberOnDevice": "Remember on this device",
  "sign.dateFormat": "Date format",
  "sign.dateDmy": "dd/mm/yyyy",
  "sign.dateIso": "yyyy-mm-dd",
  "sign.placeDate": "Place date",
  "sign.initialsEverywhere": "On every page",
  "sign.initialsEverywhereHint":
    "Put the initials at the bottom right of every page that has none yet",
  "sign.initialsPlaced": (n: number) =>
    n === 0
      ? "Every page already had initials."
      : n === 1
        ? "Initials placed on 1 page."
        : `Initials placed on ${n} pages.`,
  "sign.autoDate": "Add the date under the signature",
  "sign.createSignature": "Create signature",
  "sign.createInitials": "Create initials",
  "sign.draw": "Draw",
  "sign.type": "Type",
  "sign.image": "Image",
  "sign.inkColor": "Ink color",
  "sign.inkBlack": "Black",
  "sign.inkBlue": "Blue",
  "sign.undoStroke": "Undo stroke",
  "sign.clear": "Clear",
  "sign.name": "Name",
  "sign.style": "Style",
  "sign.signatureImage": "Signature image",
  "sign.imageNote":
    "A photo or scan of your signature on light paper. The background becomes transparent.",
  "sign.noSignatureInImage": "No signature was found in the image.",
  "sign.imageConvertFailed": "The image could not be converted.",
  "sign.imageReadFailed": (detail: string) =>
    `The image could not be read: ${detail}`,
  "sign.use": "Use",
  "sign.cancel": "Cancel",

  // Saving signed: visual or digital, identities.
  "sign.saveSigned": "Save signed",
  "sign.signing": "Signing…",
  "sign.modeDigital": "Digital signature (PAdES, recommended)",
  "sign.modeVisual": "Visual only",
  "sign.visualWarning":
    "A visual-only signature is an image on the page: it does not detect later changes to the document.",
  "sign.certificate": "Certificate",
  "sign.forget": "Forget",
  "sign.forgetTitle": "Delete this certificate and its key from this device",
  "sign.createOwnCertificate": "Create your own certificate",
  "sign.importP12": "Import .p12",
  "sign.signerName": "Signer name",
  "sign.fullName": "Full name",
  "sign.emailOptional": "Email (optional)",
  "sign.algorithm": "Algorithm",
  "sign.rsaLegacy": "RSA 3072 (older readers)",
  "sign.selfSignedNote":
    "A self-signed certificate proves the document has not changed, but not who you are: PDF readers show it as “unknown identity”.",
  "sign.createCertificate": "Create certificate",
  "sign.p12File": ".p12 file",
  "sign.filePassword": "File password",
  "sign.password": "Password",
  "sign.import": "Import",
  "sign.rememberCertificate":
    "Save the certificate on this device (the key cannot be exported)",
  "sign.addAuditPage": "Add a signature audit page",
  "sign.selfSignedLabel": (name: string, algorithm: string) =>
    `${name} (self-signed, ${algorithm})`,
  "sign.issuedByLabel": (subject: string, issuer: string) =>
    `${subject} (issued by ${issuer})`,

  // Several signers: preparing the plan.
  "sign.severalSigners": "Multiple signers",
  "sign.planNote":
    "Prepare the document: each signer opens it in InkognitoPDF, fills in their fields and passes it on to the next one. Signers with the same number can sign in any order among themselves.",
  "sign.signatureType": "Signature type",
  "sign.modePades": "Digital (PAdES)",
  "sign.visualPlanWarning":
    "With visual-only signatures, InkognitoPDF enforces the signing order, but the document is not protected: anyone can change it without it showing. A digital signature is recommended.",
  "sign.signerOrder": (n: number) => `Signing order of signer ${n}`,
  "sign.signerNameN": (n: number) => `Name of signer ${n}`,
  "sign.removeSigner": (n: number) => `Remove signer ${n}`,
  "sign.signerEmail": (n: number) => `Email of signer ${n}`,
  "sign.signerFields": (name: string) => `Fields for ${name}`,
  "sign.signerFieldsN": (n: number) => `Fields for signer ${n}`,
  "sign.fieldsPlaced": (n: number) =>
    n === 1 ? "1 field placed" : `${n} fields placed`,
  "sign.addSigner": "Add signer",
  "sign.signersNeedField": "Each signer needs a name and at least one field.",
  "sign.signersNeedSignature":
    "Each signer needs a name and at least one signature field.",
  "sign.saveForSigning": "Save for signing",

  // Several signers: signing as one of them.
  "sign.signAs": "Sign as",
  "sign.signDocument": "Sign the document",
  "sign.closeSignAs": "Close sign as",
  "sign.statusSigned": "signed",
  "sign.statusTurn": "their turn",
  "sign.statusWaiting": "waiting",
  "sign.visualOnlyDocument":
    "This document uses visual-only signatures: it is not protected against changes.",
  "sign.yourFields": (fields: string) =>
    `Your fields: ${fields}. The date and name are filled in automatically.`,
  "sign.yourSignature": "Your signature",
  "sign.yourInitials": "Your initials",
  "sign.textN": (n: number) => `Text ${n}`,
  "sign.createSignatureToContinue": "Create your signature to continue.",
  "sign.createInitialsToContinue": "Create your initials to continue.",
  "sign.signAndSave": "Sign and save",

  // Signatures of the document and trusted roots.
  "sign.documentSignatures": "Document signatures",
  "sign.closeSignatures": "Close signatures",
  "sign.noSignatures": "This document has no digital signatures.",
  "sign.integrityValid": "Signature intact",
  "sign.integrityInvalid": (problem: string) => `Invalid signature. ${problem}`,
  "sign.changesNone": "Covers the whole document.",
  "sign.changesAnnotations":
    "Other signatures, fields or annotations were added later, without changing the signed content.",
  "sign.changesModified": "The document was modified after this signature.",
  "sign.trustTrusted": "Trusted certificate (imported root)",
  "sign.trustSelfSigned":
    "Self-signed certificate: it does not identify the signer",
  "sign.trustUnknown":
    "Unverified certificate: its issuer is not among the imported roots",
  "sign.signedAt": (date: string) => `Signed: ${date}`,
  "sign.reason": (reason: string) => `Reason: ${reason}`,
  "sign.certHolder": "Subject",
  "sign.certIssuer": "Issuer",
  "sign.certSerial": "Serial number",
  "sign.certValidity": "Valid",
  "sign.certFingerprint": "SHA-256 fingerprint",
  "sign.trustedRoots": (n: number) => `Trusted roots (${n})`,
  "sign.trustedRootsNote":
    "InkognitoPDF does not ship a list of certificate authorities. Import the root certificates you trust; they are stored only on this device. Revocation is not checked offline.",
  "sign.remove": "Remove",
  "sign.importRoot": "Import root certificate",
  "sign.badCertificateFile":
    "The file is not a valid certificate (.cer, .crt or .pem).",
};
