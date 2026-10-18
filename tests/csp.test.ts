// Spec 036: the hosted site, the Docker image and the e2e preview server send
// the same Content-Security-Policy.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CSP } from "../src/csp";

const root = join(import.meta.dirname, "..");

describe("Content-Security-Policy", () => {
  it("only lets the page connect to itself and, after consent, Google Analytics", () => {
    const connect = CSP.split("; ").find((d) => d.startsWith("connect-src"))!;
    const sources = connect.split(" ").slice(1);
    expect(sources).toContain("'self'");
    for (const source of sources.filter((s) => s.startsWith("https://")))
      expect(source).toMatch(
        /^https:\/\/(\*\.(google-analytics|analytics\.google|googletagmanager)\.com|(firebase|firebaseinstallations)\.googleapis\.com)$/,
      );
    expect(sources).not.toContain("*");
    expect(sources).not.toContain("https:");
  });

  it("firebase.json sends it on every path", async () => {
    const config = JSON.parse(
      await readFile(join(root, "firebase.json"), "utf8"),
    ) as {
      hosting: {
        headers: {
          source: string;
          headers: { key: string; value: string }[];
        }[];
      };
    };
    const all = config.hosting.headers.find((h) => h.source === "**");
    expect(all?.headers).toContainEqual({
      key: "Content-Security-Policy",
      value: CSP,
    });
  });

  it("the Docker image's nginx sends it in every location that sets headers", async () => {
    const conf = await readFile(join(root, "docker", "nginx.conf"), "utf8");
    expect(conf).toContain(`set $csp "${CSP}";`);
    const cache = conf.match(/add_header Cache-Control/g)!.length;
    const csp = conf.match(
      /add_header Content-Security-Policy \$csp always;/g,
    )!.length;
    // One per location, plus the server's own.
    expect(csp).toBe(cache + 1);
  });
});
