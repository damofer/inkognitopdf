// Spec 040: trusted timestamps (RFC 3161, PAdES B-T), checked with OpenSSL,
// and the relay that forwards timestamp requests.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as pkijs from "pkijs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { relay, UPSTREAM } from "../functions/relay.js";
import { createSelfSigned } from "../src/sign/certificates";
import { signPdf } from "../src/sign/pades";
import {
  OID_TIMESTAMP_TOKEN,
  TSA_URL,
  TimestampError,
  tsaTimestamper,
} from "../src/sign/timestamp";
import { verifyPdf } from "../src/sign/verify";
import { fakeTsa, type FakeTsa } from "./fakeTsa";
import { fixture, testDeps } from "./helpers";
import {
  openssl,
  opensslPath,
  opensslVerify,
  pdfSignatures,
  pem,
  tempDir,
} from "./signHelpers";

const buffer = (b: Uint8Array) =>
  b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

/** fetch answering timestamp requests with `tsa`, as the relay would. */
function serve(tsa: FakeTsa) {
  const calls: { url: string; type: string | null; size: number }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const body = new Uint8Array(init.body as ArrayBuffer);
    calls.push({
      url,
      type: new Headers(init.headers).get("Content-Type"),
      size: body.length,
    });
    return new Response(buffer(await tsa.respond(body)), {
      headers: { "Content-Type": "application/timestamp-reply" },
    });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

async function signed(timestamp: Parameters<typeof signPdf>[1]["timestamp"]) {
  return signPdf(await fixture("simple-text.pdf"), {
    identity: await createSelfSigned({ commonName: "Ana Pérez" }),
    name: "Ana Pérez",
    loadFont: testDeps.loadFont,
    date: new Date("2026-10-14T12:00:00Z"),
    timestamp,
  });
}

/** The timestamp token inside the PDF's only signature. */
function tokenOf(pdf: Uint8Array) {
  const [sig] = pdfSignatures(pdf);
  const info = pkijs.ContentInfo.fromBER(buffer(sig!.cms));
  const signerInfo = new pkijs.SignedData({ schema: info.content })
    .signerInfos[0]!;
  const attribute = signerInfo.unsignedAttrs?.attributes.find(
    (a) => a.type === OID_TIMESTAMP_TOKEN,
  );
  return {
    sig: sig!,
    signature: signerInfo.signature.valueBlock.valueHexView,
    token: attribute
      ? new Uint8Array(attribute.values[0]!.toBER(false))
      : undefined,
  };
}

describe("trusted timestamp", () => {
  it("asks the relay with only a hash and puts the token in the signature", async () => {
    const time = new Date("2026-10-18T16:00:00Z");
    const tsa = await fakeTsa({ name: "Sellos de Prueba", time });
    const calls = serve(tsa);
    const pdf = await signed(tsaTimestamper("/tsa"));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "/tsa",
      type: "application/timestamp-query",
    });
    expect(calls[0]!.size).toBeLessThan(120); // a hash, not the document

    const [report] = await verifyPdf(pdf);
    expect(report!.integrity).toBe("valid");
    expect(report!.timestamp).toEqual({
      time,
      authority: "Sellos de Prueba",
      valid: true,
    });
  });

  it.skipIf(!opensslPath)(
    "OpenSSL accepts the signature and the token for its signature value",
    async () => {
      const tsa = await fakeTsa();
      serve(tsa);
      const { sig, signature, token } = tokenOf(await signed(tsaTimestamper()));
      expect((await opensslVerify(sig)).out).toMatch(/Verification successful/);

      const dir = await tempDir();
      await writeFile(join(dir, "token.der"), token!);
      await writeFile(join(dir, "tsa.pem"), pem(tsa.certificate));
      const digest = Buffer.from(
        await crypto.subtle.digest("SHA-256", buffer(signature)),
      ).toString("hex");
      const result = await openssl(
        [
          "ts",
          "-verify",
          "-token_in",
          "-in",
          "token.der",
          "-digest",
          digest,
          "-CAfile",
          "tsa.pem",
        ],
        dir,
      );
      expect(result.out).toMatch(/Verification: OK/);
    },
  );

  it("without a timestamp the signature stays as before", async () => {
    const pdf = await signed(undefined);
    expect(tokenOf(pdf).token).toBeUndefined();
    const [report] = await verifyPdf(pdf);
    expect(report!.timestamp).toBeUndefined();
  });

  it("a token for another signature does not count", async () => {
    const tsa = await fakeTsa();
    serve(tsa);
    const other = await tsaTimestamper()(new Uint8Array(32).fill(7));
    const [report] = await verifyPdf(await signed(async () => other));
    expect(report!.integrity).toBe("valid");
    expect(report!.timestamp?.valid).toBe(false);
  });

  it("refuses an answer that does not certify the hash asked for", async () => {
    serve(await fakeTsa());
    const other = await tsaTimestamper()(new Uint8Array(32).fill(9));
    const reply = new pkijs.TimeStampResp({
      status: new pkijs.PKIStatusInfo({ status: 0 }),
      timeStampToken: pkijs.ContentInfo.fromBER(buffer(other)),
    });
    vi.stubGlobal(
      "fetch",
      async () => new Response(reply.toSchema().toBER(false)),
    );
    await expect(
      tsaTimestamper()(new Uint8Array(32).fill(1)),
    ).rejects.toBeInstanceOf(TimestampError);
  });

  it("says so when the authority cannot be reached or answers nonsense", async () => {
    const noWaits = () => tsaTimestamper(TSA_URL, [0, 0]);
    const failing = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", failing);
    await expect(signed(noWaits())).rejects.toThrow(/No se pudo contactar/);
    expect(failing).toHaveBeenCalledTimes(3);
    const nonsense = vi.fn(async () => new Response("<html>oops</html>"));
    vi.stubGlobal("fetch", nonsense);
    await expect(signed(noWaits())).rejects.toThrow(
      /no devolvió un sello válido/,
    );
    // A wrong answer is not asked again.
    expect(nonsense).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", async () => new Response("", { status: 502 }));
    await expect(signed(noWaits())).rejects.toThrow(/No se pudo contactar/);
    const forbidden = vi.fn(async () => new Response("", { status: 403 }));
    vi.stubGlobal("fetch", forbidden);
    await expect(signed(noWaits())).rejects.toThrow(/No se pudo contactar/);
    expect(forbidden).toHaveBeenCalledTimes(1);
  });

  it("asks again while the relay starts or loses the authority", async () => {
    const tsa = await fakeTsa({ name: "Sellos de Prueba" });
    const answers = [
      async () => {
        throw new TypeError("Failed to fetch");
      },
      async () => new Response("", { status: 503 }),
    ];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const next = answers.shift();
      if (next) return next();
      const body = new Uint8Array(init.body as ArrayBuffer);
      return new Response(buffer(await tsa.respond(body)));
    });
    vi.stubGlobal("fetch", fetch);
    const pdf = await signed(tsaTimestamper(TSA_URL, [0, 0]));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(tokenOf(pdf).token).toBeDefined();
  });
});

