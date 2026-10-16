// Spec 012, CA13: the redacted data, also out of the areas (notes, bookmarks,
// attachments, field values, metadata).
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
  StandardFonts,
  type PDFObject,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applyEdits } from "../src/engine/applyEdits";
import { matcherOf, mergeNeedles } from "../src/engine/redactElsewhere";
import type { Needles, RedactionItem } from "../src/model/document";
import {
  fileContains,
  qpdfCheck,
  qpdfPath,
  stateFor,
  testCodec,
  testDeps,
} from "./helpers";

const SECRET = "4711-0815";
const deps = { ...testDeps, images: testCodec };
const NEEDLES: Needles = { texts: [`Cuenta ${SECRET}`, SECRET], patterns: [] };

type Node = { title: string; open?: boolean; kids?: Node[] };

/** Links an outline: Parent, Prev, Next, First, Last and Count. */
function outline(doc: PDFDocument, nodes: Node[]) {
  const ctx = doc.context;
  const root = ctx.obj({ Type: "Outlines" });
  const rootRef = ctx.register(root);
  const link = (parent: PDFDict, parentRef: PDFRef, kids: Node[]): number => {
    const items = kids.map((k) => {
      const dict = ctx.obj({ Title: PDFHexString.fromText(k.title) });
      return { node: k, dict, ref: ctx.register(dict) };
    });
    let visible = 0;
    items.forEach(({ node, dict, ref }, i) => {
      dict.set(PDFName.of("Parent"), parentRef);
      if (i > 0) dict.set(PDFName.of("Prev"), items[i - 1]!.ref);
      if (i < items.length - 1) dict.set(PDFName.of("Next"), items[i + 1]!.ref);
      const below = link(dict, ref, node.kids ?? []);
      if (below > 0)
        dict.set(PDFName.of("Count"), PDFNumber.of(node.open ? below : -below));
      visible += 1 + (node.open ? below : 0);
    });
    if (items.length > 0) {
      parent.set(PDFName.of("First"), items[0]!.ref);
      parent.set(PDFName.of("Last"), items[items.length - 1]!.ref);
    }
    return visible;
  };
  root.set(PDFName.of("Count"), PDFNumber.of(link(root, rootRef, nodes)));
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
}

