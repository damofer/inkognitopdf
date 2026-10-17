// Pages must not stay blank in browsers a few versions old (Chromium 141,
// Safari 17-18, Samsung Internet). Recent JavaScript that pdf.js 6 relies on
// is removed from the page and from every module worker before the app runs,
// as such a browser would be, and the app must still show, edit and save.
import { expect, test, type Page } from "@playwright/test";
import { firstPage, openFixture, saveAndRead, textRuns } from "./helpers";

/** Removes recent APIs, here and in module workers (run as their first code). */
function stripRecentApis() {
  const strip = () => {
    const drop = (target: object | undefined, names: string[]) => {
      for (const name of names)
        if (target) delete (target as Record<string, unknown>)[name];
    };
    drop(Map.prototype, ["getOrInsert", "getOrInsertComputed"]);
    drop(WeakMap.prototype, ["getOrInsert", "getOrInsertComputed"]);
    drop(Math, ["sumPrecise"]);
    drop(Uint8Array, ["fromBase64", "fromHex"]);
    drop(Uint8Array.prototype, [
      "toBase64",
      "toHex",
      "setFromBase64",
      "setFromHex",
    ]);
    drop(Promise, ["try"]);
    drop(Set.prototype, [
      "intersection",
      "union",
      "difference",
      "symmetricDifference",
      "isSubsetOf",
      "isSupersetOf",
      "isDisjointFrom",
    ]);
    drop(ArrayBuffer.prototype, ["transfer", "transferToFixedLength"]);
    drop(globalThis.Response?.prototype, ["bytes"]);
    drop(globalThis.Blob?.prototype, ["bytes"]);
    // Iterator helpers, and the Iterator global itself.
    const iteratorProto = Object.getPrototypeOf(
      Object.getPrototypeOf([][Symbol.iterator]()),
    ) as object;
    drop(iteratorProto, [
      "map",
      "filter",
      "take",
      "drop",
      "flatMap",
      "reduce",
      "toArray",
      "forEach",
      "some",
      "every",
      "find",
    ]);
    drop(globalThis, ["Iterator"]);
  };
  strip();
  const source = `(${strip.toString()})();`;
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(url: string | URL, options?: WorkerOptions) {
      if (options?.type !== "module") {
        super(url, options);
        return;
      }
      const target = new URL(url, location.href).href;
      const code = `${source}\nawait import(${JSON.stringify(target)});`;
      super(
        URL.createObjectURL(new Blob([code], { type: "text/javascript" })),
        options,
      );
    }
  } as typeof Worker;
}

async function asOldBrowser(page: Page) {
  await page.addInitScript(stripRecentApis);
}

test("the simulation removes the APIs in the page and in workers", async ({
  page,
}) => {
  await asOldBrowser(page);
  await page.goto("/app/");
  const seen = await page.evaluate(async () => {
    const code = `postMessage([typeof Map.prototype.getOrInsertComputed, typeof Math.sumPrecise, typeof globalThis.Iterator].join())`;
    const worker = new Worker(
      URL.createObjectURL(new Blob([code], { type: "text/javascript" })),
      { type: "module" },
    );
    return new Promise<string>((resolve) => {
      worker.onmessage = (e) => resolve(e.data as string);
    });
  });
  expect(seen).toBe("undefined,undefined,undefined");
});

test("an older browser shows, edits and saves a PDF", async ({ page }) => {
  await asOldBrowser(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openFixture(page, "two-pages.pdf");
  await expect(firstPage(page)).toHaveAttribute("data-rendered", "true");
  // Text layer, thumbnails and saving work too.
  await expect(
    firstPage(page).locator(".textLayer span").first(),
  ).toBeVisible();
  await expect(page.locator(".thumbnail").first()).toHaveAttribute(
    "data-rendered",
    "true",
  );
  const saved = await saveAndRead(page);
  expect((await textRuns(saved.bytes)).length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
