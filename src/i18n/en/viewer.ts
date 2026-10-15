// English messages: document viewer (pages, thumbnails, zoom).
import type { viewer as es } from "../es/viewer";

export const viewer: typeof es = {
  "viewer.page": (n: number) => `Page ${n}`,
  "viewer.renderError": (error: string) =>
    `Could not display the page: ${error}`,
  "viewer.goToPage": (n: number) => `Go to page ${n}`,
  "viewer.toolbar": "Tools",
  "viewer.zoomOut": "Zoom out",
  "viewer.zoom": "Zoom",
  "viewer.zoomIn": "Zoom in",
  "viewer.zoomValue": (percent: number) => `${percent}%`,
  "viewer.fitWidth": "Fit width",
  "viewer.pageOf": (page: number, total: number) => `Page ${page} of ${total}`,
  "viewer.thumbnails": "Thumbnails",
};
