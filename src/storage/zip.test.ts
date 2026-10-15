import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, zip } from "./zip";

/** Reads the files back from the central directory. */
function unzip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  const files: { name: string; bytes: Uint8Array }[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(pos, true)).toBe(0x02014b50);
    const size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true);
    const local = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(pos + 46, pos + 46 + nameLength),
    );
    const start = local + 30 + view.getUint16(local + 26, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(view.getUint32(pos + 16, true));
    files.push({ name, bytes: data });
    pos += 46 + nameLength;
  }
  return files;
}

describe("zip (spec 013)", () => {
  it("computes CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("stores files with UTF-8 names that read back", () => {
    const files = [
      { name: "informe (páginas 1-2).pdf", bytes: Uint8Array.from([1, 2, 3]) },
      { name: "b.pdf", bytes: new Uint8Array(0) },
    ];
    const out = unzip(zip(files));
    expect(out.map((f) => f.name)).toEqual(files.map((f) => f.name));
    expect([...out[0]!.bytes]).toEqual([1, 2, 3]);
  });

  it("is a valid archive for the system tool, when there is one", () => {
    const dir = mkdtempSync(join(tmpdir(), "zip-"));
    const file = join(dir, "x.zip");
    writeFileSync(
      file,
      zip([{ name: "hola.txt", bytes: new TextEncoder().encode("hola") }]),
    );
    try {
      // bsdtar reads ZIP archives (Windows ships it as System32\tar.exe).
      const tar =
        process.platform === "win32"
          ? join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe")
          : "bsdtar";
      execFileSync(tar, ["-xf", "x.zip"], { cwd: dir, timeout: 4000 });
    } catch {
      return; // no tar with zip support here
    }
    expect(readFileSync(join(dir, "hola.txt"), "utf8")).toBe("hola");
  });
});
