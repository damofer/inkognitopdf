// Spanish messages: document viewer (pages, thumbnails, zoom).
export const viewer = {
  "viewer.page": (n: number) => `Página ${n}`,
  "viewer.renderError": (error: string) =>
    `No se pudo mostrar la página: ${error}`,
  "viewer.goToPage": (n: number) => `Ir a la página ${n}`,
  "viewer.toolbar": "Herramientas",
  "viewer.zoomOut": "Alejar",
  "viewer.zoom": "Zoom",
  "viewer.zoomIn": "Acercar",
  "viewer.zoomValue": (percent: number) => `${percent} %`,
  "viewer.fitWidth": "Ajustar al ancho",
  "viewer.pageOf": (page: number, total: number) =>
    `Página ${page} de ${total}`,
  "viewer.thumbnails": "Miniaturas",
};
