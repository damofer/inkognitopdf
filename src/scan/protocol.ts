/** Messages between the scanner UI and its worker (spec 002, S010). */
import type { ScanImage } from "../model/document";
import type { ScanMode } from "./enhance";
import type { Quad } from "./homography";
import type { PaperSize } from "./pipeline";

export type ScanRequest =
  | { op: "add"; id: string; bitmap: ImageBitmap; detect: boolean }
  | {
      op: "render";
      id: string;
      quad: Quad;
      mode: ScanMode;
      quarters: number;
      paper: PaperSize;
    }
  | { op: "drop"; id: string };

export interface AddResult {
  width: number;
  height: number;
  quad: Quad;
  found: boolean;
}

export interface RenderResult {
  /** Reduced image for the screen. */
  preview: ImageBitmap;
  /** Full page, ready for the PDF. */
  scan: ScanImage;
  /** Milliseconds spent in the worker. */
  ms: number;
}

export type ScanResponse =
  | { seq: number; ok: true; result: AddResult | RenderResult | null }
  | { seq: number; ok: false; error: string; code?: ScanErrorCode };

/**
 * Message keys of the errors the worker reports. The worker does not know the
 * interface language, so it sends the key and the client translates it.
 */
export type ScanErrorCode = "scan.photoGone" | "scan.invalidQuad";

/** An error whose message is a message key, translated on the main thread. */
export class ScanError extends Error {
  constructor(readonly code: ScanErrorCode) {
    super(code);
    this.name = "ScanError";
  }
}
