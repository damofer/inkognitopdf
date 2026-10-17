// Spec 021: reusable templates. Layout engine, amounts in words, totals,
// formats, and every template rendered in Spanish and English.
import { createCanvas } from "@napi-rs/canvas";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { sanitize, TEMPLATE_IDS } from "../src/analytics/events";
import { totals } from "../src/templates/content/billing";
import {
  CATEGORY_NAMES,
  TEMPLATES,
  templateById,
} from "../src/templates/content";
import {
  amountInWords,
  englishWords,
  spanishWords,
} from "../src/templates/content/words";
import {
  buildContext,
  effectiveValues,
  emptyDraft,
  generate,
  safeFileName,
  type Draft,
} from "../src/templates/engine";
import {
  defaultCurrency,
  defaultPaper,
  formatDate,
  formatMoney,
  parseAmount,
  type Currency,
} from "../src/templates/format";
import {
  layout,
  wrap,
  type Block,
  type Metrics,
  type Op,
} from "../src/templates/layout";
import { ACCENTS, type Localized, type Style } from "../src/templates/types";
import {
  bundledFontPath,
  openPdf,
  pageText,
  qpdfCheck,
  qpdfPath,
} from "./helpers";

const loadFont = async (family: string, variant: string) =>
  new Uint8Array(await readFile(bundledFontPath(family, variant)));

/** Every character is 0.5 em wide; ascent 0.8 em. */
const fake: Metrics = {
  width: (text, _role, _variant, size) => text.length * size * 0.5,
  ascent: () => 0.8,
};

const style: Style = { accent: ACCENTS[0], fonts: "modern", paper: "a4" };
const texts = (ops: Op[]) =>
  ops.flatMap((o) => (o.kind === "text" ? [o.text] : []));

describe("layout (P002)", () => {
  test("wraps words to the width and cuts words longer than a line", () => {
    const measure = (s: string) => s.length;
    expect(wrap("uno dos tres cuatro", 8, measure)).toEqual([
      "uno dos",
      "tres",
      "cuatro",
    ]);
    expect(wrap("abcdefghij", 4, measure)).toEqual(["abcd", "efgh", "ij"]);
    expect(wrap("a\n\nb", 10, measure)).toEqual(["a", "", "b"]);
  });

  test("text flows on to a new page and the top margin drops spacing", () => {
    const blocks: Block[] = Array.from({ length: 80 }, (_, i) => ({
      type: "text",
      text: `línea ${i}`,
      before: 6,
    }));
    const { pages } = layout(
      { title: "t", blocks, margin: 50 },
      [400, 400],
      fake,
    );
    expect(pages.length).toBeGreaterThan(1);
    const all = pages.flatMap(texts);
    expect(all).toEqual(blocks.map((b) => (b as { text: string }).text));
    // The first line of each page sits right at the top margin.
    for (const page of pages) {
      const first = page.find((o) => o.kind === "text") as Extract<
        Op,
        { kind: "text" }
      >;
      expect(first.y).toBeCloseTo(50 + (13.5 - 10) / 2 + 8, 5);
    }
  });

  test("a group that fits on a page is never split", () => {
    const filler: Block = { type: "space", height: 250 };
    const group: Block = {
      type: "group",
      blocks: Array.from({ length: 10 }, (_, i) => ({
        type: "text",
        text: `g${i}`,
      })),
    };
    const { pages } = layout(
      {
        title: "t",
        blocks: [{ type: "text", text: "a" }, filler, group],
        margin: 50,
      },
      [400, 400],
      fake,
    );
    expect(texts(pages[0]!)).toEqual(["a"]);
    expect(texts(pages[1]!)).toEqual(
      Array.from({ length: 10 }, (_, i) => `g${i}`),
    );
  });

  test("headings stay with what follows them", () => {
    const { pages } = layout(
      {
        title: "t",
        margin: 50,
        blocks: [
          { type: "text", text: "a" },
          { type: "space", height: 260 },
          { type: "text", text: "TITLE", keepWithNext: true },
          { type: "text", text: "body" },
        ],
      },
      [400, 400],
      fake,
    );
    expect(texts(pages[0]!)).toEqual(["a"]);
    expect(texts(pages[1]!)).toEqual(["TITLE", "body"]);
  });

  test("a table repeats its header on every page it spans", () => {
    const { pages } = layout(
      {
        title: "t",
        margin: 50,
        blocks: [
          {
            type: "table",
            columns: [{ width: 0.7 }, { width: 0.3, align: "right" }],
            header: ["Concepto", "Valor"],
            rows: Array.from({ length: 40 }, (_, i) => [`fila ${i}`, `${i}`]),
          },
        ],
      },
      [400, 400],
      fake,
    );
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages)
      expect(texts(page).slice(0, 2)).toEqual(["Concepto", "Valor"]);
    const rows = pages.flatMap(texts).filter((t) => t.startsWith("fila"));
    expect(rows).toHaveLength(40);
  });

  test("the sidebar is painted on every page", () => {
    const { pages } = layout(
      {
        title: "t",
        margin: 50,
        sidebar: {
          width: 120,
          fill: "#123456",
          blocks: [{ type: "text", text: "side" }],
        },
        blocks: Array.from(
          { length: 60 },
          (_, i) => ({ type: "text", text: `m${i}` }) as Block,
        ),
      },
      [400, 400],
      fake,
    );
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages)
      expect(page[0]).toMatchObject({
        kind: "rect",
        x: 0,
        y: 0,
        w: 120,
        h: 400,
        fill: "#123456",
      });
    // Main text starts right of the sidebar.
    const main = pages[0]!.find(
      (o) => o.kind === "text" && o.text === "m0",
    ) as Extract<Op, { kind: "text" }>;
    expect(main.x).toBeGreaterThan(120);
  });

  test("right-aligned text ends at the right edge", () => {
    const { pages } = layout(
      {
        title: "t",
        margin: 50,
        blocks: [{ type: "text", text: "abcd", align: "right" }],
      },
      [400, 400],
      fake,
    );
    const op = pages[0]![0] as Extract<Op, { kind: "text" }>;
    expect(op.x + 4 * 5).toBeCloseTo(350);
  });
});

