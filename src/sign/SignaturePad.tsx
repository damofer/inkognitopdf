/**
 * Creating a signature or initials (spec 004, HU1): draw, type or upload.
 */
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useT, type MessageKey } from "../i18n";
import {
  cropDrawing,
  HANDWRITING_FONTS,
  penWidth,
  smoothStroke,
  type HandwritingFont,
  type InkPoint,
  type SignatureAsset,
  type SignatureRole,
} from "../model/signature";
import { transparentSignature } from "./imageSignature";
import { HANDWRITING_CSS, SignatureArt } from "./SignaturePreview";

type Mode = "draw" | "type" | "image";

const INK_COLORS: { color: string; label: MessageKey }[] = [
  { color: "#000000", label: "sign.inkBlack" },
  { color: "#0b2f8f", label: "sign.inkBlue" },
];

/** Label of the typed-mode text box for each role. */
const TYPED_LABEL: Record<SignatureRole, MessageKey> = {
  signature: "sign.name",
  initials: "sign.roleInitials",
};

const PAD_W = 480;
const PAD_H = 180;

interface SignaturePadProps {
  role: SignatureRole;
  /** Suggested text for the typed mode. */
  name: string;
  onDone: (asset: SignatureAsset) => void;
  onCancel: () => void;
}

export function SignaturePad({
  role,
  name,
  onDone,
  onCancel,
}: SignaturePadProps) {
  const t = useT();
  const [mode, setMode] = useState<Mode>("draw");
  const [color, setColor] = useState(INK_COLORS[0]!.color);
  const [strokes, setStrokes] = useState<InkPoint[][]>([]);
  const [text, setText] = useState(name);
  const [font, setFont] = useState<HandwritingFont>("DancingScript");
  const [image, setImage] = useState<SignatureAsset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const current = useRef<{ points: InkPoint[]; t: number } | null>(null);
  const title =
    role === "signature" ? t("sign.createSignature") : t("sign.createInitials");

  // Redraws the strokes (and the one in progress) on the canvas.
  const paint = (live?: InkPoint[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = "round";
    for (const stroke of live ? [...strokes, live] : strokes) {
      if (stroke.length === 1) {
        ctx.beginPath();
        ctx.arc(stroke[0]!.x, stroke[0]!.y, stroke[0]!.w / 2, 0, 2 * Math.PI);
        ctx.fill();
      }
      for (let i = 1; i < stroke.length; i++) {
        const a = stroke[i - 1]!;
        const b = stroke[i]!;
        ctx.lineWidth = (a.w + b.w) / 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => paint(), [strokes, color, mode]);

  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * PAD_W) / r.width,
      y: ((e.clientY - r.top) * PAD_H) / r.height,
    };
  };
  const pressure = (e: PointerEvent) =>
    e.pointerType === "pen" ? e.pressure : undefined;

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    current.current = {
      points: [{ ...at(e), w: penWidth(3, 0, pressure(e)) }],
      t: e.timeStamp,
    };
    paint(current.current.points);
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const stroke = current.current;
    if (!stroke) return;
    const p = at(e);
    const last = stroke.points.at(-1)!;
    const dist = Math.hypot(p.x - last.x, p.y - last.y);
    if (dist < 1.5) return;
    const speed = dist / Math.max(1, e.timeStamp - stroke.t);
    stroke.t = e.timeStamp;
    // Width changes gradually, so the line does not look jagged.
    const w = penWidth(3, speed, pressure(e));
    stroke.points.push({ ...p, w: last.w * 0.6 + w * 0.4 });
    paint(stroke.points);
  };
  const onUp = () => {
    const stroke = current.current;
    current.current = null;
    if (stroke) setStrokes((s) => [...s, smoothStroke(stroke.points)]);
  };

  const onImage = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const ink = transparentSignature({
        width: pixels.width,
        height: pixels.height,
        data: pixels.data,
      });
      if (!ink) {
        setError(t("sign.noSignatureInImage"));
        return;
      }
      const out = document.createElement("canvas");
      out.width = ink.width;
      out.height = ink.height;
      out
        .getContext("2d")!
        .putImageData(
          new ImageData(
            ink.data as Uint8ClampedArray<ArrayBuffer>,
            ink.width,
            ink.height,
          ),
          0,
          0,
        );
      const blob = await new Promise<Blob | null>((r) =>
        out.toBlob(r, "image/png"),
      );
      if (!blob) throw new Error(t("sign.imageConvertFailed"));
      setImage({
        kind: "image",
        png: new Uint8Array(await blob.arrayBuffer()),
        width: ink.width,
        height: ink.height,
      });
    } catch (cause) {
      setError(
        t(
          "sign.imageReadFailed",
          cause instanceof Error ? cause.message : String(cause),
        ),
      );
    }
  };

  const result: SignatureAsset | null =
    mode === "draw"
      ? cropDrawing(strokes, color)
      : mode === "type"
        ? text.trim()
          ? { kind: "typed", text: text.trim(), font, color }
          : null
        : image;

  return (
    <div className="sign-pad" role="dialog" aria-label={title}>
      <h3>{title}</h3>
      <div className="sign-tabs" role="tablist">
        {(
          [
            ["draw", "sign.draw"],
            ["type", "sign.type"],
            ["image", "sign.image"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      {mode !== "image" && (
        <div
          className="sign-colors"
          role="group"
          aria-label={t("sign.inkColor")}
        >
          {INK_COLORS.map((c) => (
            <button
              key={c.color}
              type="button"
              aria-pressed={color === c.color}
              aria-label={t(c.label)}
              title={t(c.label)}
              style={{ background: c.color }}
              onClick={() => setColor(c.color)}
            />
          ))}
        </div>
      )}
      {mode === "draw" && (
        <>
          <canvas
            ref={canvasRef}
            className="sign-canvas"
            data-testid="sign-canvas"
            width={PAD_W}
            height={PAD_H}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
          <div className="sign-row">
            <button
              type="button"
              disabled={strokes.length === 0}
              onClick={() => setStrokes((s) => s.slice(0, -1))}
            >
              {t("sign.undoStroke")}
            </button>
            <button
              type="button"
              disabled={strokes.length === 0}
              onClick={() => setStrokes([])}
            >
              {t("sign.clear")}
            </button>
          </div>
        </>
      )}
      {mode === "type" && (
        <>
          <input
            type="text"
            aria-label={t(TYPED_LABEL[role])}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <div
            className="sign-styles"
            role="radiogroup"
            aria-label={t("sign.style")}
          >
            {HANDWRITING_FONTS.map((f) => (
              <label key={f.font}>
                <input
                  type="radio"
                  name="sign-font"
                  checked={font === f.font}
                  onChange={() => setFont(f.font)}
                />
                <span
                  style={{ fontFamily: HANDWRITING_CSS[f.font], color }}
                  title={f.label}
                >
                  {text.trim() || f.label}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      {mode === "image" && (
        <>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-label={t("sign.signatureImage")}
            data-testid="sign-image"
            onChange={(e) => {
              void onImage(e.currentTarget.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
          <p className="sign-note">{t("sign.imageNote")}</p>
          {image && (
            <div className="sign-image-preview">
              <SignatureArt asset={image} />
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="sign-row">
        <button
          type="button"
          className="primary"
          disabled={!result}
          onClick={() => result && onDone(result)}
        >
          {t("sign.use")}
        </button>
        <button type="button" onClick={onCancel}>
          {t("sign.cancel")}
        </button>
      </div>
    </div>
  );
}
