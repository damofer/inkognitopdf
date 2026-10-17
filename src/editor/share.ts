// Spec 017: sending the result to another app (Web Share), without going
// through the downloads folder.

/** Whether this browser can share PDF files. */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  try {
    return navigator.canShare({
      files: [new File([""], "x.pdf", { type: "application/pdf" })],
    });
  } catch {
    return false;
  }
}

/** What happened: shared, cancelled by the user, or the gesture was lost. */
export type ShareOutcome = "shared" | "cancelled" | "needsGesture";

export async function sharePdf(
  bytes: Uint8Array,
  fileName: string,
): Promise<ShareOutcome> {
  const file = new File([bytes as Uint8Array<ArrayBuffer>], fileName, {
    type: "application/pdf",
  });
  try {
    await navigator.share({ files: [file], title: fileName });
    return "shared";
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError")
      return "cancelled";
    // Building took too long and the tap no longer counts.
    if (cause instanceof DOMException && cause.name === "NotAllowedError")
      return "needsGesture";
    throw cause;
  }
}
