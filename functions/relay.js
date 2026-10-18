// Timestamp relay (spec 040). Browsers cannot reach public timestamp
// authorities, which send no CORS headers, so the app posts its RFC 3161
// request to /tsa on its own site and this forwards it unchanged. The request
// holds only a hash of a signature: no document ever comes through here.

/** The timestamp authority. Adobe Acrobat trusts its certificates. */
export const UPSTREAM = "http://timestamp.digicert.com";

/** A timestamp request is a small DER SEQUENCE: ~100 bytes with SHA-256. */
const MAX_REQUEST = 512;

/**
 * Answers one relay request: `{ status, body?, headers? }`.
 * @param {{ method: string, contentType: string | undefined, body: Uint8Array | undefined }} request
 * @param {typeof fetch} [fetchImpl]
 */
export async function relay(request, fetchImpl = fetch) {
  if (request.method !== "POST")
    return { status: 405, headers: { Allow: "POST" } };
  if (request.contentType !== "application/timestamp-query")
    return { status: 415 };
  const body = request.body;
  if (
    !body ||
    body.length === 0 ||
    body.length > MAX_REQUEST ||
    body[0] !== 0x30
  )
    return { status: 400 };
  try {
    const upstream = await fetchImpl(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/timestamp-query" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok) return { status: 502 };
    return {
      status: 200,
      headers: {
        "Content-Type": "application/timestamp-reply",
        "Cache-Control": "no-store",
      },
      body: new Uint8Array(await upstream.arrayBuffer()),
    };
  } catch {
    return { status: 502 };
  }
}