/** A file with the secret on the page and in every other place. */
async function richPdf() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText(`Cuenta ${SECRET} Banco`, { x: 50, y: 200, size: 12, font });
  const before = font.widthOfTextAtSize("Cuenta ", 12);
  const width = font.widthOfTextAtSize(SECRET, 12);
  const area = { x: 50 + before + 1, y: 196, width: width - 2, height: 14 };

  // Fields: one away from the area, one under it, one without the secret.
  const form = doc.getForm();
  const field = (name: string, value: string, y: number) => {
    const f = form.createTextField(name);
    f.setText(value);
    f.addToPage(page, { x: 50, y, width: 150, height: 20, font });
  };
  field("cuenta", SECRET, 60);
  field("nombre", "Ana", 30);
  field("dentro", SECRET, 192);

  const add = (dict: Record<string, PDFObject | string | number[]>) => {
    const ref = ctx.register(ctx.obj(dict as never));
    page.node.addAnnot(ref);
    return ref;
  };
  const note = add({
    Type: "Annot",
    Subtype: "Text",
    Rect: [300, 20, 320, 40],
    Contents: PDFHexString.fromText(`Ver ${SECRET}`),
    T: PDFString.of("Ana"),
  });
  const popup = add({
    Type: "Annot",
    Subtype: "Popup",
    Rect: [200, 20, 300, 80],
    Parent: note,
  });
  (ctx.lookup(note) as PDFDict).set(PDFName.of("Popup"), popup);
  add({
    Type: "Annot",
    Subtype: "Text",
    Rect: [330, 260, 350, 280],
    Contents: PDFString.of("Nada que ver"),
  });
  // Rich text, with the hyphen written as a character reference.
  add({
    Type: "Annot",
    Subtype: "FreeText",
    Rect: [220, 100, 380, 140],
    DA: PDFString.of("/Helv 10 Tf 0 g"),
    RC: PDFString.of(
      `<body><p>Nota ${SECRET.replace("-", "&#45;")}</p></body>`,
    ),
  });

  const spec = (name: string, text: string, desc?: string) =>
    ctx.register(
      ctx.obj({
        Type: "Filespec",
        F: PDFString.of(name),
        UF: PDFHexString.fromText(name),
        ...(desc ? { Desc: PDFHexString.fromText(desc) } : {}),
        EF: {
          F: ctx.register(
            ctx.flateStream(text, { Type: "EmbeddedFile" } as never),
          ),
        },
      } as never),
    );
  const secretFile = spec("secreto.txt", `dato ${SECRET}\n`);
  const otherFile = spec("otro.txt", "nada\n");
  doc.catalog.set(
    PDFName.of("Names"),
    ctx.obj({
      EmbeddedFiles: ctx.obj({
        Names: [
          PDFHexString.fromText("otro.txt"),
          otherFile,
          PDFHexString.fromText("secreto.txt"),
          secretFile,
        ],
      }),
    }),
  );
  doc.catalog.set(PDFName.of("AF"), ctx.obj([secretFile, otherFile]));
  add({
    Type: "Annot",
    Subtype: "FileAttachment",
    Rect: [360, 20, 380, 40],
    FS: spec("anexo.txt", "sin datos\n", `Copia de ${SECRET}`),
  });

  outline(doc, [
    {
      title: "Capitulo 1",
      open: true,
      kids: [
        {
          title: `Dato ${SECRET}`,
          kids: [{ title: "Sub 1" }, { title: "Sub 2" }],
        },
        { title: "Capitulo 2" },
      ],
    },
  ]);

  doc.setTitle(`Informe ${SECRET}`);
  doc.setAuthor("Ana");
  doc.setSubject("Resumen");
  doc.setKeywords([SECRET, "banco"]);
  doc.catalog.set(
    PDFName.of("Metadata"),
    ctx.register(
      ctx.stream(
        `<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:title>${SECRET}</dc:title></x:xmpmeta>`,
        { Type: "Metadata", Subtype: "XML" },
      ),
    ),
  );
  return { bytes: await doc.save(), area };
}

const redaction = (
  pageId: string,
  rect: RedactionItem["rect"],
  elsewhere?: Needles,
): RedactionItem => ({
  kind: "redaction",
  id: "r1",
  pageId,
  rect,
  applied: true,
  ...(elsewhere ? { elsewhere } : {}),
});

async function run(elsewhere?: Needles, find?: Needles) {
  const { bytes, area } = await richPdf();
  const state = await stateFor(bytes);
  const item = redaction(state.pages[0]!.id, area, elsewhere);
  return applyEdits(
    bytes,
    { ...state, items: [item] },
    deps,
    find ? { findElsewhere: find } : {},
  );
}

/** Titles of an outline, children in arrays after their parent. */
function titles(doc: PDFDocument, parent: PDFDict): unknown[] {
  const out: unknown[] = [];
  let node = parent.lookup(PDFName.of("First"));
  let prev: PDFDict | undefined;
  while (node instanceof PDFDict) {
    // The links agree both ways.
    expect(node.lookup(PDFName.of("Parent"))).toBe(parent);
    expect(node.lookup(PDFName.of("Prev"))).toBe(prev);
    out.push((node.lookup(PDFName.of("Title")) as PDFHexString).decodeText());
    const kids = titles(doc, node);
    if (kids.length > 0) out.push(kids);
    prev = node;
    node = node.lookup(PDFName.of("Next"));
  }
  expect(parent.lookup(PDFName.of("Last"))).toBe(prev);
  return out;
}