describe("amounts in words (CA6)", () => {
  test("Spanish", () => {
    expect(spanishWords(0)).toBe("cero");
    expect(spanishWords(21)).toBe("veintiuno");
    expect(spanishWords(100)).toBe("cien");
    expect(spanishWords(101)).toBe("ciento uno");
    expect(spanishWords(1000)).toBe("mil");
    expect(spanishWords(21_000)).toBe("veintiún mil");
    expect(spanishWords(1_200_000)).toBe("un millón doscientos mil");
    expect(spanishWords(2_000_000_000)).toBe("dos mil millones");
    expect(amountInWords(1_200_000, "COP", "es")).toBe(
      "un millón doscientos mil pesos",
    );
    expect(amountInWords(1_000_000, "COP", "es")).toBe("un millón de pesos");
    expect(amountInWords(3_000_000, "COP", "es")).toBe(
      "tres millones de pesos",
    );
    expect(amountInWords(21, "USD", "es")).toBe("veintiún dólares");
    expect(amountInWords(1, "EUR", "es")).toBe("un euro");
    expect(amountInWords(12.5, "USD", "es")).toBe(
      "doce dólares con cincuenta centavos",
    );
    expect(amountInWords(200, "GBP", "es")).toBe(
      "doscientas libras esterlinas",
    );
  });

  test("English", () => {
    expect(englishWords(0)).toBe("zero");
    expect(englishWords(42)).toBe("forty-two");
    expect(englishWords(1_200_315)).toBe(
      "one million two hundred thousand three hundred fifteen",
    );
    expect(amountInWords(1, "USD", "en")).toBe("one dollar");
    expect(amountInWords(2500.05, "USD", "en")).toBe(
      "two thousand five hundred dollars and five cents",
    );
  });
});

