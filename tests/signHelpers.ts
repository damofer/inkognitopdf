// Independent checks of PDF signatures with OpenSSL (spec 004, D5).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const candidates = [
  process.env.OPENSSL,
  "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
  "C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
  "/usr/bin/openssl",
  "/usr/local/bin/openssl",
  "/opt/homebrew/bin/openssl",
].filter((p): p is string => !!p);

export const opensslPath = candidates.find((p) => existsSync(p));

export async function openssl(args: string[], cwd?: string) {
  if (!opensslPath) throw new Error("openssl not found");
  try {
    const { stdout, stderr } = await promisify(execFile)(opensslPath, args, {
      cwd,
      encoding: "buffer",
    });
    return { ok: true, out: `${stdout.toString()}${stderr.toString()}` };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; message: string };
    return {
      ok: false,
      out: `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? err.message}`,
    };
  }
}

export interface PdfSignature {
  byteRange: [number, number, number, number];
  cms: Uint8Array;
  /** The signed bytes (both ranges, concatenated). */
  data: Uint8Array;
}

/** Every /ByteRange + /Contents pair in the file, in file order. */
export function pdfSignatures(bytes: Uint8Array): PdfSignature[] {
  const text = new TextDecoder("latin1").decode(bytes);
  const out: PdfSignature[] = [];
  for (const m of text.matchAll(
    /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g,
  )) {
    const byteRange = m.slice(1, 5).map(Number) as PdfSignature["byteRange"];
    const [a, b, c, d] = byteRange;
    const hex = text.slice(a + b + 1, c - 1).replace(/0+$/, "");
    const cms = new Uint8Array(
      (hex.length % 2 ? hex + "0" : hex)
        .match(/../g)!
        .map((h) => parseInt(h, 16)),
    );
    const data = new Uint8Array(b + d);
    data.set(bytes.subarray(a, a + b), 0);
    data.set(bytes.subarray(c, c + d), b);
    out.push({ byteRange, cms, data });
  }
  return out;
}

export async function tempDir() {
  return mkdtemp(join(tmpdir(), "pdfcraft-sign-"));
}

export function pem(der: Uint8Array, label = "CERTIFICATE") {
  const b64 = Buffer.from(der)
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n");
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

/** `openssl cms -verify` of one signature; `ca` (PEM) checks the chain too. */
export async function opensslVerify(sig: PdfSignature, ca?: string) {
  const dir = await tempDir();
  await writeFile(join(dir, "sig.der"), sig.cms);
  await writeFile(join(dir, "data.bin"), sig.data);
  const args = [
    "cms",
    "-verify",
    "-binary",
    "-inform",
    "DER",
    "-in",
    "sig.der",
    "-content",
    "data.bin",
    "-out",
    "out.bin",
  ];
  if (ca) {
    await writeFile(join(dir, "ca.pem"), ca);
    args.push("-CAfile", "ca.pem", "-purpose", "any");
  } else args.push("-noverify");
  return openssl(args, dir);
}
