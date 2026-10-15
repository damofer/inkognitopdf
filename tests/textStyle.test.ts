// Spec 001, CA3b: edited text keeps the original style. For every text run of
// the fixtures and of the real-world corpus (tests/real-pdfs/, not in the repository), the run is
// replaced by its own text; then the new text operations are compared with the
// original ones (color, Tf size, matrix, text state, font and its weight and
// style) and both pages are rendered with pdf.js and compared pixel by pixel.
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { textBoxes, textEditFor, type TextBox } from "../src/editor/textBoxes";
import { applyEdits } from "../src/engine/applyEdits";
import { pageTextShows } from "../src/engine/textEdit";
import type { TextShow } from "../src/engine/textShows";
import type { Rect } from "../src/model/geometry";
import { applyOperation } from "../src/model/operations";
import { fixturesDir, openPdf, stateFor, testDeps } from "./helpers";

const corpus = process.env.REAL_PDFS ?? join(import.meta.dirname, "real-pdfs");
const sources = [
  ...["subset-font.pdf", "text-operators.pdf", "form-xobjects.pdf"]
    .map((f) => join(fixturesDir, f))
    .filter(existsSync),
  ...(existsSync(corpus)
    ? readdirSync(corpus)
        .filter((f) => f.toLowerCase().endsWith(".pdf"))
        .map((f) => join(corpus, f))
    : []),
];

const SCALE = 2;
/** A pixel differs when a channel changes by more than this (0–255). */
const PIXEL_THRESHOLD = 64;
/** CA3b: at most this share of the pixels of the run may differ. */
const MAX_DIFF = 0.02;

async function render(bytes: Uint8Array, pageNumber: number) {
  const doc = await openPdf(bytes);
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: SCALE });
  const canvas = createCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  const context = canvas.getContext("2d");
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  const content = await page.getTextContent();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  await doc.loadingTask.destroy();
  return { image, viewport, boxes: textBoxes(content) };
}

type Rendered = Awaited<ReturnType<typeof render>>;

/** Share of the pixels inside `area` (user space) that differ. */
function pixelDiff(a: Rendered, b: Rendered, area: Rect): number {
  const [t0, t1, t2, t3, t4, t5] = a.viewport.transform as number[];
  const toView = (x: number, y: number) => [
    t0! * x + t2! * y + t4!,
    t1! * x + t3! * y + t5!,
  ];
  const [x0, y0] = toView(area.x - 1, area.y - 1) as [number, number];
  const [x1, y1] = toView(
    area.x + area.width + 1,
    area.y + area.height + 1,
  ) as [number, number];
  const left = Math.max(0, Math.floor(Math.min(x0, x1)));
  const right = Math.min(a.image.width, Math.ceil(Math.max(x0, x1)));
  const top = Math.max(0, Math.floor(Math.min(y0, y1)));
  const bottom = Math.min(a.image.height, Math.ceil(Math.max(y0, y1)));
  let differ = 0;
  let total = 0;
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const i = (y * a.image.width + x) * 4;
      total++;
      for (let c = 0; c < 3; c++)
        if (
          Math.abs(a.image.data[i + c]! - b.image.data[i + c]!) >
          PIXEL_THRESHOLD
        ) {
          differ++;
          break;
        }
    }
  return total === 0 ? 0 : differ / total;
}

const inside = (p: { x: number; y: number }, r: Rect, d = 0.5) =>
  p.x >= r.x - d &&
  p.x <= r.x + r.width + d &&
  p.y >= r.y - d &&
  p.y <= r.y + r.height + d;

/** Text operations with a glyph centred in `area`, nearest to `at` first. */
function showsIn(shows: TextShow[], area: Rect, at: { x: number; y: number }) {
  const found: { show: TextShow; distance: number }[] = [];
  for (const show of shows) {
    let distance = Infinity;
    for (const part of show.parts)
      if (part.kind === "glyph" && inside(part.center, area))
        distance = Math.min(
          distance,
          Math.hypot(part.origin.x - at.x, part.origin.y - at.y),
        );
    if (distance < Infinity) found.push({ show, distance });
  }
  return found.sort((a, b) => a.distance - b.distance).map((f) => f.show);
}

const close = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

