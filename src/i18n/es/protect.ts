// Spanish messages: compressing and password protection (spec 014).
export const protect = {
  "protect.wrongPassword": "La contraseña no es correcta.",
  "protect.unsupported":
    "Este PDF usa un tipo de cifrado que todavía no se puede abrir.",
  "protect.askTitle": "PDF protegido",
  "protect.askText": (file: string) =>
    `«${file}» está protegido con contraseña. Escríbela para abrirlo.`,
  "protect.password": "Contraseña",
  "protect.open": "Abrir",
  "protect.cancel": "Cancelar",
  "protect.cancelled": (file: string) => `No se abrió «${file}».`,
  "protect.button": "Contraseña",
  "protect.hint": "Poner o quitar la contraseña del PDF",
  "protect.title": "Proteger con contraseña",
  "protect.repeat": "Repite la contraseña",
  "protect.mismatch": "Las contraseñas no coinciden.",
  "protect.empty": "Escribe una contraseña.",
  "protect.allowPrint": "Permitir imprimir",
  "protect.allowCopy": "Permitir copiar texto",
  "protect.permsNote":
    "Los permisos de imprimir y copiar son orientativos: muchos programas los ignoran. Lo que sí protege el archivo es la contraseña de apertura (AES-256).",
  "protect.forgetNote":
    "Si olvidas la contraseña, no hay forma de recuperar el archivo.",
  "protect.apply": "Proteger al guardar",
  "protect.active": "El PDF se guardará protegido con contraseña (AES-256).",
  "protect.remove": "Quitar contraseña",
  "protect.removed": "Contraseña quitada: el PDF se guardará sin ella.",
  "protect.set": "Contraseña lista: se aplicará al guardar.",
  "protect.signBlocked":
    "Para firmar digitalmente, quita antes la contraseña (panel «Contraseña»).",
  "protect.opened":
    "PDF abierto con su contraseña. Al guardar la conserva, salvo que la quites.",
  "protect.permissionsOnly":
    "Este PDF tenía restricciones de permisos; se abrió sin ellas.",
  "protect.close": "Cerrar",
  "compress.button": "Comprimir",
  "compress.hint": "Reduce el tamaño del PDF",
  "compress.title": "Comprimir PDF",
  "compress.level": "Nivel de compresión",
  "compress.high": "Calidad alta",
  "compress.highHelp":
    "Solo reduce las imágenes con mucha resolución (200 ppp).",
  "compress.balanced": "Equilibrado",
  "compress.balancedHelp":
    "Imágenes a 150 ppp: se ven bien en pantalla y al imprimir.",
  "compress.small": "Tamaño mínimo",
  "compress.smallHelp": "Imágenes a 96 ppp, para enviar por correo o chat.",
  "compress.current": (size: string) => `Tamaño del archivo abierto: ${size}`,
  "compress.run": "Comprimir y descargar",
  "compress.working": "Comprimiendo…",
  "compress.result": (before: string, after: string, saved: number) =>
    `${before} → ${after} (${saved} % menos)`,
  "compress.noGain": "El archivo ya está optimizado: no se pudo reducir más.",
  "compress.suffix": "comprimido",
  "compress.failed": (reason: string) => `No se pudo comprimir: ${reason}`,
  "compress.close": "Cerrar",
};
