// Spec 014: opening password-protected PDFs and protecting them, with the
// standard security handler of ISO 32000-2 §7.6 (revisions 2 to 6). Opening
// writes an unencrypted copy that the rest of the app edits as usual; saving
// with a password encrypts the final file with AES-256 (revision 6).
import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObjectStreamParser,
  PDFParser,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  PDFWriter,
  PDFXRefStreamParser,
  PDFDocument,
  type PDFContext,
  type PDFObject,
} from "pdf-lib";
import { t } from "../i18n";
import {
  aesDecrypt,
  aesDecryptRaw,
  aesEncrypt,
  aesEncryptRaw,
  concat,
  md5,
  randomBytes,
  rc4,
  sha,
} from "./crypto/primitives";

export class WrongPasswordError extends Error {
  constructor() {
    super(t("protect.wrongPassword"));
    this.name = "WrongPasswordError";
  }
}

export class UnsupportedEncryptionError extends Error {
  constructor() {
    super(t("protect.unsupported"));
    this.name = "UnsupportedEncryptionError";
  }
}

const PAD = Uint8Array.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff,
  0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const name = (key: string) => PDFName.of(key);
const latin1 = (text: string) =>
  Uint8Array.from([...text].map((c) => c.charCodeAt(0) & 0xff));

/** True when the file has an /Encrypt entry in a trailer. */
export function isEncrypted(bytes: Uint8Array): boolean {
  // The entry is in the trailer or in a cross-reference stream dictionary,
  // both written as plain text.
  const text = new TextDecoder("latin1").decode(bytes);
  return /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/.test(text);
}

/** Password bytes for revisions 2–4: PDFDocEncoding, padded to 32 bytes. */
function padPassword(password: string): Uint8Array {
  const bytes = latin1(password).subarray(0, 32);
  return concat(bytes, PAD.subarray(0, 32 - bytes.length));
}

/** Password bytes for revisions 5–6: UTF-8 of the normalized text, ≤ 127. */
const utf8Password = (password: string) =>
  new TextEncoder().encode(password.normalize("NFKC")).subarray(0, 127);

/** The hash of revisions 5 (SHA-256) and 6 (algorithm 2.B). */
async function hash2B(
  revision: number,
  password: Uint8Array,
  salt: Uint8Array,
  userKey: Uint8Array = new Uint8Array(0),
): Promise<Uint8Array> {
  let k: Uint8Array = await sha(256, concat(password, salt, userKey));
  if (revision === 5) return k;
  let e: Uint8Array = new Uint8Array(0);
  for (let i = 0; i < 64 || e[e.length - 1]! > i - 32; i++) {
    const block = concat(password, k, userKey);
    const k1 = new Uint8Array(block.length * 64);
    for (let j = 0; j < 64; j++) k1.set(block, j * block.length);
    e = await aesEncryptRaw(k.subarray(0, 16), k.subarray(16, 32), k1);
    let mod = 0;
    for (let j = 0; j < 16; j++) mod += e[j]!;
    k = await sha(([256, 384, 512] as const)[mod % 3]!, e);
  }
  return k.subarray(0, 32);
}

type Method = "none" | "rc4" | "aes128" | "aes256";

interface Security {
  key: Uint8Array;
  strings: Method;
  streams: Method;
  encryptMetadata: boolean;
}

const bytesOf = (obj: PDFObject | undefined): Uint8Array => {
  if (obj instanceof PDFString || obj instanceof PDFHexString)
    return obj.asBytes();
  return new Uint8Array(0);
};
const numberOf = (obj: PDFObject | undefined, fallback: number) =>
  obj instanceof PDFNumber ? obj.asNumber() : fallback;

