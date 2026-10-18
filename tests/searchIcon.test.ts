// Search results (Google) show the site's icon only when the home page links
// a square icon that is a multiple of 48 px and crawlers can fetch it; some
// crawlers also ask for /favicon.ico directly, so it must exist at the root.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const pub = (path: string) => join(root, "public", path);

/** The href and sizes of every <link rel="icon"> of an HTML file. */
function icons(html: string) {
  return [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /rel="icon"/.test(tag))
    .map((tag) => ({
      href: /href="([^"]+)"/.exec(tag)?.[1] ?? "",
      sizes: /sizes="([^"]+)"/.exec(tag)?.[1],
    }));
}

describe.each(["index.html", "app/index.html"])("icons of %s", (file) => {
  const links = icons(readFileSync(join(root, file), "utf8"));

  test("every linked icon exists", () => {
    for (const { href } of links) expect(existsSync(pub(href))).toBe(true);
  });

  test("links a square PNG icon that is a multiple of 48 px", () => {
    const png = links.find(({ href }) => href.endsWith(".png"));
    expect(png).toBeDefined();
    const bytes = readFileSync(pub(png!.href));
    const width = bytes.readUInt32BE(16);
    expect(bytes.readUInt32BE(20)).toBe(width);
    expect(width % 48).toBe(0);
    expect(png!.sizes).toBe(`${width}x${width}`);
  });
});

test("/favicon.ico exists at the root", () => {
  expect(readFileSync(pub("favicon.ico"))).toEqual(
    readFileSync(pub("brand/favicon.ico")),
  );
});

test("robots.txt allows crawling and points to the sitemap", () => {
  const robots = readFileSync(pub("robots.txt"), "utf8");
  expect(robots).toMatch(/^User-agent: \*$/m);
  expect(robots).not.toMatch(/^Disallow: \/\S*/m);
  expect(robots).toMatch(
    /^Sitemap: https:\/\/inkognitopdf\.com\/sitemap\.xml$/m,
  );
});
