import { useEffect, useRef, useState } from "react";
import type { Quad } from "./homography";
import { cornersAt, cssMatrix, morphEnds, MORPH_MS, type Size } from "./morph";

/** Whether the system asks for less motion (spec 030, CA6). */
export function reduceMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The sheet straightening itself (spec 030): the photo as on the crop screen,
 * the outside fading, and the sheet moving in perspective to the page's
 * rectangle, where it stays until the finished page replaces it.
 */
export function SheetMorph({
  photoUrl,
  photo,
  quad,
  aspect,
  quarters,
  size,
  onEnd,
}: {
  photoUrl: string;
  photo: Size;
  quad: Quad;
  /** Width / height of the page as it will be shown. */
  aspect: number;
  quarters: number;
  /** Fixed size (phone layout); by default, its CSS size. */
  size?: Size;
  onEnd: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLImageElement>(null);
  const backRef = useRef<HTMLImageElement>(null);
  const [measured, setMeasured] = useState<Size | null>(null);
  const [finished, setFinished] = useState(false);
  const box = size ?? measured;
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || size) return;
    const measure = () =>
      setMeasured({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [size]);

  const ends = box && morphEnds(quad, photo, box, aspect, quarters);
  const k = ends ? ends.photo.width / photo.width : 0;
  // The sheet's corners on the element, which is the photo at its crop size.
  const local = quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad;

  // One run from mount; later geometry changes (a resize) apply on the next
  // frame through the refs.
  const endsRef = useRef(ends);
  const localRef = useRef(local);
  useEffect(() => {
    endsRef.current = ends;
    localRef.current = local;
  });
  const started = !!ends;
  useEffect(() => {
    if (!started) return;
    let frame = 0;
    const t0 = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / MORPH_MS);
      const current = endsRef.current;
      if (current) {
        const matrix = cssMatrix(
          localRef.current,
          cornersAt(current.start, current.end, t),
        );
        if (matrix && sheetRef.current)
          sheetRef.current.style.transform = matrix;
        // The outside is gone in the first half.
        if (backRef.current)
          backRef.current.style.opacity = String(Math.max(0, 1 - 2 * t));
      }
      if (t < 1) frame = requestAnimationFrame(tick);
      else {
        setFinished(true);
        onEndRef.current();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [started]);

  const placed = ends && {
    width: ends.photo.width,
    height: ends.photo.height,
  };
  return (
    <div
      ref={ref}
      className="scan-morph"
      data-testid="scan-morph"
      aria-hidden="true"
      style={size}
    >
      {ends && (
        <>
          <img
            ref={backRef}
            className="scan-morph-back"
            src={photoUrl}
            alt=""
            draggable={false}
            style={{
              ...placed,
              left: ends.photo.x,
              top: ends.photo.y,
              opacity: finished ? 0 : undefined,
            }}
          />
          <img
            ref={sheetRef}
            className="scan-morph-sheet"
            src={photoUrl}
            alt=""
            draggable={false}
            style={{
              ...placed,
              clipPath: `polygon(${local.map((p) => `${p.x}px ${p.y}px`).join(",")})`,
              transform:
                cssMatrix(local, finished ? ends.end : ends.start) ?? undefined,
            }}
          />
        </>
      )}
    </div>
  );
}