/** The file key, from the user or the owner password; null when wrong. */
async function fileKey(
  encrypt: PDFDict,
  id0: Uint8Array,
  password: string,
): Promise<Uint8Array | null> {
  const get = (key: string) => encrypt.lookup(name(key));
  const revision = numberOf(get("R"), 0);
  const o = bytesOf(get("O"));
  const u = bytesOf(get("U"));
  if (revision >= 5) {
    const pwd = utf8Password(password);
    const u48 = u.subarray(0, 48);
    if (
      equal(await hash2B(revision, pwd, u.subarray(32, 40)), u.subarray(0, 32))
    ) {
      const k = await hash2B(revision, pwd, u.subarray(40, 48));
      return aesDecryptRaw(k, new Uint8Array(16), bytesOf(get("UE")));
    }
    if (
      equal(
        await hash2B(revision, pwd, o.subarray(32, 40), u48),
        o.subarray(0, 32),
      )
    ) {
      const k = await hash2B(revision, pwd, o.subarray(40, 48), u48);
      return aesDecryptRaw(k, new Uint8Array(16), bytesOf(get("OE")));
    }
    return null;
  }
  const length = revision === 2 ? 5 : numberOf(get("Length"), 40) / 8;
  const p = numberOf(get("P"), -1);
  const encryptMetadata = get("EncryptMetadata") !== PDFBool.False;
  const keyFor = (padded: Uint8Array) => {
    const pBytes = new Uint8Array(4);
    new DataView(pBytes.buffer).setInt32(0, p, true);
    let h = md5(
      concat(
        padded,
        o.subarray(0, 32),
        pBytes,
        id0,
        revision >= 4 && !encryptMetadata
          ? Uint8Array.from([255, 255, 255, 255])
          : new Uint8Array(0),
      ),
    );
    if (revision >= 3)
      for (let i = 0; i < 50; i++) h = md5(h.subarray(0, length));
    return h.subarray(0, length);
  };
  const xorKey = (key: Uint8Array, i: number) => key.map((b) => b ^ i);
  const isUser = (key: Uint8Array) => {
    if (revision === 2) return equal(rc4(key, PAD), u.subarray(0, 32));
    let x = rc4(key, md5(concat(PAD, id0)));
    for (let i = 1; i <= 19; i++) x = rc4(xorKey(key, i), x);
    return equal(x, u.subarray(0, 16));
  };
  const asUser = keyFor(padPassword(password));
  if (isUser(asUser)) return asUser;
  // As the owner password: it decrypts /O into the user password.
  let k = md5(padPassword(password));
  if (revision >= 3) for (let i = 0; i < 50; i++) k = md5(k);
  const ownerKey = k.subarray(0, length);
  let user = o.subarray(0, 32);
  if (revision === 2) user = rc4(ownerKey, user);
  else for (let i = 19; i >= 0; i--) user = rc4(xorKey(ownerKey, i), user);
  const asOwner = keyFor(user);
  return isUser(asOwner) ? asOwner : null;
}

function equal(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function securityOf(encrypt: PDFDict): Omit<Security, "key"> {
  const filter = encrypt.lookup(name("Filter"));
  const v = numberOf(encrypt.lookup(name("V")), 0);
  const r = numberOf(encrypt.lookup(name("R")), 0);
  if (
    filter !== name("Standard") ||
    r < 2 ||
    r > 6 ||
    ![1, 2, 4, 5].includes(v)
  )
    throw new UnsupportedEncryptionError();
  const encryptMetadata =
    encrypt.lookup(name("EncryptMetadata")) !== PDFBool.False;
  if (v < 4) return { strings: "rc4", streams: "rc4", encryptMetadata };
  const filters = encrypt.lookup(name("CF"));
  const method = (key: string): Method => {
    const which = encrypt.lookup(name(key));
    if (!(which instanceof PDFName) || which === name("Identity"))
      return "none";
    const cf = filters instanceof PDFDict ? filters.lookup(which) : undefined;
    const cfm = cf instanceof PDFDict ? cf.lookup(name("CFM")) : undefined;
    if (cfm === name("V2")) return "rc4";
    if (cfm === name("AESV2")) return "aes128";
    if (cfm === name("AESV3")) return "aes256";
    if (cfm === undefined || cfm === name("None")) return "none";
    throw new UnsupportedEncryptionError();
  };
  return { strings: method("StrF"), streams: method("StmF"), encryptMetadata };
}

/** The key of one object (algorithm 1; revision 5–6 use the file key). */
function objectKey(security: Security, method: Method, ref: PDFRef) {
  if (method === "aes256") return security.key;
  const n = ref.objectNumber;
  const g = ref.generationNumber;
  const salt = method === "aes128" ? latin1("sAlT") : new Uint8Array(0);
  const h = md5(
    concat(
      security.key,
      Uint8Array.from([
        n & 255,
        (n >> 8) & 255,
        (n >> 16) & 255,
        g & 255,
        (g >> 8) & 255,
      ]),
      salt,
    ),
  );
  return h.subarray(0, Math.min(security.key.length + 5, 16));
}

async function decryptData(
  security: Security,
  method: Method,
  ref: PDFRef,
  data: Uint8Array,
): Promise<Uint8Array> {
  if (method === "none") return data;
  const key = objectKey(security, method, ref);
  if (method === "rc4") return rc4(key, data);
  if (data.length < 16) return new Uint8Array(0);
  return aesDecrypt(key, data.subarray(0, 16), data.subarray(16));
}

const isSignature = (dict: PDFDict) =>
  dict.lookup(name("Type")) === name("Sig") || dict.has(name("ByteRange"));

/** Applies `change` to every string inside `obj` (dictionaries, arrays). */
async function mapStrings(
  obj: PDFObject,
  change: (bytes: Uint8Array) => Promise<Uint8Array>,
): Promise<void> {
  const replace = async (value: PDFObject) =>
    value instanceof PDFString || value instanceof PDFHexString
      ? PDFHexString.of(hex(await change(value.asBytes())))
      : (await mapStrings(value, change), null);
  if (obj instanceof PDFDict) {
    const signature = isSignature(obj);
    for (const [key, value] of obj.entries()) {
      // The signature value is never encrypted (ISO 32000-2 §7.6.1).
      if (signature && key === name("Contents")) continue;
      const next = await replace(value);
      if (next) obj.set(key, next);
    }
  } else if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const next = await replace(obj.get(i));
      if (next) obj.set(i, next);
    }
  }
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const ENDOBJ = Uint8Array.from([101, 110, 100, 111, 98, 106]);

