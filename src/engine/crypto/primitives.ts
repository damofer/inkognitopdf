// Primitives for PDF encryption (spec 014). WebCrypto has SHA-2 and AES but
// not MD5 or RC4, which the older PDF security handlers use: those two are
// written here, following RFC 1321 and the public description of RC4.

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
];
const K = Array.from(
  { length: 64 },
  (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0,
);

/** MD5 digest (RFC 1321). */
export function md5(data: Uint8Array): Uint8Array {
  const bitLength = data.length * 8;
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) * 64);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const m = new Uint32Array(16);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) m[i] = view.getUint32(offset + i * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + K[i]! + m[g]!) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << S[i]!) | (sum >>> (32 - S[i]!)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  const o = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => o.setUint32(i * 4, v, true));
  return out;
}

/** RC4 with the given key; encrypting and decrypting are the same. */
export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[k] = data[k]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const randomBytes = (n: number) =>
  crypto.getRandomValues(new Uint8Array(n));

const buffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;

export async function sha(
  bits: 256 | 384 | 512,
  data: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest(`SHA-${bits}`, buffer(data)),
  );
}

const aesKey = (key: Uint8Array, usage: KeyUsage) =>
  crypto.subtle.importKey("raw", buffer(key), "AES-CBC", false, [usage]);

/** AES-CBC with PKCS#7 padding. */
export async function aesEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: buffer(iv) },
      await aesKey(key, "encrypt"),
      buffer(data),
    ),
  );
}

/** AES-CBC without padding: `data` is a whole number of blocks. */
export async function aesEncryptRaw(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  // WebCrypto always pads: the extra last block is dropped.
  return (await aesEncrypt(key, iv, data)).subarray(0, data.length);
}

/**
 * AES-CBC decryption that does not check the padding (`data` is a whole
 * number of blocks). A block of valid padding, encrypted after the last one,
 * is appended so that WebCrypto accepts any content.
 */
export async function aesDecryptRaw(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  if (data.length === 0) return data;
  const last = data.subarray(data.length - 16);
  const pad = await aesEncrypt(key, last, new Uint8Array(0));
  const plain = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv: buffer(iv) },
    await aesKey(key, "decrypt"),
    buffer(concat(data, pad)),
  );
  return new Uint8Array(plain);
}

/** AES-CBC decryption that removes the PKCS#7 padding when it is valid. */
export async function aesDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const whole = data.subarray(0, data.length - (data.length % 16));
  const plain = await aesDecryptRaw(key, iv, whole);
  const n = plain[plain.length - 1] ?? 0;
  if (n >= 1 && n <= 16 && plain.length >= n)
    if (plain.subarray(plain.length - n).every((b) => b === n))
      return plain.subarray(0, plain.length - n);
  return plain;
}
