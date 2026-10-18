// Timestamp relay (spec 040). Browsers cannot reach public timestamp
// authorities, which send no CORS headers, so the app posts its RFC 3161
// request to /tsa on its own site and this forwards it unchanged. The request
// holds only a hash of a signature: no document ever comes through here.

/** The timestamp authority. Adobe Acrobat trusts its certificates. */
export const UPSTREAM = "http://timestamp.digicert.com";

/** A timestamp request is a small DER SEQUENCE: ~100 bytes with SHA-256. */
const MAX_REQUEST = 512;

/** Tries at the authority: a kept-alive connection it closed fails once. */
const ATTEMPTS = 2;

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
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const upstream = await fetchImpl(UPSTREAM, {
        method: "POST",
        headers: { "Content-Type": "application/timestamp-query" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (upstream.ok)
        return {
          status: 200,
          headers: {
            "Content-Type": "application/timestamp-reply",
            "Cache-Control": "no-store",
          },
          body: new Uint8Array(await upstream.arrayBuffer()),
        };
      // A refusal (4xx) will not change by asking again.
      if (upstream.status < 500) break;
    } catch {
      // Unreachable, timed out or the connection dropped: try again.
    }
  }
  return { status: 502 };
}
