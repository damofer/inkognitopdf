// Spec 014: opening encrypted PDFs (RC4 40/128, AES-128, AES-256, user or
// owner password) and saving with AES-256; checked with pdf.js and qpdf.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { md5, rc4 } from "../src/engine/crypto/primitives";
import {
  WrongPasswordError,
  decryptPdf,
  encryptPdf,
  isEncrypted,
  permissions,
} from "../src/engine/pdfCrypto";
import { fileContains, pageText, qpdfCheck, qpdfPath } from "./helpers";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const ascii = (s: string) => new TextEncoder().encode(s);

async function sample() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of ["Contrato secreto 7781", "Segunda pagina 7782"]) {
    const page = doc.addPage([300, 300]);
    page.drawText(text, { x: 30, y: 250, size: 14, font });
  }
  const field = doc.getForm().createTextField("titular");
  field.setText("Valor 7783");
  field.addToPage(doc.getPage(0), { x: 30, y: 100, width: 150, height: 20 });
  doc.setTitle("Titulo 7784");
  return doc.save();
}

/** Text of page 1 as pdf.js reads it with the password. */
async function readWith(bytes: Uint8Array, password?: string) {
  const doc = await getDocument({ data: bytes.slice(), password }).promise;
  const text = (await (await doc.getPage(1)).getTextContent()).items
    .map((i) => ("str" in i ? i.str : ""))
    .join(" ");
  const perms = await doc.getPermissions();
  await doc.loadingTask.destroy();
  return { text, perms };
}

