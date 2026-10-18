import { useEffect, useRef, useState, type ReactNode } from "react";
import { effectiveRotation, type PageEntry } from "../model/document";
import { PageGeometry } from "../model/geometry";
import type { PDFDocumentProxy } from "./pdfjs";
import { drawScanPage } from "./scanBitmap";
import { useNearViewport } from "./useNearViewport";
import { useT } from "../i18n";

export const THUMBNAIL_WIDTH = 120;

interface ThumbnailProps {
  doc: PDFDocumentProxy | null;
  entry: PageEntry;
  pageNumber: number;
  active: boolean;
  onSelect: (pageNumber: number) => void;
  /** Page actions (rotate, delete, move…), shown under the thumbnail. */
  actions?: ReactNode;
  /** Being dragged to a new place (spec 013). */
  dragged?: boolean;
  /** The dragged page would go before or after this one. */
  dropMark?: "before" | "after";
}

export function Thumbnail({
  doc,
  entry,
  pageNumber,
  active,
  onSelect,
  actions,
  dragged = false,
  dropMark,
}: ThumbnailProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Far thumbnails free their canvas too (spec 035).
  const near = useNearViewport(rootRef, "400px", "2000px");
  const [rendered, setRendered] = useState(false);
  const rotation = effectiveRotation(entry);
  const sourceIndex =
    entry.source.kind === "original" ? entry.source.index : -1;
  const scanImage = entry.source.kind === "scan" ? entry.source.image : null;
  const base = new PageGeometry(entry.box, rotation, 1);
  const scale = THUMBNAIL_WIDTH / base.viewWidth;

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let renderTask: { cancel(): void } | null = null;
    (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const outputScale = window.devicePixelRatio || 1;
      const g = new PageGeometry(entry.box, rotation, scale);
      canvas.width = Math.floor(g.viewWidth * outputScale);
      canvas.height = Math.floor(g.viewHeight * outputScale);
      if (sourceIndex >= 0 && doc) {
        const page = await doc.getPage(sourceIndex + 1);
        if (cancelled) return;
        const task = page.render({
          canvas,
          viewport: page.getViewport({ scale, rotation }),
          transform:
            outputScale !== 1
              ? [outputScale, 0, 0, outputScale, 0, 0]
              : undefined,
        });
        renderTask = task;
        await task.promise;
      } else {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        if (scanImage) await drawScanPage(canvas, scanImage, rotation);
      }
      if (!cancelled) setRendered(true);
    })().catch(() => {
      // A thumbnail failing must not break the viewer; the main page reports errors.
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      setRendered(false);
    };
  }, [doc, sourceIndex, scanImage, entry.box, rotation, scale, near]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (near || !canvas || canvas.width === 0) return;
    canvas.width = 0;
    canvas.height = 0;
  }, [near]);

  return (
    <div
      ref={rootRef}
      className={`thumbnail${active ? " active" : ""}${
        dragged ? " dragged" : ""
      }${dropMark ? ` drop-${dropMark}` : ""}`}
      data-page-id={entry.id}
      data-rendered={rendered ? "true" : "false"}
    >
      <button
        type="button"
        className="thumbnail-button"
        onClick={() => onSelect(pageNumber)}
        aria-label={t("viewer.goToPage", pageNumber)}
        aria-current={active ? "page" : undefined}
      >
        <canvas
          ref={canvasRef}
          style={{ aspectRatio: `${base.viewWidth} / ${base.viewHeight}` }}
        />
        <span>{pageNumber}</span>
      </button>
      {actions}
    </div>
  );
}
