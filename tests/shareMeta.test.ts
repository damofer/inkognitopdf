// Link previews (WhatsApp, Telegram, X, Facebook, LinkedIn): the Open Graph
// and Twitter tags must be in the static HTML of both pages, since crawlers
// do not run scripts, and the image must be small enough for WhatsApp.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const SITE = "https://inkognitopdf.web.app";

/** Contents of every <meta property|name="key"> of an HTML file. */
function metas(html: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/g)) {
    const key = /(?:property|name)="([^"]+)"/.exec(tag)?.[1];
    const content = /content="([^"]*)"/.exec(tag)?.[1];
    if (key && content !== undefined)
      found.set(key, [...(found.get(key) ?? []), content]);
  }
  return found;
}

/** Width and height from the IHDR chunk of a PNG. */
function pngSize(file: string) {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe.each([
  ["landing", "index.html", `${SITE}/`],
  ["app", "app/index.html", `${SITE}/app/`],
])("share tags of the %s", (_name, file, url) => {
  const tags = metas(readFileSync(join(root, file), "utf8"));
  const one = (key: string) => tags.get(key)?.[0];

  test("Open Graph tags with absolute URLs", () => {
    expect(one("og:type")).toBe("website");
    expect(one("og:site_name")).toBe("InkognitoPDF");
    expect(one("og:title")).toMatch(/InkognitoPDF/);
    expect(one("og:url")).toBe(url);
    expect(one("og:image")).toBe(`${SITE}/brand/og-image.png`);
    expect(one("og:image:secure_url")).toBe(`${SITE}/brand/og-image.png`);
    expect(one("og:image:type")).toBe("image/png");
    expect(one("og:image:width")).toBe("1200");
    expect(one("og:image:height")).toBe("630");
    expect(one("og:image:alt")).toBeTruthy();
    expect(one("og:locale")).toBe("es_ES");
    expect(one("og:locale:alternate")).toBe("en_US");
    for (const image of tags.get("og:image")!)
      expect(image).toMatch(/^https:\/\//);
  });

  test("Twitter card and description match", () => {
    expect(one("twitter:card")).toBe("summary_large_image");
    expect(one("twitter:title")).toBe(one("og:title"));
    expect(one("twitter:image")).toBe(one("og:image"));
    expect(one("twitter:description")).toBe(one("og:description"));
    expect(one("description")).toBe(one("og:description"));
  });
});

test.each([
  ["og-image.png", 1200, 630],
  ["og-image-square.png", 600, 600],
])("%s is %ix%i and under 300 KB", (name, width, height) => {
  const file = join(root, "public", "brand", name);
  expect(pngSize(file)).toEqual({ width, height });
  expect(statSync(file).size).toBeLessThan(300 * 1024);
});
