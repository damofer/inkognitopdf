/**
 * PDF appearance of a signature (spec 004): a Form XObject with the drawing,
 * the typed text or the image, placed on a page (flattened) or used as the
 * appearance of a signature widget or a stamp annotation.
 */
import { type PDFDocument, type PDFPage, type PDFRef } from "pdf-lib";
import type { Rect } from "../model/geometry";
import type { SignatureAsset } from "../model/signature";
import { parseHexColor } from "./color";
import type { FontCache } from "./fonts";

const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
};

const rgb = (hex: string) =>
  parseHexColor(hex)
    .map((c) => n(c))
    .join(" ");

/** Font size of typed signatures inside their XObject. */
const TYPED_SIZE = 100;

export interface SignatureXObject {
  ref: PDFRef;
  width: number;
  height: number;
}

/** Registers the asset as a Form XObject; its BBox is [0 0 width height]. */
export async function signatureXObject(
  doc: PDFDocument,
  asset: SignatureAsset,
  fonts: FontCache,
): Promise<SignatureXObject> {
  const { context } = doc;
  let width: number;
  let height: number;
  let content: string;
  const resources: Record<string, Record<string, PDFRef>> = {};

  if (asset.kind === "drawn") {
    width = Math.max(asset.width, 1);
    height = Math.max(asset.height, 1);
    const ops = [`${rgb(asset.color)} RG 1 J 1 j`];
    for (const stroke of asset.strokes) {
      if (stroke.length === 1) {
        // A dot: a zero-length segment with round caps.
        const p = stroke[0]!;
        ops.push(
          `${n(p.w)} w ${n(p.x)} ${n(height - p.y)} m ${n(p.x)} ${n(height - p.y)} l S`,
        );
        continue;
      }
      for (let i = 1; i < stroke.length; i++) {
        const a = stroke[i - 1]!;
        const b = stroke[i]!;
        ops.push(
          `${n((a.w + b.w) / 2)} w ${n(a.x)} ${n(height - a.y)} m ${n(b.x)} ${n(height - b.y)} l S`,
        );
      }
    }
    content = ops.join("\n");
  } else if (asset.kind === "typed") {
    const font = await fonts.substitute(asset.font, "Regular");
    const text = font.encode(asset.text);
    width = Math.max(font.widthOf(asset.text) * TYPED_SIZE, 1);
    height = (font.ascent - font.descent) * TYPED_SIZE;
    resources.Font = { F1: font.ref };
    content = [
      "BT",
      `${rgb(asset.color)} rg`,
      `/F1 ${TYPED_SIZE} Tf`,
      `1 0 0 1 0 ${n(-font.descent * TYPED_SIZE)} Tm`,
      `${text.toString()} Tj`,
      "ET",
    ].join("\n");
  } else {
    const image = await doc.embedPng(asset.png);
    width = asset.width;
    height = asset.height;
    resources.XObject = { Im1: image.ref };
    content = `q ${n(width)} 0 0 ${n(height)} 0 0 cm /Im1 Do Q`;
  }

  const stream = context.flateStream(new TextEncoder().encode(content), {
    Type: "XObject",
    Subtype: "Form",
    BBox: [0, 0, width, height],
    Resources: context.obj(resources),
  });
  return { ref: context.register(stream), width, height };
}

/**
 * The `cm` matrix that maps the XObject's box onto `rect`, turned by `rotate`
 * degrees counter-clockwise (so it reads upright on rotated pages).
 */
export function placement(
  xobject: { width: number; height: number },
  rect: Rect,
  rotate: 0 | 90 | 180 | 270,
): [number, number, number, number, number, number] {
  const { x, y, width: W, height: H } = rect;
  const frames: Record<number, [number, number][]> = {
    0: [
      [x, y],
      [W, 0],
      [0, H],
    ],
    90: [
      [x + W, y],
      [0, H],
      [-W, 0],
    ],
    180: [
      [x + W, y + H],
      [-W, 0],
      [0, -H],
    ],
    270: [
      [x, y + H],
      [0, -H],
      [W, 0],
    ],
  };
  const [o, u, v] = frames[rotate] as [
    [number, number],
    [number, number],
    [number, number],
  ];
  return [
    u[0] / xobject.width,
    u[1] / xobject.width,
    v[0] / xobject.height,
    v[1] / xobject.height,
    o[0],
    o[1],
  ];
}

/** Content that draws `xobject` (named `name`) over `rect`. */
export function placeOperators(
  name: string,
  xobject: SignatureXObject,
  rect: Rect,
  rotate: 0 | 90 | 180 | 270,
): string {
  return `q ${placement(xobject, rect, rotate).map(n).join(" ")} cm /${name} Do Q`;
}

/** Flattens a signature into the page content (spec 004, HU4). */
export async function drawSignature(
  doc: PDFDocument,
  page: PDFPage,
  item: { asset: SignatureAsset; rect: Rect; rotate: 0 | 90 | 180 | 270 },
  fonts: FontCache,
): Promise<void> {
  const xobject = await signatureXObject(doc, item.asset, fonts);
  const name = page.node.newXObject("Sig", xobject.ref);
  const content = doc.context.register(
    doc.context.flateStream(
      new TextEncoder().encode(
        placeOperators(
          name.asString().slice(1),
          xobject,
          item.rect,
          item.rotate,
        ),
      ),
    ),
  );
  page.node.addContentStream(content);
}
