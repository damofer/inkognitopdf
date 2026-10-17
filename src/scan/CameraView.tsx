// Spec 020: scanning a batch with the live camera. The page is followed in a
// reduced frame (in the scanner worker) and taken by itself once it holds
// still; the next sheet is taken when it replaces the last one. The video
// never leaves the device.
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import type { Quad } from "./homography";
import type { DetectResult } from "./protocol";
import { SteadyTracker, type SteadyState } from "./steady";

/** Side of the reduced frame the page is looked for in. */
const DETECT_SIZE = 640;
/** Time between two looks at the camera, in milliseconds. */
const DETECT_EVERY = 150;

/** Whether this browser can show the camera live. */
export const canUseCamera = () =>
  typeof navigator !== "undefined" &&
  typeof navigator.mediaDevices?.getUserMedia === "function";

interface CameraViewProps {
  /** Looks for the page in a reduced frame (the scanner worker). */
  detect: (frame: ImageBitmap) => Promise<DetectResult>;
  /** Pages taken so far in the scanner (all of them, not only these). */
  count: number;
  /** Take pages by themselves when they hold still. */
  auto: boolean;
  onAuto: (auto: boolean) => void;
  /** ID card mode: say which side comes next. */
  idCard: boolean;
  /** A full-resolution frame was taken. */
  onShot: (frame: ImageBitmap) => Promise<void>;
  onDone: () => void;
  /** The camera could not be opened. */
  onError: () => void;
}

export function CameraView({
  detect,
  count,
  auto,
  onAuto,
  idCard,
  onShot,
  onDone,
  onError,
}: CameraViewProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [state, setState] = useState<SteadyState>({ state: "searching" });
  const [flash, setFlash] = useState(0);
  const tracker = useRef(new SteadyTracker());
  const last = useRef<{ quad: Quad | null; signature: Float32Array | null }>({
    quad: null,
    signature: null,
  });
  const taking = useRef(false);
  const live = useRef({ auto, onShot, onError, detect });
  useEffect(() => {
    live.current = { auto, onShot, onError, detect };
  });

  /** Takes the frame; by hand, the tracker learns the page was taken. */
  const take = async (byHand = true) => {
    const video = videoRef.current;
    if (!video || taking.current || !video.videoWidth) return;
    taking.current = true;
    try {
      const frame = await createImageBitmap(video);
      if (byHand)
        tracker.current.took(
          last.current.quad,
          last.current.signature,
          performance.now(),
        );
      setFlash((n) => n + 1);
      await live.current.onShot(frame);
    } finally {
      taking.current = false;
    }
  };
  const takeRef = useRef(take);
  useEffect(() => {
    takeRef.current = take;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const video = videoRef.current!;

    const look = async () => {
      if (stopped) return;
      if (video.videoWidth && !taking.current) {
        const k = Math.min(
          1,
          DETECT_SIZE / Math.max(video.videoWidth, video.videoHeight),
        );
        const w = Math.round(video.videoWidth * k);
        const h = Math.round(video.videoHeight * k);
        try {
          const frame = await createImageBitmap(video, {
            resizeWidth: w,
            resizeHeight: h,
          });
          const found = await live.current.detect(frame);
          if (stopped) return;
          const scaled =
            found.quad &&
            (found.quad.map((p) => ({ x: p.x / k, y: p.y / k })) as Quad);
          last.current = { quad: found.quad, signature: found.signature };
          setQuad(scaled);
          const next = tracker.current.feed(
            {
              quad: found.quad,
              diagonal: Math.hypot(w, h),
              signature: found.signature,
            },
            performance.now(),
            live.current.auto,
          );
          setState(next);
          if (next.state === "capture") await takeRef.current(false);
        } catch {
          // A frame that could not be read: try the next one.
        }
      }
      if (!stopped) timer = window.setTimeout(() => void look(), DETECT_EVERY);
    };

    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
      })
      .then(async (s) => {
        if (stopped) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        video.srcObject = s;
        await video.play().catch(() => undefined);
        void look();
      })
      .catch(() => live.current.onError());

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, []);

  const message =
    state.state === "waiting" || state.state === "capture"
      ? idCard && count % 2 === 1
        ? t("scan.cameraFlip")
        : t("scan.cameraNext")
      : idCard
        ? count % 2 === 0
          ? t("scan.cameraFront")
          : t("scan.cameraBack")
        : state.state === "searching"
          ? t("scan.cameraSearching")
          : auto
            ? t("scan.cameraHold")
            : t("scan.cameraReady");
  const progress = state.state === "steadying" ? state.progress : 0;

  return (
    <div
      className="scan-camera"
      role="dialog"
      aria-label={t("scan.cameraTitle")}
      data-state={state.state}
    >
      <div className="scan-camera-stage">
        <video
          ref={videoRef}
          muted
          playsInline
          data-testid="scan-video"
          onLoadedMetadata={(e) =>
            setSize({
              w: e.currentTarget.videoWidth,
              h: e.currentTarget.videoHeight,
            })
          }
        />
        {size && (
          <svg
            className="scan-camera-overlay"
            viewBox={`0 0 ${size.w} ${size.h}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
          >
            {quad && (
              <polygon
                points={quad.map((p) => `${p.x},${p.y}`).join(" ")}
                className={`scan-camera-quad ${state.state}`}
                style={{ strokeOpacity: 0.5 + progress / 2 }}
              />
            )}
          </svg>
        )}
        {flash > 0 && <div key={flash} className="scan-camera-flash" />}
        <p className="scan-camera-message" role="status">
          {message}
        </p>
      </div>
      <div className="scan-camera-bar">
        <button
          type="button"
          className="scan-camera-auto"
          aria-pressed={auto}
          onClick={() => onAuto(!auto)}
        >
          {t("scan.cameraAuto")}
        </button>
        <button
          type="button"
          className="scan-shutter"
          aria-label={t("scan.cameraTake")}
          disabled={!size}
          onClick={() => void take()}
        />
        <button type="button" className="primary" onClick={onDone}>
          {t("scan.cameraDone", count)}
        </button>
      </div>
    </div>
  );
}
