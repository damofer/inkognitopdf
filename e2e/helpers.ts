// Shared helpers for the e2e tests: opening fixtures, saving and reading PDFs.
import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

export { OPS };

export const fixture = (name: string) =>
  join(import.meta.dirname, "..", "tests", "fixtures", name);

const standardFonts =
  join(
    import.meta.dirname,
    "..",
    "node_modules",
    "pdfjs-dist",
    "standard_fonts",
  ) + "/";

export const firstPage = (page: Page) =>
  page.locator('.page[data-page-number="1"]');

export async function openFixture(page: Page, name: string) {
  await page.goto("/app/");
  await page.getByTestId("open-pdf").setInputFiles(fixture(name));
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
}

export async function saveAndRead(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Guardar PDF" }).click();
  const file = await download;
  return {
    name: file.suggestedFilename(),
    bytes: new Uint8Array(await readFile((await file.path())!)),
  };
}

export async function openPdf(bytes: Uint8Array) {
  return getDocument({
    data: bytes.slice(),
    standardFontDataUrl: standardFonts,
    useSystemFonts: false,
  }).promise;
}

/** Text runs of a page with their baseline origin and size, in PDF units. */
export async function textRuns(bytes: Uint8Array, pageNumber = 1) {
  const doc = await openPdf(bytes);
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  const runs = content.items.flatMap((i) => {
    if (!("str" in i) || i.str.trim() === "") return [];
    const [a, b, , , x, y] = i.transform as number[];
    return [
      {
        str: i.str,
        x: x!,
        y: y!,
        size: Math.hypot(a!, b!),
        fontFamily: content.styles[i.fontName]?.fontFamily ?? "",
      },
    ];
  });
  await doc.loadingTask.destroy();
  return runs;
}

/** Minimal valid RGB PNG. */
export function makePng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.from([0, ...Array(width).fill([40, 140, 220]).flat()]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array(height).fill(row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
