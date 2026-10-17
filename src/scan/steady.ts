// Spec 020: when to take the picture in a live camera scan. A page is taken
// once its corners have held still for a moment; the next one only after the
// page leaves the frame, moves a lot or changes (the next sheet). Pure, so it
// is tested without a camera.
import type { Quad } from "./homography";

export interface SteadyOptions {
  /** Corners count as still while they move less than this share of the frame diagonal. */
  still: number;
  /** How long the page must hold still, in milliseconds. */
  holdMs: number;
  /** After a capture, a move of this share of the diagonal means a new page. */
  moved: number;
  /** After a capture, a page signature this different means a new page. */
  changed: number;
  /** Least time between two captures, in milliseconds. */
  gapMs: number;
}

export const STEADY_DEFAULTS: SteadyOptions = {
  still: 0.025,
  holdMs: 800,
  moved: 0.15,
  changed: 0.5,
  gapMs: 1200,
};

/** What one camera frame showed. */
export interface Frame {
  /** Page corners, or null when no page was found. */
  quad: Quad | null;
  /** Diagonal of the frame, in the units of `quad`. */
  diagonal: number;
  /** Small picture of the page (see `pageSignature`), to notice a new sheet. */
  signature?: Float32Array | null;
}

export type SteadyState =
  | { state: "searching" }
  | { state: "steadying"; progress: number }
  | { state: "capture" }
  /** Taken: waiting for the next sheet. */
  | { state: "waiting" };

/** The largest distance any corner moved between two quads. */
export function cornerMove(a: Quad, b: Quad): number {
  let most = 0;
  for (let i = 0; i < 4; i++)
    most = Math.max(most, Math.hypot(a[i]!.x - b[i]!.x, a[i]!.y - b[i]!.y));
  return most;
}

/**
 * How different two page signatures are: 0 for the same picture, about 1.4
 * for unrelated ones (they are normalised to mean 0 and deviation 1).
 */
export function signatureDistance(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (a[i]! - b[i]!) ** 2;
  return Math.sqrt(sum / n);
}

export class SteadyTracker {
  private readonly options: SteadyOptions;
  /** Where the page was when it started holding still, and since when. */
  private anchor: { quad: Quad; since: number } | null = null;
  /** The last page taken, until the next sheet arrives. */
  private taken: { quad: Quad; signature: Float32Array | null } | null = null;
  private takenAt = -Infinity;

  constructor(options: Partial<SteadyOptions> = {}) {
    this.options = { ...STEADY_DEFAULTS, ...options };
  }

  /**
   * Feeds one frame seen at `now` (milliseconds). Without `shoot` (the
   * automatic shutter is off) a still page only reaches progress 1.
   */
  feed(frame: Frame, now: number, shoot = true): SteadyState {
    const { quad, diagonal, signature = null } = frame;
    const o = this.options;
    if (this.taken) {
      const gone =
        !quad ||
        cornerMove(quad, this.taken.quad) > o.moved * diagonal ||
        (!!signature &&
          !!this.taken.signature &&
          signatureDistance(signature, this.taken.signature) > o.changed);
      if (!gone) return { state: "waiting" };
      this.taken = null;
      this.anchor = null;
    }
    if (!quad) {
      this.anchor = null;
      return { state: "searching" };
    }
    if (
      !this.anchor ||
      cornerMove(quad, this.anchor.quad) > o.still * diagonal
    ) {
      this.anchor = { quad, since: now };
      return { state: "steadying", progress: 0 };
    }
    const progress = Math.min(1, (now - this.anchor.since) / o.holdMs);
    if (shoot && progress >= 1 && now - this.takenAt >= o.gapMs) {
      this.took(quad, signature, now);
      return { state: "capture" };
    }
    return { state: "steadying", progress };
  }

  /** A page was taken (also by hand): wait for the next sheet. */
  took(quad: Quad | null, signature: Float32Array | null, now: number): void {
    this.takenAt = now;
    this.anchor = null;
    this.taken = quad ? { quad, signature } : null;
  }
}
