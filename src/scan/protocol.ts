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
      /** Spec 029: straighten a curved sheet. */
      straighten: boolean;
    }
  | { op: "drop"; id: string }
  /** Spec 020: a reduced camera frame, to follow the page live. */
  | { op: "detect"; bitmap: ImageBitmap }
  /** Spec 020: the sides of an ID card on one A4 page. */
  | { op: "compose"; sides: ComposeSide[] };

export interface ComposeSide {
  id: string;
  quad: Quad;
  mode: ScanMode;
  quarters: number;
}

export interface DetectResult {
  /** Page corners in the frame, or null. */
  quad: Quad | null;
  /** What the page looks like, to tell the next sheet from this one. */
  signature: Float32Array | null;
}

export interface ComposeResult {
  scan: ScanImage;
}

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
  /** Spec 029: the sheet was curved and has been straightened. */
  curved: boolean;
}

export type ScanResponse =
  | {
      seq: number;
      ok: true;
      result: AddResult | RenderResult | DetectResult | ComposeResult | null;
    }
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
