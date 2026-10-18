// Spec 032: fonts for measuring while the user writes, loaded once per
// session. They are never embedded: the PDF loads its own (render.ts).
import { PDFDocument } from "pdf-lib";
import type { FontVariant } from "../engine/fonts";
import { SubstituteFont } from "../engine/substituteFont";
import { cachedFont } from "../templates/ui/preview";
import { FaceSet } from "./render";
import type { WriterFamily } from "./schema";

let scratch: Promise<PDFDocument> | null = null;
const loaded = new Map<string, Promise<SubstituteFont>>();

/** Fonts for the "Family-Variant" keys, ready to measure text. */
export async function measuringFaces(keys: Iterable<string>): Promise<FaceSet> {
  scratch ??= PDFDocument.create();
  const doc = await scratch;
  const fonts = new Map<string, SubstituteFont>();
  await Promise.all(
    [...keys].map(async (key) => {
      let font = loaded.get(key);
      if (!font) {
        const [family, variant] = key.split("-") as [WriterFamily, FontVariant];
        font = cachedFont(family, variant).then(
          (bytes) => new SubstituteFont(doc, family, variant, bytes),
        );
        font.catch(() => loaded.delete(key));
        loaded.set(key, font);
      }
      fonts.set(key, await font);
    }),
  );
  return new FaceSet(fonts);
}
