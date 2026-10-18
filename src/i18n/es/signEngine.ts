// Spanish messages: signEngine (src/sign/*.ts — signing, certificates,
// verification and the audit page written into the PDF).
export const signEngine = {
  // Audit page (multi.ts, spec 004, HU7). Written into the PDF in the
  // language in use when the page or each row is generated.
  "signEngine.auditTitle": "Registro de firmas",
  "signEngine.auditDocument": (name: string) => `Documento: ${name}`,
  "signEngine.auditNote1": (brand: string) =>
    `Generado por ${brand} en el dispositivo de cada firmante. Cada fila queda cubierta por la firma de quien la escribe;`,
  "signEngine.auditNote2":
    "no sustituye a un registro custodiado por un tercero.",
  "signEngine.auditDateType": (date: string, type: string) =>
    `Fecha: ${date}   Tipo: ${type}`,
  "signEngine.auditModePades": "firma digital (PAdES)",
  "signEngine.auditModeVisual": "solo visual (no detecta cambios)",
  "signEngine.auditCertificate": (fingerprint: string) =>
    `Certificado SHA-256: ${fingerprint}`,
  "signEngine.auditNoCertificate": "Certificado: ninguno",
  "signEngine.auditDocumentHash": (hash: string) =>
    `Documento SHA-256 antes de firmar: ${hash}`,

  // Signing as one signer of a plan (multi.ts).
  "signEngine.signerNotInDocument": "Ese firmante no está en el documento.",
  "signEngine.alreadySigned": (name: string) =>
    `${name} ya firmó este documento.`,
  "signEngine.notYourTurn": (name: string) =>
    `Todavía no le toca a ${name}: faltan firmantes anteriores.`,
  "signEngine.missingSignature": "Falta crear su firma.",
  "signEngine.missingInitials": "Faltan sus iniciales.",
  "signEngine.missingCertificate": "Falta el certificado para firmar.",
  "signEngine.noSignatureField": "Este firmante no tiene campo de firma.",

  // PAdES signing (pades.ts).
  "signEngine.fieldNotFound": (name: string) =>
    `No existe el campo de firma «${name}».`,
  "signEngine.fieldAlreadySigned": "Ese campo ya está firmado.",
  "signEngine.defaultFieldName": (n: number) => `Firma${n}`,
  "signEngine.signatureTooLarge": "La firma no cabe en el espacio reservado.",
  "signEngine.timestampUnreachable":
    "No se pudo contactar con el servicio de sello de tiempo. Revisa la conexión o firma sin sello.",
  "signEngine.timestampRefused":
    "El servicio de sello de tiempo no devolvió un sello válido. Inténtalo de nuevo o firma sin sello.",

  // Incremental updates (incremental.ts).
  "signEngine.noStartxref": "El PDF no tiene startxref.",
  "signEngine.encrypted":
    "El PDF está cifrado. Esta versión no puede firmar PDFs protegidos.",

  // PKCS#12 import (certificates.ts).
  "signEngine.unsupportedKeyType":
    "El tipo de clave del archivo no está admitido.",
  "signEngine.notPkcs12": "El archivo no es un PKCS#12 (.p12 o .pfx) válido.",
  "signEngine.wrongPassword": "La contraseña no es correcta.",
  "signEngine.noData": "El archivo no contiene datos.",
  "signEngine.legacyCipher": (brand: string) =>
    `El archivo usa un cifrado antiguo (3DES o RC2) que ${brand} no admite. Expórtelo de nuevo con AES (por ejemplo, «openssl pkcs12 -export» de OpenSSL 3).`,
  "signEngine.keyDecryptFailed":
    "No se pudo descifrar la clave privada: cifrado no admitido o contraseña incorrecta.",
  "signEngine.noPrivateKey": "El archivo no contiene una clave privada.",
  "signEngine.noCertificate": "El archivo no contiene ningún certificado.",

  // Verification (verify.ts).
  "signEngine.badByteRange": "El rango firmado (/ByteRange) no es válido.",
  "signEngine.byteRangeGap": "El rango firmado no excluye solo la firma.",
  "signEngine.signatureMismatch":
    "La firma no corresponde al contenido firmado.",
  "signEngine.digestMismatch":
    "El documento cambió después de firmarse: el resumen no coincide.",
  "signEngine.verifyFailed": (message: string) =>
    `La firma no se pudo comprobar (${message}).`,
};
