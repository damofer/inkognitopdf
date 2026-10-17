import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AnnotationMode, TextLayer } from "pdfjs-dist/legacy/build/pdf.mjs";
import { effectiveRotation, type PageEntry } from "../model/document";
import { PageGeometry } from "../model/geometry";
import type { PDFDocumentProxy } from "./pdfjs";
import { drawScanPage } from "./scanBitmap";
import { useNearViewport } from "./useNearViewport";
import { useT } from "../i18n";

interface PageViewProps {
  /** null for documents started from scratch (only blank pages). */
  doc: PDFDocumentProxy | null;
  entry: PageEntry;
  pageNumber: number;
  zoom: number;
  onRendered?: (pageNumber: number) => void;
  /** Edit overlay, drawn above the text layer. */
  children?: (geometry: PageGeometry) => ReactNode;
}

/**
 * One page with its layers, bottom to top:
 *   canvas          raster render, including annotation appearances
 *   textLayer       selectable text positioned over the canvas
 *   annotationLayer reserved for interactive annotations
 *   editLayer       overlay where editing tools show their changes
 */
export function PageView({
  doc,
  entry,
  pageNumber,
  zoom,
  onRendered,
  children,
}: PageViewProps) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(wrapRef);
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rotation = effectiveRotation(entry);
  const geometry = new PageGeometry(entry.box, rotation, zoom);
  const sourceIndex =
    entry.source.kind === "original" ? entry.source.index : -1;
  const scanImage = entry.source.kind === "scan" ? entry.source.image : null;

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let renderTask: { cancel(): void } | null = null;
    let textLayer: TextLayer | null = null;

    (async () => {
      const canvas = canvasRef.current;
      const textContainer = textLayerRef.current;
      if (!canvas || !textContainer) return;
      const outputScale = window.devicePixelRatio || 1;
      textContainer.replaceChildren();

      if (sourceIndex < 0 || !doc) {
        const g = new PageGeometry(entry.box, rotation, zoom);
        canvas.width = Math.floor(g.viewWidth * outputScale);
        canvas.height = Math.floor(g.viewHeight * outputScale);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        if (scanImage) await drawScanPage(canvas, scanImage, rotation);
        if (cancelled) return;
      } else {
        const page = await doc.getPage(sourceIndex + 1);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: zoom, rotation });
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        const task = page.render({
          canvas,
          viewport,
          annotationMode: AnnotationMode.ENABLE,
          transform:
            outputScale !== 1
              ? [outputScale, 0, 0, outputScale, 0, 0]
              : undefined,
        });
        renderTask = task;
        await task.promise;
        if (cancelled) return;
        textLayer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: textContainer,
          viewport,
        });
        await textLayer.render();
      }
      if (cancelled) return;
      setRendered(true);
      onRendered?.(pageNumber);
    })().catch((cause: unknown) => {
      if (
        cancelled ||
        (cause instanceof Error && cause.name === "RenderingCancelledException")
      )
        return;
      setError(cause instanceof Error ? cause.message : String(cause));
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      setRendered(false);
    };
  }, [
    doc,
    sourceIndex,
    scanImage,
    entry.box,
    rotation,
    zoom,
    near,
    pageNumber,
    onRendered,
  ]);

  const style = {
    width: `${geometry.viewWidth}px`,
    height: `${geometry.viewHeight}px`,
    "--scale-factor": zoom,
    "--total-scale-factor": zoom,
    "--scale-round-x": "1px",
    "--scale-round-y": "1px",
  } as CSSProperties;

  return (
    <div
      ref={wrapRef}
      className="page"
      style={style}
      data-page-number={pageNumber}
      data-page-id={entry.id}
      data-rendered={rendered ? "true" : "false"}
      aria-label={t("viewer.page", pageNumber)}
    >
      <canvas ref={canvasRef} className="page-canvas" />
      <div ref={textLayerRef} className="textLayer" />
      <div className="annotationLayer" />
      <div className="editLayer">{children?.(geometry)}</div>
      {error && <p className="page-error">{t("viewer.renderError", error)}</p>}
    </div>
  );
}