/**
 * Parses the file keeping object streams as they are (they are encrypted
 * as a whole), and records the order in which objects appear.
 */
async function parseRaw(bytes: Uint8Array) {
  const parser = PDFParser.forBytesWithOptions(bytes, Infinity, false, true);
  const order = new Map<string, number>();
  let seq = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = parser as any;
  p.parseIndirectObject = async function () {
    const ref: PDFRef = this.parseIndirectObjectHeader();
    this.skipWhitespaceAndComments();
    const object: PDFObject = this.parseObject();
    this.skipWhitespaceAndComments();
    this.matchKeyword(ENDOBJ);
    if (
      object instanceof PDFRawStream &&
      object.dict.lookup(name("Type")) === name("XRef")
    )
      PDFXRefStreamParser.forStream(object).parseIntoContext();
    else {
      this.context.assign(ref, object);
      order.set(ref.tag, seq++);
    }
    return ref;
  };
  const context: PDFContext = await parser.parseDocument();
  return { context, order };
}

export interface Unlocked {
  bytes: Uint8Array;
  /** The file asked for a password to open it. */
  hadUserPassword: boolean;
}

/**
 * An unencrypted copy of an encrypted PDF, opened with the user or the
 * owner password ("" for files that only restrict permissions).
 */
export async function decryptPdf(
  bytes: Uint8Array,
  password: string,
): Promise<Unlocked> {
  const { context, order } = await parseRaw(bytes);
  const encryptRef = context.trailerInfo.Encrypt;
  // "/Encrypt" was only text somewhere else in the file.
  if (!encryptRef) return { bytes, hadUserPassword: false };
  const encrypt = context.lookup(encryptRef);
  if (!(encrypt instanceof PDFDict)) throw new UnsupportedEncryptionError();
  const methods = securityOf(encrypt);
  const ids = context.lookup(context.trailerInfo.ID);
  const id0 = ids instanceof PDFArray ? bytesOf(ids.get(0)) : new Uint8Array();
  const key = await fileKey(encrypt, id0, password);
  if (!key) throw new WrongPasswordError();
  const hadUserPassword =
    password === "" ? false : !(await fileKey(encrypt, id0, ""));
  const security: Security = { key, ...methods };

  const objectStreams: [PDFRef, PDFRawStream][] = [];
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (ref === encryptRef || obj === encrypt) continue;
    const strings = (data: Uint8Array) =>
      decryptData(security, security.strings, ref, data);
    if (obj instanceof PDFRawStream) {
      await mapStrings(obj.dict, strings);
      const type = obj.dict.lookup(name("Type"));
      const plain =
        type === name("Metadata") && !security.encryptMetadata
          ? obj.contents
          : await decryptData(security, security.streams, ref, obj.contents);
      const stream = PDFRawStream.of(obj.dict, plain);
      context.assign(ref, stream);
      if (type === name("ObjStm")) objectStreams.push([ref, stream]);
    } else await mapStrings(obj, strings);
  }

  // Objects inside object streams, unless a later revision replaced them.
  for (const [ref, stream] of objectStreams) {
    const at = order.get(ref.tag) ?? 0;
    const newer = context
      .enumerateIndirectObjects()
      .filter(([r]) => (order.get(r.tag) ?? -1) > at);
    await PDFObjectStreamParser.forStream(stream).parseIntoContext();
    for (const [r, o] of newer) context.assign(r, o);
    context.delete(ref);
  }
  if (encryptRef instanceof PDFRef) context.delete(encryptRef);
  context.trailerInfo.Encrypt = undefined;
  // The trailer /Size follows the objects that are left.
  context.largestObjectNumber = Math.max(
    0,
    ...context.enumerateIndirectObjects().map(([r]) => r.objectNumber),
  );
  return {
    bytes: await PDFWriter.forContext(context, Infinity).serializeToBuffer(),
    hadUserPassword,
  };
}

