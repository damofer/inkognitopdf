// Generates the synthetic PDF fixtures used by unit and e2e tests (spec 001, T003).
// Every fixture is created here from scratch; none comes from a third-party product.
// Usage: npm run fixtures
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  PDFOperator,
  PDFName,
  PDFOperatorNames,
  PDFString,
  StandardFonts,
  beginText,
  degrees,
  endText,
  moveText,
  rgb,
  setFontAndSize,
} from "pdf-lib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "tests", "fixtures");
const require = createRequire(import.meta.url);
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");
const A4 = [595.28, 841.89];

async function newDoc(title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("pdfcraft fixtures");
  doc.setCreator("pdfcraft fixtures");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  return doc;
}

async function save(doc, name) {
  const bytes = await doc.save({ useObjectStreams: false });
  await writeFile(join(out, name), bytes);
  return { name, bytes: bytes.length, pages: doc.getPageCount() };
}

/** One page with a heading and a paragraph. */
async function simpleText() {
  const doc = await newDoc("Texto simple");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(A4);
  page.drawText("Documento de prueba pdfcraft", {
    x: 56,
    y: 770,
    size: 20,
    font: bold,
  });
  page.drawText("El rapido zorro marron salta sobre el perro perezoso.", {
    x: 56,
    y: 730,
    size: 12,
    font,
  });
  return save(doc, "simple-text.pdf");
}

/** A 3x4 table drawn with lines and text cells. */
async function table() {
  const doc = await newDoc("Tabla");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(A4);
  const rows = [
    ["Campo", "Valor", "Nota"],
    ["Nombre", "Ejemplo Uno", "-"],
    ["Fecha", "2026-01-01", "ISO 8601"],
    ["Importe", "100,00", "EUR"],
  ];
  const x0 = 56;
  const y0 = 760;
  const cellW = 160;
  const cellH = 24;
  rows.forEach((row, r) =>
    row.forEach((text, c) => {
      const x = x0 + c * cellW;
      const y = y0 - r * cellH;
      page.drawRectangle({
        x,
        y: y - cellH,
        width: cellW,
        height: cellH,
        borderColor: rgb(0.3, 0.3, 0.3),
        borderWidth: 1,
      });
      page.drawText(text, { x: x + 6, y: y - 16, size: 11, font });
    }),
  );
  return save(doc, "table.pdf");
}

/** Two pages with distinct text to test page navigation and page operations. */
async function twoPages() {
  const doc = await newDoc("Dos paginas");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const n of [1, 2]) {
    const page = doc.addPage(A4);
    page.drawText(`Pagina ${n} de 2`, { x: 56, y: 770, size: 18, font });
  }
  return save(doc, "two-pages.pdf");
}

/** A landscape-rotated page (/Rotate 90) followed by a normal page. */
async function rotatedPage() {
  const doc = await newDoc("Pagina rotada");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const rotated = doc.addPage(A4);
  rotated.setRotation(degrees(90));
  rotated.drawText("Pagina con /Rotate 90", { x: 56, y: 770, size: 18, font });
  const normal = doc.addPage(A4);
  normal.drawText("Pagina sin rotar", { x: 56, y: 770, size: 18, font });
  return save(doc, "rotated-page.pdf");
}

/** Text drawn with an embedded, subsetted TrueType font (Liberation Sans, SIL OFL 1.1). */
async function subsetFont() {
  const doc = await newDoc("Fuente subconjunto");
  doc.registerFontkit(fontkit);
  const fontPath = join(
    dirname(require.resolve("pdfjs-dist/package.json")),
    "standard_fonts",
    "LiberationSans-Regular.ttf",
  );
  const font = await doc.embedFont(await readFile(fontPath), { subset: true });
  const page = doc.addPage(A4);
  page.drawText("Fuente incrustada como subconjunto: abc", {
    x: 56,
    y: 770,
    size: 16,
    font,
  });
  return save(doc, "subset-font.pdf");
}

/** A TJ operator with kerning adjustments between text runs. */
async function tjKerning() {
  const doc = await newDoc("TJ con kerning");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(A4);
  const key = page.node.newFontDictionary("F1", font.ref);
  const runs = doc.context.obj([
    font.encodeText("K"),
    30,
    font.encodeText("erning"),
    -15,
    font.encodeText(" TJ"),
  ]);
  page.pushOperators(
    beginText(),
    setFontAndSize(key, 18),
    moveText(56, 770),
    PDFOperator.of(PDFOperatorNames.ShowTextAdjusted, [runs]),
    endText(),
  );
  return save(doc, "tj-kerning.pdf");
}

