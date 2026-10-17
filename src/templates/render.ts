// Renders a template's layout to PDF bytes (spec 021), with the app's bundled
// open fonts embedded as subsets: the text is real, selectable text.
import {
  PDFDocument,
  beginText,
  clip,
  endPath,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  setFillingRgbColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type PDFImage,
  type PDFName,
  type PDFPage,
} from "pdf-lib";
import { hexToRgb, parseHexColor } from "../engine/color";
import type { LoadFont, SubstituteFamily } from "../engine/fonts";
import { SubstituteFont } from "../engine/substituteFont";
import {
  layout,
  type Block,
  type DocSpec,
  type Role,
  type Variant,
} from "./layout";
import { PAPER, type FontPair, type Photo, type Style } from "./types";

export const FAMILIES: Record<FontPair, Record<Role, SubstituteFamily>> = {
  modern: { heading: "Arimo", body: "Arimo" },
  classic: { heading: "Tinos", body: "Tinos" },
  elegant: { heading: "Caladea", body: "Carlito" },
};

const faceKey = (role: Role, variant: Variant) => `${role}:${variant}`;

/** Every (role, variant) the blocks use, so only those fonts are loaded. */
export function facesOf(blocks: Block[]): Set<string> {
  const faces = new Set<string>([faceKey("body", "Regular")]);
  const visit = (list: Block[]) => {
    for (const b of list) {
      if (b.type === "text")
        faces.add(faceKey(b.role ?? "body", b.variant ?? "Regular"));
      else if (b.type === "table") faces.add(faceKey("body", "Bold"));
      else if (b.type === "row") b.cells.forEach((c) => visit(c.blocks));
      else if (b.type === "group" || b.type === "box") visit(b.blocks);
    }
  };
  visit(blocks);
  return faces;
}

/**
 * Text the font can draw: every kind of space becomes a plain space (some
 * fonts break on U+00A0 or U+202F, which Intl uses in amounts), and characters
 * the font lacks become "?".
 */
export const printable = (font: SubstituteFont, text: string) =>
  [
    ...text
      .replace(/\p{Zs}/gu, " ")
      .replace(/\p{Extended_Pictographic}\uFE0F?/gu, "?"),
  ]
    .map((ch) => (font.covers(ch) ? ch : /\s/.test(ch) ? " " : "?"))
    .join("");

export async function renderTemplate(
  spec: DocSpec,
  style: Style,
  images: Record<string, Photo>,
  loadFont: LoadFont,
): Promise<Uint8Array> {
  // Our own metadata: pdf-lib would otherwise name itself as the producer.
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(spec.title, { showInWindowTitleBar: true });
  doc.setProducer("InkognitoPDF");
  doc.setCreator("InkognitoPDF");
  doc.setCreationDate(new Date());

  // One font per family and variant, shared by roles that use the same family.
  const families = FAMILIES[style.fonts];
  const blocks = [...spec.blocks, ...(spec.sidebar?.blocks ?? [])];
  const byFile = new Map<string, Promise<SubstituteFont>>();
  const fonts = new Map<string, SubstituteFont>();
  await Promise.all(
    [...facesOf(blocks)].map(async (key) => {
      const [role, variant] = key.split(":") as [Role, Variant];
      const family = families[role];
      const file = `${family}-${variant}`;
      if (!byFile.has(file))
        byFile.set(
          file,
          loadFont(family, variant).then(
            (bytes) => new SubstituteFont(doc, family, variant, bytes),
          ),
        );
      fonts.set(key, await byFile.get(file)!);
    }),
  );
  const fontFor = (role: Role, variant: Variant) =>
    fonts.get(faceKey(role, variant)) ?? fonts.get(faceKey("body", "Regular"))!;

  const laid = layout(spec, PAPER[style.paper], {
    width: (text, role, variant, size) => {
      const font = fontFor(role, variant);
      return font.widthOf(printable(font, text)) * size;
    },
    ascent: (role, variant) => fontFor(role, variant).ascent,
  });

  const embedded = new Map<string, PDFImage>();
  for (const [key, photo] of Object.entries(images))
    embedded.set(
      key,
      photo.kind === "png"
        ? await doc.embedPng(photo.bytes)
        : await doc.embedJpg(photo.bytes),
    );

  const [width, height] = PAPER[style.paper];
  for (const ops of laid.pages) {
    const page = doc.addPage([width, height]);
    const names = new Map<SubstituteFont, PDFName>();
    const fontName = (font: SubstituteFont) => {
      let name = names.get(font);
      if (!name) {
        name = page.node.newFontDictionary(`F${names.size + 1}`, font.ref);
        names.set(font, name);
      }
      return name;
    };
    for (const op of ops) {
      if (op.kind === "rect") {
        page.drawRectangle({
          x: op.x,
          y: height - op.y - op.h,
          width: op.w,
          height: op.h,
          color: op.fill ? hexToRgb(op.fill) : undefined,
          borderColor: op.stroke ? hexToRgb(op.stroke) : undefined,
          borderWidth: op.stroke ? 0.8 : 0,
        });
      } else if (op.kind === "line") {
        page.drawLine({
          start: { x: op.x1, y: height - op.y1 },
          end: { x: op.x2, y: height - op.y2 },
          thickness: op.width,
          color: hexToRgb(op.color),
        });
      } else if (op.kind === "image") {
        const image = embedded.get(op.image);
        if (image)
          drawCover(page, image, op.x, height - op.y - op.h, op.w, op.h);
      } else {
        const font = fontFor(op.role, op.variant);
        page.pushOperators(
          beginText(),
          setFillingRgbColor(...parseHexColor(op.color)),
          setFontAndSize(fontName(font), op.size),
          setTextMatrix(1, 0, 0, 1, op.x, height - op.y),
          showText(font.encode(printable(font, op.text))),
          endText(),
        );
      }
    }
  }
  for (const font of new Set(fonts.values())) font.embed(doc);
  return doc.save({ useObjectStreams: true });
}

/** The image fills the box, cropped to it, keeping its proportions. */
function drawCover(
  page: PDFPage,
  image: PDFImage,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.max(w / image.width, h / image.height);
  const iw = image.width * scale;
  const ih = image.height * scale;
  page.pushOperators(
    pushGraphicsState(),
    rectangle(x, y, w, h),
    clip(),
    endPath(),
  );
  page.drawImage(image, {
    x: x - (iw - w) / 2,
    y: y - (ih - h) / 2,
    width: iw,
    height: ih,
  });
  page.pushOperators(popGraphicsState());
}