describe("redaction elsewhere in the file (spec 012, CA13)", () => {
  it("counts where else the data is, away from the areas", async () => {
    const { bytes, elsewhere } = await run(undefined, NEEDLES);
    expect(bytes.length).toBe(0);
    expect(elsewhere).toEqual({
      annotations: 2,
      bookmarks: 1,
      attachments: 2,
      fields: 1,
      metadata: 3,
    });
  });

  it("finds a regular expression too", async () => {
    const { elsewhere } = await run(undefined, {
      texts: [],
      patterns: ["\\d{4}-\\d{4}"],
    });
    expect(elsewhere).toMatchObject({ annotations: 2, bookmarks: 1 });
  });

  it("removes it everywhere and keeps the rest", async () => {
    const { bytes } = await run(NEEDLES);
    expect(await fileContains(bytes, SECRET)).toBe(false);
    if (qpdfPath) await qpdfCheck(bytes);

    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const page = doc.getPage(0);
    const annots = (page.node.lookup(PDFName.of("Annots")) as PDFArray)
      .asArray()
      .map((r) => doc.context.lookup(r) as PDFDict);
    const notes = annots.filter(
      (a) => a.lookup(PDFName.of("Subtype")) !== PDFName.of("Widget"),
    );
    expect(notes).toHaveLength(1);
    expect(
      (notes[0]!.lookup(PDFName.of("Contents")) as PDFString).decodeText(),
    ).toBe("Nada que ver");

    // The bookmark goes; its children take its place, in order.
    const root = doc.catalog.lookup(PDFName.of("Outlines")) as PDFDict;
    expect(titles(doc, root)).toEqual([
      "Capitulo 1",
      ["Sub 1", "Sub 2", "Capitulo 2"],
    ]);
    expect(root.lookup(PDFName.of("Count"))).toEqual(PDFNumber.of(4));
    const chapter = root.lookup(PDFName.of("First")) as PDFDict;
    expect(chapter.lookup(PDFName.of("Count"))).toEqual(PDFNumber.of(3));

    const names = (doc.catalog.lookup(PDFName.of("Names")) as PDFDict).lookup(
      PDFName.of("EmbeddedFiles"),
    ) as PDFDict;
    const pairs = (names.lookup(PDFName.of("Names")) as PDFArray).asArray();
    expect(pairs).toHaveLength(2);
    expect((doc.context.lookup(pairs[0]!) as PDFHexString).decodeText()).toBe(
      "otro.txt",
    );
    expect(doc.catalog.lookup(PDFName.of("AF"), PDFArray).size()).toBe(1);

    const form = doc.getForm();
    expect(form.getTextField("nombre").getText()).toBe("Ana");
    expect(form.getTextField("cuenta").getText() ?? "").toBe("");
    expect(form.getFields().map((f) => f.getName())).not.toContain("dentro");

    expect(doc.getTitle()).toBeUndefined();
    expect(doc.getKeywords()).toBeUndefined();
    expect(doc.getAuthor()).toBe("Ana");
    expect(doc.getSubject()).toBe("Resumen");
    expect(doc.catalog.get(PDFName.of("Metadata"))).toBeUndefined();
  });

  it("without it, the data stays in the file", async () => {
    const { bytes } = await run();
    expect(await fileContains(bytes, SECRET)).toBe(true);
  });

  it("an outline left empty has no items", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    outline(doc, [{ title: SECRET, kids: [] }]);
    const bytes = await doc.save();
    const state = await stateFor(bytes);
    const { bytes: out } = await applyEdits(
      bytes,
      {
        ...state,
        items: [
          redaction(
            state.pages[0]!.id,
            { x: 0, y: 0, width: 10, height: 10 },
            { texts: [SECRET], patterns: [] },
          ),
        ],
      },
      deps,
    );
    const saved = await PDFDocument.load(out, { updateMetadata: false });
    const root = saved.catalog.lookup(PDFName.of("Outlines")) as PDFDict;
    expect(root.get(PDFName.of("First"))).toBeUndefined();
    expect(root.lookup(PDFName.of("Count"))).toEqual(PDFNumber.of(0));
    expect(await fileContains(out, SECRET)).toBe(false);
  });

  it("matches without case or accents, and skips bad patterns", () => {
    const holds = matcherOf({ texts: ["José Pérez"], patterns: ["(bad"] });
    expect(holds("nota de JOSE\n  perez")).toBe(true);
    expect(holds("Josefina")).toBe(false);
    expect(
      mergeNeedles([
        { texts: ["a b c"], patterns: [] },
        undefined,
        { texts: ["a b c"], patterns: ["x"] },
      ]),
    ).toEqual({ texts: ["a b c"], patterns: ["x"] });
    expect(mergeNeedles([undefined])).toBeNull();
  });
});