/** Text operators the text-edit engine must handle: split text, ', Tc, colors and rotated matrices. */
async function textOperators() {
  const doc = await newDoc("Operadores de texto");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage(A4);
  const f = page.node.newFontDictionary("F1", font.ref);
  const content = [
    `BT ${f} 12 Tf 56 760 Td (Texto ) Tj (dividido) Tj ( en partes) Tj ET`,
    `BT ${f} 12 Tf 14 TL 56 720 Td (Primera linea) Tj (Segunda linea) ' (Tercera linea) ' ET`,
    `q 2 0 0 2 0 0 cm BT ${f} 9 Tf 0.7071 0.7071 -0.7071 0.7071 100 200 Tm (Texto girado) Tj ET Q`,
    `BT 0.8 0 0 rg ${f} 12 Tf 56 600 Td 3 Tc (Espaciado rojo) Tj ET`,
  ].join(String.fromCharCode(10));
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(doc.context.stream(content)),
  );
  return save(doc, "text-operators.pdf");
}

/** A Type3 font whose glyphs are drawn with rectangles (no font program). */
async function type3Font() {
  const doc = await newDoc("Fuente Type3");
  const page = doc.addPage(A4);
  const glyph = (ops) => doc.context.register(doc.context.stream(ops));
  const font = doc.context.obj({
    Type: "Font",
    Subtype: "Type3",
    FontBBox: [0, 0, 600, 700],
    FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    FirstChar: 65,
    LastChar: 67,
    Widths: [600, 600, 600],
    Encoding: doc.context.obj({
      Type: "Encoding",
      Differences: [65, "A", "B", "C"],
    }),
    CharProcs: doc.context.obj({
      A: glyph("600 0 0 0 500 700 d1 0 0 500 700 re f"),
      B: glyph("600 0 0 0 500 700 d1 0 0 500 300 re f 0 400 500 300 re f"),
      C: glyph(
        "600 0 0 0 500 700 d1 0 0 100 700 re f 0 0 500 100 re f 0 600 500 100 re f",
      ),
    }),
    Resources: doc.context.obj({}),
  });
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const t3 = page.node.newFontDictionary("T3", doc.context.register(font));
  const f = page.node.newFontDictionary("F1", helvetica.ref);
  const content = [
    `BT ${t3} 24 Tf 56 700 Td (ABCCBA) Tj ET`,
    `BT ${f} 12 Tf 56 660 Td (Texto normal debajo) Tj ET`,
  ].join(String.fromCharCode(10));
  page.node.set(
    PDFName.of("Contents"),
    doc.context.register(doc.context.stream(content)),
  );
  return save(doc, "type3-font.pdf");
}

/** 200 pages, the upper bound of spec 001 CA1. */
/**
 * Text inside Form XObjects: a shared "card" form drawn twice on page 1 and
 * once on page 2, a form nested in it, a rotated form that inherits the page
 * resources, CMYK text, and an AcroForm text field.
 */
async function formXObjects() {
  const doc = await newDoc("Texto en Form XObjects");
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const nl = String.fromCharCode(10);
  const fonts = () => doc.context.obj({ F1: helvetica.ref });
  const form = (content, extra) =>
    doc.context.register(
      doc.context.stream(content.join(nl), {
        Type: "XObject",
        Subtype: "Form",
        BBox: [0, 0, 300, 80],
        ...extra,
      }),
    );
  const inner = form(
    ["0.1 0.9 0.8 0.05 k", "BT /F1 11 Tf 0 0 Td (Texto anidado) Tj ET"],
    { Resources: doc.context.obj({ Font: fonts() }) },
  );
  const card = form(
    [
      "0 0.4 0 rg",
      "BT /F1 14 Tf 10 40 Td (Tarjeta compartida) Tj ET",
      "q 1 0 0 1 10 12 cm /Inner Do Q",
    ],
    {
      Resources: doc.context.obj({
        Font: fonts(),
        XObject: doc.context.obj({ Inner: inner }),
      }),
    },
  );
  const cos = Math.cos(Math.PI / 6);
  const sin = Math.sin(Math.PI / 6);
  // No /Resources: the form uses the resources of the page that draws it.
  const rotated = form(["BT /F1 12 Tf 0 0 Td (Formulario girado) Tj ET"], {
    Matrix: [cos, sin, -sin, cos, 0, 0],
  });

  const page1 = doc.addPage(A4);
  const page2 = doc.addPage(A4);
  for (const [page, content] of [
    [
      page1,
      [
        "q 1 0 0 1 56 700 cm /Card Do Q",
        "q 1 0 0 1 56 600 cm /Card Do Q",
        "q 1 0 0 1 300 420 cm /Rot Do Q",
        "BT /F1 12 Tf 56 500 Td (Texto de la pagina) Tj ET",
      ],
    ],
    [page2, ["q 1 0 0 1 56 700 cm /Card Do Q"]],
  ]) {
    page.node.set(
      PDFName.of("Resources"),
      doc.context.obj({
        Font: fonts(),
        XObject: doc.context.obj({ Card: card, Rot: rotated }),
      }),
    );
    page.node.set(
      PDFName.of("Contents"),
      doc.context.register(doc.context.stream(content.join(nl))),
    );
  }
  const field = doc.getForm().createTextField("nombre");
  field.setText("Campo de formulario");
  field.addToPage(page1, { x: 56, y: 420, width: 200, height: 24 });
  return save(doc, "form-xobjects.pdf");
}