export interface Protection {
  password: string;
  allowPrint: boolean;
  allowCopy: boolean;
}

/** /P: printing (bits 3, 12) and copying (bit 5) as chosen, the rest allowed. */
export function permissions(p: Pick<Protection, "allowPrint" | "allowCopy">) {
  let bits = ~0 & ~(4 | 16 | 2048);
  if (p.allowPrint) bits |= 4 | 2048;
  if (p.allowCopy) bits |= 16;
  return bits | 0;
}

/**
 * The PDF encrypted with AES-256 (revision 6). Without restrictions the
 * owner password is the same; with them, a random one nobody knows.
 */
export async function encryptPdf(
  bytes: Uint8Array,
  protection: Protection,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const key = randomBytes(32);
  const p = permissions(protection);
  const restricted = !protection.allowPrint || !protection.allowCopy;
  const user = utf8Password(protection.password);
  const owner = restricted ? randomBytes(32) : user;

  const userSalt = randomBytes(8);
  const userKeySalt = randomBytes(8);
  const u = concat(await hash2B(6, user, userSalt), userSalt, userKeySalt);
  const ue = await aesEncryptRaw(
    await hash2B(6, user, userKeySalt),
    new Uint8Array(16),
    key,
  );
  const ownerSalt = randomBytes(8);
  const ownerKeySalt = randomBytes(8);
  const o = concat(
    await hash2B(6, owner, ownerSalt, u),
    ownerSalt,
    ownerKeySalt,
  );
  const oe = await aesEncryptRaw(
    await hash2B(6, owner, ownerKeySalt, u),
    new Uint8Array(16),
    key,
  );
  const perms = new Uint8Array(16);
  const view = new DataView(perms.buffer);
  view.setInt32(0, p, true);
  view.setUint32(4, 0xffffffff, true);
  perms.set(latin1("Tadb"), 8);
  perms.set(randomBytes(4), 12);
  const permsEnc = await aesEncryptRaw(key, new Uint8Array(16), perms);

  // Strings and streams, each with a random IV.
  const encryptData = async (data: Uint8Array) =>
    concat(...(await withIv(key, data)));
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      await mapStrings(obj.dict, encryptData);
      const contents =
        obj instanceof PDFRawStream ? obj.contents : obj.getContents();
      ctx.assign(ref, PDFRawStream.of(obj.dict, await encryptData(contents)));
    } else await mapStrings(obj, encryptData);
  }

  const encrypt = ctx.obj({
    Filter: "Standard",
    V: 5,
    R: 6,
    Length: 256,
    CF: { StdCF: { AuthEvent: "DocOpen", CFM: "AESV3", Length: 32 } },
    StmF: "StdCF",
    StrF: "StdCF",
    P: p,
    EncryptMetadata: true,
  });
  for (const [k, value] of [
    ["O", o],
    ["U", u],
    ["OE", oe],
    ["UE", ue],
    ["Perms", permsEnc],
  ] as const)
    encrypt.set(name(k), PDFHexString.of(hex(value)));
  ctx.trailerInfo.Encrypt = ctx.register(encrypt);
  if (!(ctx.lookup(ctx.trailerInfo.ID) instanceof PDFArray)) {
    const id = PDFHexString.of(hex(randomBytes(16)));
    ctx.trailerInfo.ID = ctx.obj([id, id]);
  }
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

async function withIv(key: Uint8Array, data: Uint8Array) {
  const iv = randomBytes(16);
  return [iv, await aesEncrypt(key, iv, data)] as const;
}
