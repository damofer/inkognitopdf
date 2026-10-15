// Spec 001, phase 6 (T024): edit every text run of real-world PDFs.
// The corpus is not in the repository: tests/real-pdfs/ (or $REAL_PDFS):
// PDFs generated on this machine with Chrome, Word, etc. The test is skipped
// when the folder does not exist.
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textBoxes, textEditFor, type TextBox } from "../src/editor/textBoxes";
import { applyEdits } from "../src/engine/applyEdits";
import type { EditorState } from "../src/model/document";
import { applyOperation } from "../src/model/operations";
import { openPdf, qpdfCheck, qpdfPath, stateFor, testDeps } from "./helpers";

const corpus = process.env.REAL_PDFS ?? join(import.meta.dirname, "real-pdfs");
const files = existsSync(corpus)
  ? readdirSync(corpus).filter((f) => f.toLowerCase().endsWith(".pdf"))
  : [];

interface PageText {
  boxes: TextBox[];
  chars: Map<string, number>;
}

function countChars(text: string, into = new Map<string, number>()) {
  for (const ch of text.replace(/\s/g, ""))
    into.set(ch, (into.get(ch) ?? 0) + 1);
  return into;
}

async function pageText(
  bytes: Uint8Array,
  pageNumber: number,
): Promise<PageText> {
  const doc = await openPdf(bytes);
  const content = await (await doc.getPage(pageNumber)).getTextContent();
  await doc.loadingTask.destroy();
  const boxes = textBoxes(content);
  const chars = new Map<string, number>();
  for (const b of boxes) countChars(b.text, chars);
  return { boxes, chars };
}

function diffChars(a: Map<string, number>, b: Map<string, number>) {
  const out: string[] = [];
  for (const ch of new Set([...a.keys(), ...b.keys()])) {
    const d = (b.get(ch) ?? 0) - (a.get(ch) ?? 0);
    if (d !== 0) out.push(`${ch}:${d > 0 ? "+" : ""}${d}`);
  }
  return out;
}

/** The box where `marker` starts, in the concatenated page text. */
function locate(boxes: TextBox[], marker: string) {
  let joined = "";
  const owners: { box: TextBox; offset: number }[] = [];
  for (const box of boxes)
    [...box.text.replace(/\s/g, "")].forEach((ch, offset) => {
      joined += ch;
      owners.push({ box, offset });
    });
  const index = joined.indexOf(marker);
  return index < 0 ? null : owners[index]!;
}

describe.skipIf(files.length === 0)("real-world PDFs (T024)", () => {
  for (const file of files) {
    it(`edits every text run of ${file}`, async () => {
      const original = new Uint8Array(await readFile(join(corpus, file)));
      const base: EditorState = await stateFor(original);
      const failures: string[] = [];
      let edits = 0;
      for (const [pageIndex] of base.pages.entries()) {
        const pageNumber = pageIndex + 1;
        const before = await pageText(original, pageNumber);
        for (const [n, box] of before.boxes.entries()) {
          const marker = `Q${pageNumber}x${n}Z`;
          const item = textEditFor(box, `p${pageIndex}`, "e", marker);
          const state = applyOperation(base, { kind: "addItem", item });
          const label = `${file} p${pageNumber} «${box.text}»`;
          edits++;
          try {
            const { bytes, warnings } = await applyEdits(
              original,
              state,
              testDeps,
            );
            const notFound = warnings.find((w) =>
              w.startsWith("No se encontró"),
            );
            if (notFound) failures.push(`${label}: not found in content`);
            const after = await pageText(bytes, pageNumber);
            const expected = countChars(marker, new Map(before.chars));
            for (const ch of box.text.replace(/\s/g, ""))
              expected.set(ch, (expected.get(ch) ?? 0) - 1);
            const diff = diffChars(expected, after.chars);
            if (diff.length > 0)
              failures.push(`${label}: characters differ ${diff.join(" ")}`);
            // A mixed run (original font + substitute) comes back as several boxes.
            const found = locate(after.boxes, marker);
            if (!found) failures.push(`${label}: new text not found`);
            else if (
              found.offset === 0 &&
              Math.hypot(found.box.at.x - box.at.x, found.box.at.y - box.at.y) >
                1.5
            )
              failures.push(
                `${label}: new text at ${found.box.at.x.toFixed(1)},${found.box.at.y.toFixed(1)} instead of ${box.at.x.toFixed(1)},${box.at.y.toFixed(1)}`,
              );
            if (qpdfPath && n === 0) await qpdfCheck(bytes);
          } catch (cause) {
            failures.push(
              `${label}: ${cause instanceof Error ? cause.message : String(cause)}`,
            );
          }
        }
      }
      if (process.env.SWEEP_OUT)
        appendFileSync(
          process.env.SWEEP_OUT,
          [
            `${file}: ${edits} edits, ${failures.length} failures`,
            ...failures,
            "",
          ].join("\n"),
        );
      expect(edits).toBeGreaterThan(0);
      expect(failures).toEqual([]);
    }, 300_000);
  }
});
