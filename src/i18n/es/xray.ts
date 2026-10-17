// Spanish messages: privacy x-ray (spec 015).
export const xray = {
  "xray.button": "Radiografía",
  "xray.hint":
    "¿Qué esconde este PDF? Metadatos, versiones anteriores, texto invisible, adjuntos…",
  "xray.title": "¿Qué esconde este PDF?",
  "xray.close": "Cerrar radiografía",
  "xray.scanning": "Analizando el archivo en tu dispositivo…",
  "xray.failed": "No se pudo analizar el archivo.",
  "xray.nothing": "No encontramos nada escondido.",
  "xray.onlyInfo": "No encontramos nada preocupante.",
  "xray.summary": (n: number) =>
    n === 1
      ? "Este PDF esconde 1 cosa que no se ve."
      : `Este PDF esconde ${n} cosas que no se ven.`,
  "xray.local": "El análisis se hace en tu dispositivo; el PDF no se sube.",
  "xray.level.high": "Riesgo alto",
  "xray.level.medium": "Revisar",
  "xray.level.info": "Informativo",
  "xray.remove": "Quitar",
  "xray.alwaysRemoved": "Se quitan siempre al limpiar.",
  "xray.kind.versions": "Versiones anteriores",
  "xray.kind.hiddenText": "Texto invisible",
  "xray.kind.attachments": "Archivos adjuntos",
  "xray.kind.javascript": "JavaScript y acciones",
  "xray.kind.metadata": "Metadatos",
  "xray.kind.whiteText": "Texto blanco",
  "xray.kind.authors": "Nombres en comentarios",
  "xray.kind.hiddenLayers": "Capas ocultas",
  "xray.kind.thumbnails": "Miniaturas incrustadas",
  "xray.kind.pieceInfo": "Datos de programas de edición",
  "xray.kind.links": "Enlaces a webs",
  "xray.kind.ocrText": "Texto reconocido (OCR)",
  "xray.kind.signatures": "Firmas digitales",
  "xray.about.versions":
    "El archivo conserva versiones anteriores del documento: cualquiera puede recuperar lo que decía antes.",
  "xray.about.hiddenText":
    "Texto que está en el archivo pero no se ve: invisible, fuera de la hoja o diminuto. Se puede copiar y buscar.",
  "xray.about.attachments": "Archivos metidos dentro del PDF.",
  "xray.about.javascript":
    "Código o acciones que se ejecutan al abrir o al pulsar: pueden abrir programas o enviar datos.",
  "xray.about.metadata": "Autor, programas, fechas y otros datos del archivo.",
  "xray.about.whiteText":
    "Texto blanco, que no se ve sobre el papel. Puede ser legítimo sobre un fondo oscuro: revísalo.",
  "xray.about.authors":
    "Los comentarios guardan el nombre de quien los escribió. Al limpiar se quedan los comentarios, sin los nombres.",
  "xray.about.hiddenLayers":
    "Contenido en capas que el visor no muestra, pero que sigue en el archivo.",
  "xray.about.thumbnails":
    "Imágenes pequeñas de las páginas guardadas aparte; pueden mostrar una versión anterior.",
  "xray.about.pieceInfo":
    "Información privada que dejan programas como Illustrator o Photoshop; a veces, el documento original entero.",
  "xray.about.links":
    "Enlaces a sitios externos. Normalmente son intencionados.",
  "xray.about.ocrText":
    "Texto invisible sobre una imagen escaneada, para poder buscar y copiar. Es normal.",
  "xray.about.signatures":
    "El PDF está firmado digitalmente. Al limpiarlo, la firma deja de ser válida.",
  "xray.version": (n: string, size: string) => `Versión ${n} (${size})`,
  "xray.loose": (n: number) =>
    n === 1
      ? "1 objeto sin usar de ediciones anteriores"
      : `${n} objetos sin usar de ediciones anteriores`,
  "xray.downloadVersion": "Descargar",
  "xray.versionSuffix": (n: string) => `versión anterior ${n}`,
  "xray.meta.Title": "Título",
  "xray.meta.Author": "Autor",
  "xray.meta.Subject": "Asunto",
  "xray.meta.Keywords": "Palabras clave",
  "xray.meta.Creator": "Programa de creación",
  "xray.meta.Producer": "Programa de PDF",
  "xray.meta.CreationDate": "Creado",
  "xray.meta.ModDate": "Modificado",
  "xray.meta.XMP": (size: string) => `Metadatos XMP (${size})`,
  "xray.meta.XMPParts": (n: number) =>
    n === 1
      ? "Metadatos XMP en 1 imagen o parte"
      : `Metadatos XMP en ${n} imágenes o partes`,
  "xray.text.hidden": "invisible",
  "xray.text.outside": "fuera de la hoja",
  "xray.text.tiny": "diminuto",
  "xray.page": (n: number) => `Página ${n}`,
  "xray.js.document": "En el documento",
  "xray.js.page": "En una página",
  "xray.js.field": "En un campo",
  "xray.js.annot": "En una anotación",
  "xray.js.xfa": "Formulario XFA (puede llevar scripts)",
  "xray.js.Launch": "Abre un programa o archivo",
  "xray.js.SubmitForm": "Envía el formulario a una dirección",
  "xray.js.ImportData": "Importa datos de un archivo",
  "xray.js.GoToR": "Abre otro PDF",
  "xray.js.GoToE": "Abre un PDF adjunto",
  "xray.js.Rendition": "Reproduce contenido multimedia",
  "xray.times": (n: number) => (n === 1 ? "1 vez" : `${n} veces`),
  "xray.comments": (n: number) =>
    n === 1 ? "1 comentario" : `${n} comentarios`,
  "xray.noName": "(sin nombre)",
  "xray.clean": "Limpiar",
  "xray.cleaning": "Limpiando…",
  "xray.nothingChecked": "Marca al menos una cosa para quitar.",
  "xray.cleaned":
    "Limpio. Así queda el documento; guárdalo con «Guardar PDF» cuando termines:",
};