describe("primitives (spec 014)", () => {
  it("MD5 and RC4 match their reference vectors", () => {
    expect(hex(md5(new Uint8Array()))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(hex(md5(ascii("abc")))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(hex(md5(new Uint8Array(1000).fill(97)))).toBe(
      "cabe45dcc9ae5b66ba86600cca6b8ba8",
    );
    expect(hex(rc4(ascii("Key"), ascii("Plaintext")))).toBe(
      "bbf316e8d940af0ad3",
    );
  });

  it("permissions keep the required bits and clear only what is denied", () => {
    expect(permissions({ allowPrint: true, allowCopy: true })).toBe(-1);
    const none = permissions({ allowPrint: false, allowCopy: false });
    expect(none & 4).toBe(0);
    expect(none & 16).toBe(0);
    expect(none & 2048).toBe(0);
    expect(none & (8 | 32 | 256 | 512 | 1024)).toBe(8 | 32 | 256 | 512 | 1024);
  });
});

describe("saving with a password (spec 014)", () => {
  it("AES-256: pdf.js and qpdf need the password; nothing is readable without it", async () => {
    const plain = await sample();
    const bytes = await encryptPdf(plain, {
      password: "clave ñandú",
      allowPrint: true,
      allowCopy: true,
    });
    expect(isEncrypted(bytes)).toBe(true);
    expect(isEncrypted(plain)).toBe(false);
    await expect(readWith(bytes)).rejects.toThrow(/password/i);
    await expect(readWith(bytes, "otra")).rejects.toThrow(/password/i);
    expect((await readWith(bytes, "clave ñandú")).text).toContain(
      "Contrato secreto 7781",
    );
    const raw = Buffer.from(bytes).toString("latin1");
    // Not hex digits alone: encrypted strings are written in hex.
    for (const secret of ["Contrato secreto", "Valor 7783", "Titulo 7784"])
      expect(raw.includes(secret)).toBe(false);
    if (qpdfPath) {
      const dir = await mkdtemp(join(tmpdir(), "protect-"));
      const file = join(dir, "x.pdf");
      await writeFile(file, bytes);
      const { stdout } = await promisify(execFile)(qpdfPath, [
        "--check",
        "--password=clave ñandú",
        file,
      ]);
      expect(stdout).toMatch(/R = 6/);
      expect(stdout).toMatch(/No syntax or stream encoding errors/);
    }
  });

  it("restrictions are written and the owner password is not the user's", async () => {
    const bytes = await encryptPdf(await sample(), {
      password: "abc",
      allowPrint: false,
      allowCopy: false,
    });
    const { perms } = await readWith(bytes, "abc");
    // pdf.js: 4 = print, 16 = copy, 2048 = high-quality print.
    expect(perms).not.toContain(4);
    expect(perms).not.toContain(16);
    expect(perms).toContain(8);
  });

  it("our own reader opens what we write, and refuses a wrong password", async () => {
    const bytes = await encryptPdf(await sample(), {
      password: "secreta",
      allowPrint: true,
      allowCopy: true,
    });
    await expect(decryptPdf(bytes, "mala")).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    const open = await decryptPdf(bytes, "secreta");
    expect(open.hadUserPassword).toBe(true);
    expect(isEncrypted(open.bytes)).toBe(false);
    expect(await pageText(open.bytes, 2)).toBe("Segunda pagina 7782");
    expect(await fileContains(open.bytes, "Valor 7783")).toBe(true);
    const doc = await PDFDocument.load(open.bytes);
    expect(doc.getTitle()).toBe("Titulo 7784");
    expect(doc.getForm().getTextField("titular").getText()).toBe("Valor 7783");
    if (qpdfPath) await qpdfCheck(open.bytes);
  });
});

describe.skipIf(!qpdfPath)("opening files encrypted by qpdf (spec 014)", () => {
  async function qpdfEncrypt(
    plain: Uint8Array,
    args: string[],
  ): Promise<Uint8Array> {
    const dir = await mkdtemp(join(tmpdir(), "protect-"));
    const input = join(dir, "in.pdf");
    const output = join(dir, "out.pdf");
    await writeFile(input, plain);
    await promisify(execFile)(qpdfPath!, [input, ...args, output]);
    return new Uint8Array(await readFile(output));
  }

  const cases: [string, string[]][] = [
    [
      "RC4 40 bits (R2)",
      ["--allow-weak-crypto", "--encrypt", "usuario", "dueno", "40", "--"],
    ],
    [
      "RC4 128 bits (R3)",
      [
        "--allow-weak-crypto",
        "--encrypt",
        "usuario",
        "dueno",
        "128",
        "--use-aes=n",
        "--",
      ],
    ],
    [
      "AES-128 (R4) with object streams",
      [
        "--object-streams=generate",
        "--encrypt",
        "usuario",
        "dueno",
        "128",
        "--use-aes=y",
        "--",
      ],
    ],
    [
      "AES-256 (R6) with object streams",
      [
        "--object-streams=generate",
        "--encrypt",
        "usuario",
        "dueno",
        "256",
        "--",
      ],
    ],
  ];

  for (const [label, args] of cases)
    it(`${label}: user and owner passwords`, async () => {
      const bytes = await qpdfEncrypt(await sample(), args);
      expect(isEncrypted(bytes)).toBe(true);
      await expect(decryptPdf(bytes, "")).rejects.toBeInstanceOf(
        WrongPasswordError,
      );
      for (const password of ["usuario", "dueno"]) {
        const open = await decryptPdf(bytes, password);
        expect(open.hadUserPassword).toBe(true);
        expect(await pageText(open.bytes, 1)).toBe("Contrato secreto 7781");
        const doc = await PDFDocument.load(open.bytes);
        expect(doc.getTitle()).toBe("Titulo 7784");
        expect(doc.getForm().getTextField("titular").getText()).toBe(
          "Valor 7783",
        );
        await qpdfCheck(open.bytes);
      }
    });

  it("a file with only an owner password opens without asking", async () => {
    const bytes = await qpdfEncrypt(await sample(), [
      "--encrypt",
      "",
      "dueno",
      "256",
      "--print=none",
      "--",
    ]);
    const open = await decryptPdf(bytes, "");
    expect(open.hadUserPassword).toBe(false);
    expect(await pageText(open.bytes, 1)).toBe("Contrato secreto 7781");
  });
});