describe("billing and formats (CA6–CA7)", () => {
  test("item amounts, subtotal, tax and total", () => {
    const t = totals(
      [
        { description: "a", qty: "2", price: "1.500.000" },
        { description: "b", qty: "", price: "250,50" },
      ],
      19,
    );
    expect(t.lines.map((l) => l.amount)).toEqual([3_000_000, 250.5]);
    expect(t.subtotal).toBe(3_000_250.5);
    expect(t.tax).toBeCloseTo(570_047.6, 2);
    expect(t.total).toBeCloseTo(3_570_298.1, 2);
  });

  test("typed amounts in any usual notation", () => {
    expect(parseAmount("1.200.000")).toBe(1_200_000);
    expect(parseAmount("1,200.50")).toBe(1200.5);
    expect(parseAmount("1200,5")).toBe(1200.5);
    expect(parseAmount("$ 80.000")).toBe(80_000);
    expect(parseAmount("12.5")).toBe(12.5);
    expect(parseAmount("")).toBe(0);
  });

  test("money and dates by language; currency and paper by country", () => {
    expect(formatMoney(1_200_000, "COP", "es").replace(/\s/g, " ")).toBe(
      "$ 1.200.000",
    );
    expect(formatMoney(1234.5, "USD", "en")).toBe("$1,234.50");
    expect(formatDate("2026-10-17", "es")).toBe("17 de octubre de 2026");
    expect(formatDate("2026-10-17", "en")).toBe("October 17, 2026");
    expect(formatDate("mañana", "es")).toBe("mañana");
    expect(defaultCurrency(["es-CO"])).toBe("COP");
    expect(defaultCurrency(["es-MX", "es"])).toBe("MXN");
    expect(defaultCurrency(["es-ES"])).toBe("EUR");
    expect(defaultCurrency(["es"])).toBe("USD");
    expect(defaultPaper(["es-CO"])).toBe("letter");
    expect(defaultPaper(["en-US"])).toBe("letter");
    expect(defaultPaper(["es-ES"])).toBe("a4");
    expect(defaultPaper(["en"])).toBe("a4");
  });

  test("file names without forbidden characters", () => {
    expect(safeFileName('Cuenta de cobro - 001/2 "Ana"')).toBe(
      "Cuenta de cobro - 001 2 Ana",
    );
    expect(safeFileName("  ")).toBe("document");
  });
});

describe("catalog (CA2–CA3)", () => {
  const localized: [string, Localized][] = TEMPLATES.flatMap((t) => [
    [`${t.id}.name`, t.name] as [string, Localized],
    [`${t.id}.description`, t.description],
    ...(t.notice ? [[`${t.id}.notice`, t.notice] as [string, Localized]] : []),
    ...t.fields.map(
      (f) => [`${t.id}.${f.key}`, f.label] as [string, Localized],
    ),
    ...(t.lists ?? []).flatMap((l) => [
      [`${t.id}.${l.key}`, l.label] as [string, Localized],
      [`${t.id}.${l.key}.add`, l.addLabel] as [string, Localized],
      ...l.fields.map(
        (f) => [`${t.id}.${l.key}.${f.key}`, f.label] as [string, Localized],
      ),
    ]),
  ]);

  test("at least 12 templates with unique ids in three categories", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(12);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    expect(Object.keys(CATEGORY_NAMES).sort()).toEqual(
      [...new Set(TEMPLATES.map((t) => t.category))].sort(),
    );
  });

  test("every text in Spanish and English; no Spanish left in English", () => {
    const spanish = /[áéíóúñ¿¡«»]/i;
    for (const [key, value] of localized) {
      expect(value.es.trim(), key).not.toBe("");
      expect(value.en.trim(), key).not.toBe("");
      expect(spanish.test(value.en), `${key}: ${value.en}`).toBe(false);
    }
  });

  test("samples fill every field of the form in both languages", () => {
    for (const t of TEMPLATES)
      for (const lang of ["es", "en"] as const) {
        const sample = t.sample(lang);
        for (const f of t.fields)
          expect(sample.fields, `${t.id} ${lang} ${f.key}`).toHaveProperty(
            f.key,
          );
        for (const l of t.lists ?? [])
          expect(
            sample.lists[l.key]?.length,
            `${t.id} ${lang} ${l.key}`,
          ).toBeGreaterThan(0);
      }
  });

  test("what the user typed stays; the rest follows the language (CA3)", () => {
    const t = templateById("cv-classic")!;
    const draft = { ...emptyDraft(), fields: { name: "Pepa Pérez" } };
    const es = effectiveValues(t, draft, "es");
    const en = effectiveValues(t, draft, "en");
    expect(es.fields.name).toBe("Pepa Pérez");
    expect(en.fields.name).toBe("Pepa Pérez");
    expect(es.fields.headline).not.toBe(en.fields.headline);
  });

  test("sample amounts follow the currency in use", () => {
    const t = templateById("payment-request")!;
    const price = (draft: Draft, currency: Currency) =>
      effectiveValues(t, draft, "es", currency).lists.items![0]!.price;
    expect(price(emptyDraft(), "COP")).toBe("2500000");
    expect(price(emptyDraft(), "EUR")).toBe("2500");
    // A currency chosen in the form wins over the country's.
    const mxn = { ...emptyDraft(), fields: { currency: "MXN" } };
    expect(price(mxn, "EUR")).toBe("50000");
    // What the user typed is never converted.
    const typed = {
      fields: {},
      lists: { items: [{ description: "x", qty: "1", price: "700" }] },
    };
    expect(price(typed, "COP")).toBe("700");
  });

  test("rows left empty are not printed", () => {
    const t = templateById("invoice")!;
    const values = t.sample("es");
    values.lists.items = [
      ...values.lists.items!,
      { description: " ", qty: "", price: "" },
    ];
    const ctx = buildContext(values, "es", style, null, "COP");
    expect(ctx.list("items")).toHaveLength(3);
  });
});