/**
 * Page 1: an AcroForm with one field of each kind, text fields with their own
 * font, size and color in /DA. Page 2: lines of text and existing annotations
 * with appearances (spec 005).
 */
async function formsAnnotations() {
  const doc = await newDoc("Formularios y anotaciones");
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const courier = await doc.embedFont(StandardFonts.Courier);

  const p1 = doc.addPage(A4);
  p1.drawText("Formulario de prueba", { x: 56, y: 780, size: 18, font: helv });
  const label = (text, y) =>
    p1.drawText(text, { x: 56, y, size: 11, font: helv });
  const form = doc.getForm();
  const text = (name, y, height, width, font, da) => {
    const field = form.createTextField(name);
    field.addToPage(p1, { x: 220, y, width, height, font });
    field.acroField.setDefaultAppearance(da);
    return field;
  };
  label("Nombre:", 720);
  const name = text(
    "nombre",
    712,
    24,
    250,
    times,
    "/TiRo 14 Tf 0.8 0.1 0.1 rg",
  );
  name.setText("Valor inicial");
  label("Codigo:", 680);
  const code = text("codigo", 672, 20, 150, courier, "/Cour 9 Tf 0 0 0.7 rg");
  label("Automatico:", 640);
  text("auto", 632, 20, 200, helv, "/Helv 0 Tf 0 0.5 0 rg");
  label("Comentarios:", 600);
  const notes = text("comentarios", 530, 70, 300, helv, "/Helv 10 Tf 0 g");
  notes.enableMultiline();
  label("Acepto:", 500);
  form
    .createCheckBox("acepto")
    .addToPage(p1, { x: 220, y: 495, width: 16, height: 16 });
  label("Talla:", 465);
  const size = form.createRadioGroup("talla");
  for (const [i, option] of ["S", "M", "L"].entries())
    size.addOptionToPage(option, p1, {
      x: 220 + i * 40,
      y: 460,
      width: 14,
      height: 14,
    });
  label("Pais:", 425);
  const country = form.createDropdown("pais");
  country.addOptions(["Colombia", "Mexico", "Peru"]);
  country.addToPage(p1, { x: 220, y: 418, width: 150, height: 20, font: helv });
  label("Colores:", 385);
  const colors = form.createOptionList("colores");
  colors.addOptions(["Rojo", "Verde", "Azul"]);
  colors.addToPage(p1, { x: 220, y: 330, width: 120, height: 55, font: helv });
  form.updateFieldAppearances(helv);
  name.updateAppearances(times);
  code.updateAppearances(courier);

  const p2 = doc.addPage(A4);
  const lines = [
    "Primera linea para resaltar.",
    "Segunda linea para subrayar.",
    "Tercera linea para tachar.",
    "Cuarta linea ya resaltada.",
    "Quinta linea con una nota al margen.",
  ];
  lines.forEach((t, i) =>
    p2.drawText(t, { x: 56, y: 760 - i * 30, size: 12, font: helv }),
  );

  const ctx = doc.context;
  const annots = [];
  const add = (dict, ops) => {
    const [x0, y0, x1, y1] = dict.Rect;
    const ap = ctx.stream(ops, {
      Type: "XObject",
      Subtype: "Form",
      BBox: [x0, y0, x1, y1],
      Resources: {
        Font: { Helv: helv.ref },
        ExtGState: { G: { BM: "Multiply" } },
      },
    });
    const ref = ctx.register(
      ctx.obj({
        Type: "Annot",
        F: 4,
        P: p2.ref,
        AP: { N: ctx.register(ap) },
        ...dict,
      }),
    );
    annots.push(ref);
    return ref;
  };
  const author = PDFString.of("Generador");
  const created = PDFString.of("D:20260101000000Z");
  const hx1 = 56 + helv.widthOfTextAtSize(lines[3], 12);
  add(
    {
      Subtype: "Highlight",
      Rect: [56, 667, hx1, 682],
      QuadPoints: [56, 682, hx1, 682, 56, 667, hx1, 667],
      C: [1, 0.9, 0],
      T: author,
      CreationDate: created,
      Contents: PDFString.of("resaltado existente"),
    },
    `/G gs 1 0.9 0 rg 56 667 ${hx1 - 56} 15 re f`,
  );
  const note = add(
    {
      Subtype: "Text",
      Rect: [520, 636, 540, 656],
      C: [1, 0.8, 0],
      Name: "Comment",
      T: author,
      CreationDate: created,
      Contents: PDFString.of("nota existente"),
    },
    "1 0.8 0 rg 0 G 0.5 w 521 637 18 18 re b",
  );
  const popup = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Popup",
      Rect: [540, 560, 590, 656],
      Parent: note,
      Open: false,
      P: p2.ref,
    }),
  );
  ctx.lookup(note).set(PDFName.of("Popup"), popup);
  annots.push(popup);
  add(
    {
      Subtype: "FreeText",
      Rect: [56, 540, 300, 580],
      DA: PDFString.of("/Helv 12 Tf 0 0 1 rg"),
      Contents: PDFString.of("texto libre existente"),
      T: author,
    },
    "0 0 1 RG 1 w 56.5 540.5 243 39 re S BT /Helv 12 Tf 0 0 1 rg 62 556 Td (texto libre existente) Tj ET",
  );
  add(
    {
      Subtype: "Ink",
      Rect: [320, 520, 520, 600],
      C: [0.9, 0, 0],
      InkList: [[330, 530, 380, 590, 430, 540, 480, 590, 510, 530]],
      BS: { W: 2 },
      T: author,
    },
    "0.9 0 0 RG 2 w 1 J 1 j 330 530 m 380 590 l 430 540 l 480 590 l 510 530 l S",
  );
  add(
    {
      Subtype: "Square",
      Rect: [56, 420, 200, 500],
      C: [0, 0.5, 0],
      BS: { W: 2 },
      T: author,
    },
    "0 0.5 0 RG 2 w 57 421 142 78 re S",
  );
  add(
    {
      Subtype: "Circle",
      Rect: [240, 420, 380, 500],
      C: [0, 0, 0.8],
      BS: { W: 2 },
      T: author,
    },
    "0 0 0.8 RG 2 w 310 499 m 348 499 379 482 379 460 c 379 438 348 421 310 421 c 272 421 241 438 241 460 c 241 482 272 499 310 499 c S",
  );
  add(
    {
      Subtype: "Stamp",
      Rect: [420, 420, 540, 460],
      Name: "Approved",
      T: author,
    },
    "0.8 0 0 RG 2 w 421 421 118 38 re S BT /Helv 14 Tf 0.8 0 0 rg 436 434 Td (APROBADO) Tj ET",
  );
  p2.node.set(PDFName.of("Annots"), ctx.obj(annots));
  return save(doc, "forms-annotations.pdf");
}

async function manyPages() {
  const doc = await newDoc("200 paginas");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 200; n++) {
    const page = doc.addPage(A4);
    page.drawText(`Pagina ${n} de 200`, { x: 56, y: 770, size: 18, font });
    for (let line = 0; line < 30; line++)
      page.drawText(
        `Linea ${line + 1}: contenido de relleno para la pagina ${n}.`,
        {
          x: 56,
          y: 730 - line * 20,
          size: 11,
          font,
        },
      );
  }
  return save(doc, "many-pages.pdf");
}

await mkdir(out, { recursive: true });
const results = [];
for (const make of [
  simpleText,
  table,
  twoPages,
  rotatedPage,
  subsetFont,
  tjKerning,
  textOperators,
  type3Font,
  formXObjects,
  formsAnnotations,
  manyPages,
])
  results.push(await make());
console.table(results);
