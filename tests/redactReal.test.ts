// Spec 012: secure redaction on real-world PDFs (Chrome, Word, Sejda) and on
// the fixtures. The corpus lives outside the repository, in
// tests/real-pdfs/ (or $REAL_PDFS, not in the repository); those cases are skipped without it.
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textBoxes, type TextBox } from "../src/editor/textBoxes";
import { applyEdits } from "../src/engine/applyEdits";
import { overlaps } from "../src/engine/redact";
import type { RedactionItem } from "../src/model/document";
import {
  fixturesDir,
  openPdf,
  qpdfCheck,
  qpdfPath,
  stateFor,
  testDeps,
} from "./helpers";

const corpus = process.env.REAL_PDFS ?? join(import.meta.dirname, "real-pdfs");
const real = existsSync(corpus)
  ? readdirSync(corpus)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .map((f) => join(corpus, f))
  : [];
const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".pdf"))
  .map((f) => join(fixturesDir, f));

async function boxesOf(bytes: Uint8Array): Promise<TextBox[]> {
  const doc = await openPdf(bytes);
  const content = await (await doc.getPage(1)).getTextContent();
  await doc.loadingTask.destroy();
  return textBoxes(content);
}

const squeeze = (s: string) => s.replace(/\s+/g, "");
const count = (all: string, part: string) => all.split(part).length - 1;

describe.each([...fixtures, ...real])("redaction of %s", (path) => {
  it("removes the redacted runs and keeps the others", async () => {
    const bytes = new Uint8Array(await readFile(path));
    const boxes = await boxesOf(bytes);
    const words = boxes.filter((b) => /[\p{L}\p{N}]{3}/u.test(b.text));
    if (words.length < 2) return;
    // Every other run, up to three.
    const chosen = words.filter((_, i) => i % 2 === 0).slice(0, 3);
    const state = await stateFor(bytes);
    const items: RedactionItem[] = chosen.map((b, i) => ({
      kind: "redaction",
      id: `r${i}`,
      pageId: state.pages[0]!.id,
      rect: b.area,
      applied: true,
    }));
    const { bytes: out } = await applyEdits(
      bytes,
      { ...state, items },
      testDeps,
    );
    if (qpdfPath) await qpdfCheck(out);
    const before = squeeze(boxes.map((b) => b.text).join(""));
    const after = squeeze((await boxesOf(out)).map((b) => b.text).join(""));
    for (const box of chosen)
      expect(count(after, squeeze(box.text))).toBeLessThan(
        count(before, squeeze(box.text)),
      );
    // Runs away from every area keep their text.
    for (const box of words.filter(
      (b) => !items.some((r) => overlaps(r.rect, b.area)),
    ))
      expect(after).toContain(squeeze(box.text));
  });
});
