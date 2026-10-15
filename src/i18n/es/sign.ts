// Spanish messages: sign.
export const sign = {
  // Signing panel and signature pad.
  "sign.sign": "Firmar",
  "sign.closeSign": "Cerrar firma",
  "sign.roleSignature": "Firma",
  "sign.roleInitials": "Iniciales",
  "sign.notCreated": "Sin crear",
  "sign.change": "Cambiar",
  "sign.create": "Crear",
  "sign.placeSignature": "Colocar firma",
  "sign.placeInitials": "Colocar iniciales",
  "sign.rememberOnDevice": "Recordar en este dispositivo",
  "sign.dateFormat": "Formato de fecha",
  "sign.dateDmy": "dd/mm/aaaa",
  "sign.dateIso": "aaaa-mm-dd",
  "sign.placeDate": "Colocar fecha",
  "sign.createSignature": "Crear firma",
  "sign.createInitials": "Crear iniciales",
  "sign.draw": "Dibujar",
  "sign.type": "Escribir",
  "sign.image": "Imagen",
  "sign.inkColor": "Color de la tinta",
  "sign.inkBlack": "Negro",
  "sign.inkBlue": "Azul",
  "sign.undoStroke": "Deshacer trazo",
  "sign.clear": "Borrar",
  "sign.name": "Nombre",
  "sign.style": "Estilo",
  "sign.signatureImage": "Imagen de la firma",
  "sign.imageNote":
    "Una foto o un escaneo de su firma sobre papel claro. El fondo se vuelve transparente.",
  "sign.noSignatureInImage": "No se encontró ninguna firma en la imagen.",
  "sign.imageConvertFailed": "No se pudo convertir la imagen.",
  "sign.imageReadFailed": (detail: string) =>
    `No se pudo leer la imagen: ${detail}`,
  "sign.use": "Usar",
  "sign.cancel": "Cancelar",

  // Saving signed: visual or digital, identities.
  "sign.saveSigned": "Guardar firmado",
  "sign.signing": "Firmando…",
  "sign.modeDigital": "Firma digital (PAdES, recomendada)",
  "sign.modeVisual": "Solo visual",
  "sign.visualWarning":
    "Una firma solo visual es una imagen en la página: no detecta cambios posteriores en el documento.",
  "sign.certificate": "Certificado",
  "sign.forget": "Olvidar",
  "sign.forgetTitle": "Borrar este certificado y su clave de este dispositivo",
  "sign.createOwnCertificate": "Crear certificado propio",
  "sign.importP12": "Importar .p12",
  "sign.signerName": "Nombre del firmante",
  "sign.fullName": "Nombre y apellidos",
  "sign.emailOptional": "Correo (opcional)",
  "sign.algorithm": "Algoritmo",
  "sign.rsaLegacy": "RSA 3072 (lectores antiguos)",
  "sign.selfSignedNote":
    "Un certificado autofirmado prueba que el documento no cambió, pero no quién es usted: los lectores lo muestran como «identidad desconocida».",
  "sign.createCertificate": "Crear certificado",
  "sign.p12File": "Archivo .p12",
  "sign.filePassword": "Contraseña del archivo",
  "sign.password": "Contraseña",
  "sign.import": "Importar",
  "sign.rememberCertificate":
    "Guardar el certificado en este dispositivo (la clave no se puede exportar)",
  "sign.addAuditPage": "Añadir página de registro de firmas",
  "sign.selfSignedLabel": (name: string, algorithm: string) =>
    `${name} (autofirmado, ${algorithm})`,
  "sign.issuedByLabel": (subject: string, issuer: string) =>
    `${subject} (emitido por ${issuer})`,

  // Several signers: preparing the plan.
  "sign.severalSigners": "Varios firmantes",
  "sign.planNote":
    "Prepare el documento: cada firmante lo abre en InkognitoPDF, rellena sus campos y lo pasa al siguiente. Los que tienen el mismo número firman en cualquier orden entre ellos.",
  "sign.signatureType": "Tipo de firma",
  "sign.modePades": "Digital (PAdES)",
  "sign.visualPlanWarning":
    "Con firmas solo visuales, InkognitoPDF respeta el orden, pero el documento no queda protegido: cualquiera puede cambiarlo sin que se note. Se recomienda la firma digital.",
  "sign.signerOrder": (n: number) => `Orden del firmante ${n}`,
  "sign.signerNameN": (n: number) => `Nombre del firmante ${n}`,
  "sign.removeSigner": (n: number) => `Quitar firmante ${n}`,
  "sign.signerEmail": (n: number) => `Correo del firmante ${n}`,
  "sign.signerFields": (name: string) => `Campos de ${name}`,
  "sign.signerFieldsN": (n: number) => `Campos de firmante ${n}`,
  "sign.fieldsPlaced": (n: number) =>
    n === 1 ? "1 campo colocado" : `${n} campos colocados`,
  "sign.addSigner": "Añadir firmante",
  "sign.signersNeedField":
    "Cada firmante necesita un nombre y al menos un campo.",
  "sign.signersNeedSignature":
    "Cada firmante necesita un nombre y al menos un campo de firma.",
  "sign.saveForSigning": "Guardar para firmar",

  // Several signers: signing as one of them.
  "sign.signAs": "Firmar como",
  "sign.signDocument": "Firmar el documento",
  "sign.closeSignAs": "Cerrar firmar como",
  "sign.statusSigned": "firmó",
  "sign.statusTurn": "le toca",
  "sign.statusWaiting": "espera",
  "sign.visualOnlyDocument":
    "Este documento usa firmas solo visuales: no queda protegido contra cambios.",
  "sign.yourFields": (fields: string) =>
    `Sus campos: ${fields}. La fecha y el nombre se rellenan solos.`,
  "sign.yourSignature": "Su firma",
  "sign.yourInitials": "Sus iniciales",
  "sign.textN": (n: number) => `Texto ${n}`,
  "sign.createSignatureToContinue": "Cree su firma para continuar.",
  "sign.createInitialsToContinue": "Cree sus iniciales para continuar.",
  "sign.signAndSave": "Firmar y guardar",

  // Signatures of the document and trusted roots.
  "sign.documentSignatures": "Firmas del documento",
  "sign.closeSignatures": "Cerrar firmas",
  "sign.noSignatures": "Este documento no tiene firmas digitales.",
  "sign.integrityValid": "Firma íntegra",
  "sign.integrityInvalid": (problem: string) => `Firma no válida. ${problem}`,
  "sign.changesNone": "Cubre todo el documento.",
  "sign.changesAnnotations":
    "Después se añadieron otras firmas, campos o anotaciones, sin cambiar el contenido firmado.",
  "sign.changesModified": "El documento se modificó después de esta firma.",
  "sign.trustTrusted": "Certificado de confianza (raíz importada)",
  "sign.trustSelfSigned": "Certificado autofirmado: no identifica al firmante",
  "sign.trustUnknown":
    "Certificado no verificado: su emisor no está entre las raíces importadas",
  "sign.signedAt": (date: string) => `Firmado: ${date}`,
  "sign.reason": (reason: string) => `Motivo: ${reason}`,
  "sign.certHolder": "Titular",
  "sign.certIssuer": "Emisor",
  "sign.certSerial": "Número de serie",
  "sign.certValidity": "Válido",
  "sign.certFingerprint": "Huella SHA-256",
  "sign.trustedRoots": (n: number) => `Raíces de confianza (${n})`,
  "sign.trustedRootsNote":
    "InkognitoPDF no trae una lista de autoridades. Importe los certificados raíz en los que confía; se guardan solo en este dispositivo. Sin conexión no se comprueba la revocación.",
  "sign.remove": "Quitar",
  "sign.importRoot": "Importar certificado raíz",
  "sign.badCertificateFile":
    "El archivo no es un certificado válido (.cer, .crt o .pem).",
};
