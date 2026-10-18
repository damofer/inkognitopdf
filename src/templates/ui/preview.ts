// Pictures of a generated template (spec 021, CA4): the live preview and the
// gallery thumbnails, drawn by pdf.js from the PDF itself.
import { loadFont } from "../../editor/loadFont";
import type { LoadFont } from "../../engine/fonts";
import type { Lang } from "../../i18n";
import { loadDocumentBytes } from "../../viewer/pdfjs";
import { emptyDraft, effectiveValues, generate } from "../engine";
import { defaultPaper } from "../format";
import { ACCENTS, type Style, type Template } from "../types";

/** Fonts are fetched once per session: every keystroke regenerates the PDF. */
const fonts = new Map<string, Promise<Uint8Array>>();
export const cachedFont: LoadFont = (family, variant) => {
  const key = `${family}-${variant}`;
  let bytes = fonts.get(key);
  if (!bytes) {
    bytes = loadFont(family, variant);
    bytes.catch(() => fonts.delete(key));
    fonts.set(key, bytes);
  }
  return bytes;
};

export const defaultStyle = (): Style => ({
  accent: ACCENTS[0],
  fonts: "modern",
  paper: defaultPaper(),
});

/** Each page as an image `width` pixels wide (object URLs: revoke them). */
export async function renderPages(
  bytes: Uint8Array,
  width: number,
  maxPages = Infinity,
): Promise<string[]> {
  // pdf.js takes over the buffer it is given.
  const doc = await loadDocumentBytes(bytes.slice());
  try {
    const urls: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({
        scale: width / page.getViewport({ scale: 1 }).width,
      });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      if (blob) urls.push(URL.createObjectURL(blob));
    }
    return urls;
  } finally {
    void doc.loadingTask.destroy();
  }
}

/** The first page of a template's sample, kept for the session. */
const thumbs = new Map<string, Promise<string>>();
export function thumbnail(template: Template, lang: Lang): Promise<string> {
  const key = `${template.id}:${lang}`;
  let url = thumbs.get(key);
  if (!url) {
    url = generate(
      template,
      effectiveValues(template, emptyDraft(), lang),
      lang,
      defaultStyle(),
      null,
      cachedFont,
    )
      .then(({ bytes }) => renderPages(bytes, 360, 1))
      .then(([first]) => first ?? "");
    url.catch(() => thumbs.delete(key));
    thumbs.set(key, url);
  }
  return url;
}