/** Differences in style between an original operation and a new one. */
function styleDiff(before: TextShow, after: TextShow): string[] {
  const out: string[] = [];
  const a = before.state;
  const b = after.state;
  if (before.color !== after.color)
    out.push(`color ${before.color}→${after.color}`);
  if (a.fillOps.replace(/\s+/g, " ") !== b.fillOps.replace(/\s+/g, " "))
    out.push(`fill «${a.fillOps}»→«${b.fillOps}»`);
  if (!close(a.fontSize, b.fontSize))
    out.push(`Tf ${a.fontSize}→${b.fontSize}`);
  if (!close(a.charSpacing, b.charSpacing))
    out.push(`Tc ${a.charSpacing}→${b.charSpacing}`);
  if (!close(a.horizontalScale, b.horizontalScale))
    out.push(`Tz ${a.horizontalScale}→${b.horizontalScale}`);
  if (!close(a.rise, b.rise)) out.push(`Ts ${a.rise}→${b.rise}`);
  if (a.renderMode !== b.renderMode)
    out.push(`Tr ${a.renderMode}→${b.renderMode}`);
  const m = before.userMatrix;
  const n = after.userMatrix;
  if (
    [0, 1, 2, 3].some(
      (k) => !close(m[k]!, n[k]!, 1e-3 * Math.max(1, Math.abs(m[k]!))),
    )
  )
    out.push(`matrix ${m.slice(0, 4).join(",")}→${n.slice(0, 4).join(",")}`);
  const fa = before.font;
  const fb = after.font;
  if (fa && fb && fa.resourceName !== fb.resourceName) {
    if (fa.bold !== fb.bold) out.push(`bold ${fa.bold}→${fb.bold}`);
    if (fa.italic !== fb.italic) out.push(`italic ${fa.italic}→${fb.italic}`);
    if (fa.substitute !== fb.substitute)
      out.push(`family ${fa.substitute}→${fb.substitute}`);
  }
  return out;
}

describe.skipIf(sources.length === 0)(
  "CA3b: edited text keeps its style",
  () => {
    for (const path of sources) {
      const name = path.split(/[\\/]/).pop()!;
      it(`keeps the style of every run of ${name}`, async () => {
        const original = new Uint8Array(await readFile(path));
        const base = await stateFor(original);
        const source = await PDFDocument.load(original);
        const failures: string[] = [];
        const diffs: number[] = [];
        const substitutes = new Set<string>();
        for (const [pageIndex] of base.pages.entries()) {
          const pageNumber = pageIndex + 1;
          const before = await render(original, pageNumber);
          const originalShows = pageTextShows(
            source,
            source.getPage(pageIndex),
          );
          for (const [n, box] of before.boxes.entries()) {
            const label = `${name} p${pageNumber} «${box.text}»`;
            const item = textEditFor(
              box as TextBox,
              `p${pageIndex}`,
              "e",
              box.text,
            );
            const state = applyOperation(base, { kind: "addItem", item });
            const { bytes } = await applyEdits(original, state, testDeps);
            const edited = await PDFDocument.load(bytes);
            const newShows = pageTextShows(edited, edited.getPage(pageIndex));
            const was = showsIn(originalShows, box.area, box.at)[0];
            const now = showsIn(newShows, box.area, box.at);
            if (!was || now.length === 0) {
              failures.push(`${label}: text operation not found`);
              continue;
            }
            const problems = new Set(
              now.flatMap((show) => styleDiff(was, show)),
            );
            if (problems.size > 0)
              failures.push(`${label}: ${[...problems].join("; ")}`);
            // A character no document font has: the rest keeps the original
            // font, «Ŵ» comes from the matching open font, same weight and style.
            const mixed = applyOperation(base, {
              kind: "addItem",
              item: { ...item, text: `Ŵ${box.text}` },
            });
            const withSubstitute = await applyEdits(original, mixed, testDeps);
            for (const w of withSubstitute.warnings)
              substitutes.add(
                `${was.font?.baseFont} → ${/\(([^)]+)\)/.exec(w)?.[1]}`,
              );
            const mixedDoc = await PDFDocument.load(withSubstitute.bytes);
            const mixedShows = showsIn(
              pageTextShows(mixedDoc, mixedDoc.getPage(pageIndex)),
              box.area,
              box.at,
            );
            const fonts = new Set(mixedShows.map((s) => s.font?.resourceName));
            // (A one-glyph area is too small to also catch the wider «Ŵ».)
            if (
              was.font?.subtype !== "Type3" &&
              box.text.length > 2 &&
              fonts.size < 2
            )
              failures.push(`${label}: no substitute font for «Ŵ»`);
            const mixedProblems = new Set(
              mixedShows.flatMap((show) => styleDiff(was, show)),
            );
            if (mixedProblems.size > 0)
              failures.push(`${label} (Ŵ): ${[...mixedProblems].join("; ")}`);
            const after = await render(bytes, pageNumber);
            const diff = pixelDiff(before, after, box.area);
            diffs.push(diff);
            if (diff > MAX_DIFF)
              failures.push(
                `${label}: ${(diff * 100).toFixed(1)} % of the pixels differ (#${n})`,
              );
          }
        }
        if (process.env.SWEEP_OUT)
          appendFileSync(
            process.env.SWEEP_OUT,
            [
              `${name}: ${diffs.length} runs, max diff ${(Math.max(0, ...diffs) * 100).toFixed(2)} %, ${failures.length} failures`,
              ...failures,
              ...[...substitutes].map((x) => `  substitute: ${x}`),
              "",
            ].join("\n"),
          );
        expect(diffs.length).toBeGreaterThan(0);
        expect(failures).toEqual([]);
      }, 600_000);
    }
  },
);
