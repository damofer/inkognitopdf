// The app loads the legacy build of pdf.js only (see src/viewer/pdfjs.ts): the
// modern one leaves pages blank in browsers a few versions old. Importing both
// would also load pdf.js twice.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("pdf.js build", () => {
  it("the app imports pdf.js only from its legacy build", () => {
    const modern = sources("src").filter((path) =>
      /from\s+["']pdfjs-dist(\/build\/[^"']*)?["']/.test(
        readFileSync(path, "utf8"),
      ),
    );
    expect(modern).toEqual([]);
  });
});
