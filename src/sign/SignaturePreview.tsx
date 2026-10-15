/**
 * On-screen preview of a signature asset (spec 004): SVG for strokes and typed
 * text, an image for uploaded signatures. It stretches to its box like the
 * saved XObject does.
 */
import { useMemo } from "react";
import type { SignatureAsset } from "../model/signature";

/** CSS family of each handwriting font (declared in styles.css). */
export const HANDWRITING_CSS: Record<string, string> = {
  DancingScript: '"Dancing Script", cursive',
  GreatVibes: '"Great Vibes", cursive',
  Caveat: '"Caveat", cursive',
};

const TYPED_SIZE = 100;
let measureCanvas: HTMLCanvasElement | null = null;

/** Box of typed text at 100 px, measured with the loaded web font. */
export function typedBox(asset: Extract<SignatureAsset, { kind: "typed" }>) {
  measureCanvas ??= document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d")!;
  ctx.font = `${TYPED_SIZE}px ${HANDWRITING_CSS[asset.font]}`;
  const m = ctx.measureText(asset.text);
  const ascent = m.fontBoundingBoxAscent || TYPED_SIZE * 0.9;
  const descent = m.fontBoundingBoxDescent || TYPED_SIZE * 0.3;
  return { width: Math.max(1, m.width), height: ascent + descent, ascent };
}

/** Natural width / height of an asset, to place it without distortion. */
export function assetAspect(asset: SignatureAsset): number {
  if (asset.kind === "typed") {
    const box = typedBox(asset);
    return box.width / box.height;
  }
  return asset.width / Math.max(1, asset.height);
}

const urls = new WeakMap<Uint8Array, string>();
function pngUrl(png: Uint8Array) {
  let url = urls.get(png);
  if (!url) {
    url = URL.createObjectURL(new Blob([png.slice()], { type: "image/png" }));
    urls.set(png, url);
  }
  return url;
}

export function SignatureArt({ asset }: { asset: SignatureAsset }) {
  const typed = useMemo(
    () => (asset.kind === "typed" ? typedBox(asset) : null),
    [asset],
  );
  const fill = { width: "100%", height: "100%", display: "block" } as const;
  if (asset.kind === "image")
    return (
      <img src={pngUrl(asset.png)} alt="" draggable={false} style={fill} />
    );
  if (asset.kind === "typed" && typed)
    return (
      <svg
        viewBox={`0 0 ${typed.width} ${typed.height}`}
        preserveAspectRatio="none"
        style={fill}
        aria-hidden="true"
      >
        <text
          x={0}
          y={typed.ascent}
          fontSize={TYPED_SIZE}
          fontFamily={HANDWRITING_CSS[asset.font]}
          fill={asset.color}
        >
          {asset.text}
        </text>
      </svg>
    );
  if (asset.kind !== "drawn") return null;
  return (
    <svg
      viewBox={`0 0 ${Math.max(1, asset.width)} ${Math.max(1, asset.height)}`}
      preserveAspectRatio="none"
      style={fill}
      aria-hidden="true"
    >
      {asset.strokes.map((stroke, i) =>
        stroke.length === 1 ? (
          <circle
            key={i}
            cx={stroke[0]!.x}
            cy={stroke[0]!.y}
            r={stroke[0]!.w / 2}
            fill={asset.color}
          />
        ) : (
          stroke.slice(1).map((b, j) => {
            const a = stroke[j]!;
            return (
              <line
                key={`${i}-${j}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={asset.color}
                strokeWidth={(a.w + b.w) / 2}
                strokeLinecap="round"
              />
            );
          })
        ),
      )}
    </svg>
  );
}

/** The asset in a box of `width` × `height` px, turned `rotation` degrees clockwise. */
export function SignaturePreview({
  asset,
  rotation,
  width,
  height,
}: {
  asset: SignatureAsset;
  rotation: number;
  width: number;
  height: number;
}) {
  const sideways = rotation % 180 !== 0;
  const w = sideways ? height : width;
  const h = sideways ? width : height;
  return (
    <div
      style={{
        position: "absolute",
        width: w,
        height: h,
        left: (width - w) / 2,
        top: (height - h) / 2,
        transform: `rotate(${rotation}deg)`,
      }}
    >
      <SignatureArt asset={asset} />
    </div>
  );
}
