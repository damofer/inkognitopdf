// Shared helpers for engine tests: fixtures, pdf.js inspection and qpdf.
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { initialState, type EditorState } from "../src/model/document";
import { normalizeRotation } from "../src/model/geometry";
import type { EngineDeps } from "../src/engine/applyEdits";
import type { ImageCodec } from "../src/engine/redact";

/** Bundled open fonts, read from their npm packages (as the copy script does). */
export function bundledFontPath(family: string, variant: string): string {
  const folder = {
    Regular: "400Regular",
    Italic: "400Regular_Italic",
    Bold: "700Bold",
    BoldItalic: "700Bold_Italic",
  }[variant]!;
  return join(
    createRequire(import.meta.url).resolve(
      `@expo-google-fonts/${family.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()}/package.json`,
    ),
    "..",
    folder,
    `${family}_${folder}.ttf`,
  );
}

export const fixturesDir = join(import.meta.dirname, "fixtures");
const pdfjsRoot = join(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
  "..",
);
export const standardFontsDir = join(pdfjsRoot, "standard_fonts");

export async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(fixturesDir, name)));
}

export const testDeps: EngineDeps = {
  loadFont: async (family, variant) =>
    new Uint8Array(await readFile(bundledFontPath(family, variant))),
  now: () => new Date("2026-01-02T00:00:00Z"),
};

export async function openPdf(bytes: Uint8Array) {
  return getDocument({
    data: bytes.slice(),
    standardFontDataUrl: standardFontsDir + "/",
    useSystemFonts: false,
  }).promise;
}

/** Edit state for a file, as the app builds it after opening. */
export async function stateFor(bytes: Uint8Array): Promise<EditorState> {
  const doc = await openPdf(bytes);
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const [x0, y0, x1, y1] = page.view as [number, number, number, number];
    pages.push({
      box: [x0, y0, x1, y1] as const,
      rotation: normalizeRotation(page.rotate),
    });
  }
  await doc.loadingTask.destroy();
  return initialState(pages);
}

export interface TextRun {
  str: string;
  x: number;
  y: number;
  size: number;
  fontName: string;
}

export async function textRuns(
  bytes: Uint8Array,
  pageNumber = 1,
): Promise<TextRun[]> {
  const doc = await openPdf(bytes);
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const runs = content.items
    .filter((i) => "str" in i && i.str.trim() !== "")
    .map((i) => {
      const item = i as { str: string; transform: number[]; fontName: string };
      const [a, b, , , e, f] = item.transform as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      return {
        str: item.str,
        x: e,
        y: f,
        size: Math.hypot(a, b),
        fontName: item.fontName,
      };
    });
  await doc.loadingTask.destroy();
  return runs;
}

export async function pageText(
  bytes: Uint8Array,
  pageNumber = 1,
): Promise<string> {
  return (await textRuns(bytes, pageNumber)).map((r) => r.str).join(" ");
}

const qpdfCandidates = [
  process.env.QPDF,
  join(import.meta.dirname, "..", "..", "tools", "qpdf", "bin", "qpdf.exe"),
  "/usr/bin/qpdf",
  "/usr/local/bin/qpdf",
  "/opt/homebrew/bin/qpdf",
].filter((p): p is string => !!p);

export const qpdfPath = qpdfCandidates.find((p) => existsSync(p));

/** Runs `qpdf --check`; resolves with its output, rejects on errors or warnings. */
export async function qpdfCheck(bytes: Uint8Array): Promise<string> {
  if (!qpdfPath) throw new Error("qpdf not found");
  const dir = await mkdtemp(join(tmpdir(), "pdfcraft-"));
  const file = join(dir, "out.pdf");
  await writeFile(file, bytes);
  const { stdout } = await promisify(execFile)(qpdfPath, ["--check", file]);
  return stdout;
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/**
 * Every way the secret could still be in the file: the raw bytes and every
 * decoded stream, as text, hex, UTF-16 and inside strings of any object.
 */
export async function fileContains(bytes: Uint8Array, secret: string) {
  const needles = [
    secret,
    Buffer.from(secret, "latin1").toString("hex"),
    Buffer.from(secret, "utf16le").swap16().toString("hex"),
  ].map((s) => s.toLowerCase());
  const haystacks = [latin1(bytes)];
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      try {
        haystacks.push(latin1(decodePDFRawStream(obj).decode()));
      } catch {
        haystacks.push(latin1(obj.contents));
      }
      haystacks.push(obj.dict.toString());
    } else haystacks.push(obj.toString());
  }
  return haystacks.some((h) => {
    const lower = h.toLowerCase();
    // Strings of objects print as (…) or <hex>.
    return needles.some((n) => lower.includes(n));
  });
}

/** JPEG through @napi-rs/canvas, as the browser does with a canvas. */
export const testCodec: ImageCodec = {
  async decodeJpeg(bytes) {
    const image = await loadImage(Buffer.from(bytes));
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, image.width, image.height).data;
    return { width: image.width, height: image.height, data };
  },
  async encodeJpeg(rgba, width, height, quality = 0.92) {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(width, height);
    image.data.set(rgba);
    ctx.putImageData(image, 0, 0);
    return new Uint8Array(
      await canvas.encode("jpeg", Math.round(quality * 100)),
    );
  },
};