const out = process.env.TEMPLATES_OUT;

describe("every template renders (CA9)", () => {
  for (const t of TEMPLATES)
    for (const lang of ["es", "en"] as const)
      test(`${t.id} (${lang})`, async () => {
        const values = t.sample(lang);
        const s: Style = {
          accent: ACCENTS[2],
          fonts: lang === "es" ? "elegant" : "classic",
          paper: lang === "es" ? "letter" : "a4",
        };
        const { bytes, fileName } = await generate(
          t,
          values,
          lang,
          s,
          null,
          loadFont,
          lang === "es" ? "COP" : "USD",
        );
        expect(fileName).toMatch(/\.pdf$/);
        const doc = await PDFDocument.load(bytes, { updateMetadata: false });
        expect(doc.getTitle()).toBeTruthy();
        expect(doc.getProducer()).toBe("InkognitoPDF");
        expect(doc.getAuthor()).toBeUndefined();
        expect(doc.getPage(0).getSize().width).toBeCloseTo(
          lang === "es" ? 612 : 595.28,
          1,
        );
        // Real, extractable text in the language of the template.
        const text = (await pageText(bytes, 1)).replace(/\s+/g, " ");
        const name = Object.values(values.fields).find(
          (v) =>
            v.length > 6 &&
            !/^\d{4}-/.test(v) &&
            !/^\+/.test(v) &&
            !/\n/.test(v),
        )!;
        expect(text).toContain(name.split(" ")[0]);
        if (qpdfPath) await qpdfCheck(bytes);
        if (out) {
          await mkdir(out, { recursive: true });
          await writeFile(join(out, `${t.id}-${lang}.pdf`), bytes);
        }
      });

  test("the CV with a photo and a long history takes several pages", async () => {
    const t = templateById("cv-modern")!;
    const values = t.sample("es");
    const job = values.lists.jobs![0]!;
    values.lists.jobs = Array.from({ length: 9 }, (_, i) => ({
      ...job,
      role: `Cargo ${i + 1}`,
    }));
    const photo = { bytes: await photoJpeg(), kind: "jpg" as const };
    const { bytes } = await generate(
      t,
      values,
      "es",
      style,
      photo,
      loadFont,
      "COP",
    );
    const doc = await openPdf(bytes);
    expect(doc.numPages).toBeGreaterThan(1);
    const all = [];
    for (let p = 1; p <= doc.numPages; p++) all.push(await pageText(bytes, p));
    const joined = all.join(" ");
    for (let i = 1; i <= 9; i++) expect(joined).toContain(`Cargo ${i}`);
    if (out) await writeFile(join(out, "cv-modern-long.pdf"), bytes);
  });

  test("the payment request shows the total in words and in figures", async () => {
    const t = templateById("payment-request")!;
    const values = t.sample("es");
    values.lists.items = [
      { description: "Asesoría", qty: "2", price: "500.000" },
      { description: "Informe", qty: "1", price: "200000" },
    ];
    const { bytes, fileName } = await generate(
      t,
      values,
      "es",
      style,
      null,
      loadFont,
      "COP",
    );
    const text = (await pageText(bytes, 1)).replace(/\s+/g, " ");
    expect(text).toContain("Un millón doscientos mil pesos");
    expect(text).toMatch(/\$ ?1\.200\.000/);
    expect(fileName).toBe("Cuenta de cobro - 001 - Carlos Andrés Gómez.pdf");
  });
});

/** A portrait-shaped photo, so the crop to the square frame is exercised. */
async function photoJpeg(): Promise<Uint8Array> {
  const canvas = createCanvas(300, 400);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3a7bd5";
  ctx.fillRect(0, 0, 300, 400);
  ctx.fillStyle = "#ffd166";
  ctx.beginPath();
  ctx.arc(150, 170, 90, 0, Math.PI * 2);
  ctx.fill();
  return new Uint8Array(await canvas.encode("jpeg"));
}

describe("usage events (spec 021)", () => {
  test("allow exactly the catalog's template ids", () => {
    expect([...TEMPLATE_IDS].sort()).toEqual(TEMPLATES.map((t) => t.id).sort());
    expect(sanitize("template_download", { template: "invoice" })).toEqual({
      name: "template_download",
      params: { template: "invoice" },
    });
    expect(sanitize("template_open", { template: "Mi CV" })?.params).toEqual(
      {},
    );
  });
});
