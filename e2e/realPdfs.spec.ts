// Spec 001, phase 6 (T025): editing existing text of real-world PDFs in the
// running app. The corpus is not in the repository: put PDFs in tests/real-pdfs/
// (or point $REAL_PDFS at a folder); the test is skipped without them.
import { expect, test, type Locator, type Page } from "@playwright/test";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { saveAndRead, textRuns } from "./helpers";

const corpus =
  process.env.REAL_PDFS ??
  join(import.meta.dirname, "..", "tests", "real-pdfs");
const files = existsSync(corpus)
  ? readdirSync(corpus).filter((f) => f.toLowerCase().endsWith(".pdf"))
  : [];

const pageAt = (page: Page, n: number) =>
  page.locator(`.page[data-page-number="${n}"]`);

const count = (text: string) => {
  const map = new Map<string, number>();
  for (const ch of text.replace(/\s/g, "")) map.set(ch, (map.get(ch) ?? 0) + 1);
  return [...map].sort(([a], [b]) => (a < b ? -1 : 1));
};

/** The text-layer spans of a page, with text. */
async function spans(page: Page, n: number): Promise<Locator[]> {
  const all = await pageAt(page, n).locator(".textLayer span").all();
  const out: Locator[] = [];
  for (const span of all) {
    const text = (await span.textContent()) ?? "";
    // pdf.js nests marked-content spans; keep the leaves with text.
    if (text.trim() !== "" && (await span.locator("span").count()) === 0)
      out.push(span);
  }
  return out;
}

test.describe("real-world PDFs (T025)", () => {
  test.skip(files.length === 0, "no corpus in tests/real-pdfs");
  for (const file of files) {
    test(`edits every text run of ${file} through the UI`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto("/app/");
      await page.getByTestId("open-pdf").setInputFiles(join(corpus, file));
      await expect(pageAt(page, 1)).toHaveAttribute("data-rendered", "true", {
        timeout: 20_000,
      });
      await page.getByRole("button", { name: "Editar texto" }).click();
      const editor = page.getByRole("textbox", { name: "Texto", exact: true });
      const problems: string[] = [];
      const markers = new Map<number, string[]>();
      const pages = await page.locator(".page").count();

      for (let n = 1; n <= Math.min(pages, 2); n++) {
        await pageAt(page, n).scrollIntoViewIfNeeded();
        await expect(pageAt(page, n)).toHaveAttribute("data-rendered", "true", {
          timeout: 20_000,
        });
        await expect(
          pageAt(page, n).locator(".textLayer span").first(),
        ).toBeAttached();
        for (const [k, span] of (await spans(page, n)).entries()) {
          const text = (await span.textContent())!;
          await span.scrollIntoViewIfNeeded();
          const box = (await span.boundingBox())!;
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          const label = `p${n} «${text}»`;
          try {
            await expect(editor).toBeVisible({ timeout: 3000 });
          } catch {
            problems.push(`${label}: the click opened no editor`);
            continue;
          }
          const value = await editor.inputValue();
          if (value !== text) {
            problems.push(`${label}: the click opened «${value}»`);
            await page.keyboard.press("Escape");
            continue;
          }
          // The preview uses the font pdf.js loaded from the PDF.
          const family = await editor.evaluate(
            (el) => getComputedStyle(el).fontFamily,
          );
          const face = family.split(",")[0]!.trim();
          const loaded = await page.evaluate(
            (f) => document.fonts.check(`12px ${f}`),
            face,
          );
          if (!/^"?g_/.test(face) || !loaded)
            problems.push(
              `${label}: preview font ${family} (loaded: ${loaded})`,
            );

          const marker = `Q${n}x${k}Z`;
          await page.keyboard.press("Control+A");
          await page.keyboard.type(marker);
          await page.keyboard.press("Control+Enter");
          await expect(editor).toBeHidden();
          markers.set(n, [...(markers.get(n) ?? []), marker]);

          // The page is re-rendered by the engine with the edit applied.
          await expect(pageAt(page, n).locator("img.page-edited")).toBeVisible({
            timeout: 20_000,
          });
        }
      }

      const { bytes } = await saveAndRead(page);
      if (process.env.E2E_DUMP)
        writeFileSync(
          join(process.env.E2E_DUMP, `${file}-${Date.now()}.pdf`),
          bytes,
        );
      const masks = await page.locator(".item-textEdit").count();
      for (const n of markers.keys())
        await expect(
          pageAt(page, n).locator(".item-textEdit-text"),
        ).toHaveCount(0, {
          timeout: 20_000,
        });
      for (const [n, list] of markers) {
        // Every run was replaced: only the markers are left on the page.
        const text = (await textRuns(bytes, n)).map((r) => r.str).join("");
        expect(
          count(text),
          `page ${n} text: ${text}
problems: ${problems.join(" | ")}
masks: ${masks}`,
        ).toEqual(count(list.join("")));
      }
      const edited = [...markers.values()].flat().length;
      console.log(
        `${file}: ${edited} runs edited, ${problems.length} problems`,
      );
      expect(edited).toBeGreaterThan(0);
      expect(problems).toEqual([]);
    });
  }
});