describe("timestamp relay", () => {
  const query = new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01]);
  const ok = { method: "POST", contentType: "application/timestamp-query" };

  it("forwards a timestamp request and returns the reply", async () => {
    const upstream = vi.fn(
      async () => new Response(new Uint8Array([0x30, 0x00])),
    );
    const reply = await relay(
      { ...ok, body: query },
      upstream as unknown as typeof fetch,
    );
    expect(upstream).toHaveBeenCalledWith(
      UPSTREAM,
      expect.objectContaining({ method: "POST", body: query }),
    );
    expect(reply).toEqual({
      status: 200,
      headers: {
        "Content-Type": "application/timestamp-reply",
        "Cache-Control": "no-store",
      },
      body: new Uint8Array([0x30, 0x00]),
    });
  });

  it("forwards nothing but small timestamp requests", async () => {
    const upstream = vi.fn() as unknown as typeof fetch;
    expect(
      (await relay({ ...ok, method: "GET", body: undefined }, upstream)).status,
    ).toBe(405);
    expect(
      (await relay({ ...ok, contentType: "text/plain", body: query }, upstream))
        .status,
    ).toBe(415);
    expect(
      (await relay({ ...ok, body: new Uint8Array(4096).fill(0x30) }, upstream))
        .status,
    ).toBe(400);
    expect(
      (await relay({ ...ok, body: new Uint8Array([1, 2, 3]) }, upstream))
        .status,
    ).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("answers 502 when the authority fails twice", async () => {
    const down = vi.fn(async () => {
      throw new Error("down");
    });
    expect(
      (await relay({ ...ok, body: query }, down as unknown as typeof fetch))
        .status,
    ).toBe(502);
    expect(down).toHaveBeenCalledTimes(2);
    const refusing = vi.fn(async () => new Response("", { status: 500 }));
    expect(
      (await relay({ ...ok, body: query }, refusing as unknown as typeof fetch))
        .status,
    ).toBe(502);
    expect(refusing).toHaveBeenCalledTimes(2);
    // A refusal is not asked again.
    const bad = vi.fn(async () => new Response("", { status: 400 }));
    expect(
      (await relay({ ...ok, body: query }, bad as unknown as typeof fetch))
        .status,
    ).toBe(502);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("tries the authority again when the connection drops", async () => {
    const upstream = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("other side closed"))
      .mockResolvedValueOnce(new Response(new Uint8Array([0x30, 0x00])));
    const reply = await relay(
      { ...ok, body: query },
      upstream as unknown as typeof fetch,
    );
    expect(reply.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });
});
