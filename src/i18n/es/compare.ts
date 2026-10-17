// Spanish messages: comparing two versions of a PDF (spec 018).
export const compare = {
  "compare.button": "Comparar",
  "compare.hint":
    "Comparar con otra versión del PDF: cambios de texto y diferencias visuales",
  "compare.title": "Comparar versiones",
  "compare.loading": "Comparando…",
  "compare.failed": (reason: string) =>
    `No se pudieron comparar los documentos: ${reason}`,
  "compare.before": "Antes",
  "compare.after": "Ahora",
  "compare.swap": "Intercambiar",
  "compare.swapHint": "Cambiar cuál es la versión anterior",
  "compare.report": "Descargar informe",
  "compare.close": "Cerrar comparación",
  "compare.same": "El texto es igual en las dos versiones.",
  "compare.summary": (changes: number, pages: number) =>
    `${changes === 1 ? "1 cambio" : `${changes} cambios`} de texto en ${
      pages === 1 ? "1 página" : `${pages} páginas`
    }.`,
  "compare.tooMany":
    "Los documentos son demasiado distintos para listar los cambios de texto; mira las diferencias visuales.",
  "compare.pagesGone": (n: number) =>
    n === 1
      ? "1 página de antes ya no está."
      : `${n} páginas de antes ya no están.`,
  "compare.page": (n: number, total: number) => `Página ${n} de ${total}`,
  "compare.prev": "Página anterior",
  "compare.next": "Página siguiente",
  "compare.visual": "Diferencias visuales",
  "compare.side": (side: string, page: number) => `${side} · pág. ${page}`,
  "compare.noPage": "Página nueva: no está en la versión anterior.",
  "compare.visualShare": (percent: string) =>
    `Cambia el ${percent} % de la página.`,
  "compare.visualSame": "Sin diferencias visuales.",
  "compare.visualSize": "Las páginas tienen distinto tamaño.",
  "compare.changes": "Cambios de texto",
  "compare.changePage": (n: number) => `Pág. ${n}`,
  "compare.replaced": (before: string, after: string) =>
    `«${before}» → «${after}»`,
  "compare.addedText": (text: string) => `Añadido: «${text}»`,
  "compare.removedText": (text: string) => `Quitado: «${text}»`,
  "compare.more": (n: number) => `Y ${n} cambios más (en el informe).`,
  "compare.removed": "Quitado",
  "compare.added": "Añadido",
  "compare.local": "La comparación se hace en tu dispositivo; nada se sube.",
  "compare.reportSuffix": "comparación",
  "compare.reportTitle": "Informe de comparación",
  "compare.reportBefore": (name: string) => `Antes: ${name}`,
  "compare.reportAfter": (name: string) => `Ahora: ${name}`,
  "compare.reportDate": (date: string) => `Fecha: ${date}`,
  "compare.reportVisual": "Páginas con diferencias visuales",
  "compare.reportVisualPage": (page: number, percent: string) =>
    `Pág. ${page}: cambia el ${percent} %`,
  "compare.reportNoVisual": "Ninguna.",
  "compare.reportPage": (n: number) => `Página ${n}`,
};
