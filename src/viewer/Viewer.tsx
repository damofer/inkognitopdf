import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { effectiveRotation, type PageEntry } from "../model/document";
import { PageGeometry } from "../model/geometry";
import type { PDFDocumentProxy } from "./pdfjs";
import { PageView } from "./PageView";
import { Thumbnail } from "./Thumbnail";
import { clampZoom, fitWidth, formatZoom, zoomIn, zoomOut } from "./zoom";
import { useT } from "../i18n";
import { Icon } from "../icons";

interface ViewerProps {
  doc: PDFDocumentProxy | null;
  pages: PageEntry[];
  /** Extra controls shown at the start of the toolbar (editing tools). */
  toolbar?: ReactNode;
  /** A bar above the toolbar: the task tabs and the save actions (spec 025). */
  topBar?: ReactNode;
  /** Panels docked at the right of the pages (spec 025). */
  aside?: ReactNode;
  /** Desktop (spec 025): zoom and page number float over the pages, and
   * this note (the tool's help) floats at their top. */
  floating?: boolean;
  pagesNote?: ReactNode;
  renderOverlay?: (entry: PageEntry, geometry: PageGeometry) => ReactNode;
  renderPageActions?: (entry: PageEntry, index: number) => ReactNode;
  /** Class added to the pages area, e.g. the active tool for cursors. */
  pagesClassName?: string;
  /** A row under the toolbar (tool options in the phone layout). */
  belowToolbar?: ReactNode;
  /** Phone layout: shows the thumbnails as a strip over the pages. */
  thumbnailsOpen?: boolean;
  /** Controls above the thumbnails (insert, split). */
  thumbnailsHeader?: ReactNode;
  /** Dragging a thumbnail moves its page to the final index `to` (spec 013). */
  onMovePage?: (from: number, to: number) => void;
}

/** Mouse: a drag starts after this distance; touch: after a still hold. */
const DRAG_DISTANCE = 6;
const HOLD_MS = 350;
const HOLD_SLOP = 8;

interface ThumbDrag {
  from: number;
  /** Gap the page would go into: 0 is before the first thumbnail. */
  slot: number;
}

/** Narrow screens open documents fitted to the width (spec 007). */
function initialZoom(first: PageEntry | undefined): number {
  const available = globalThis.innerWidth ?? 0;
  if (!first || available === 0 || available > 760) return 1;
  const width = new PageGeometry(first.box, effectiveRotation(first), 1)
    .viewWidth;
  return width > available - 16 ? fitWidth(width, available, 16) : 1;
}

export function Viewer({
  doc,
  pages,
  toolbar,
  topBar,
  aside,
  floating = false,
  pagesNote,
  renderOverlay,
  renderPageActions,
  pagesClassName,
  belowToolbar,
  thumbnailsOpen = false,
  thumbnailsHeader,
  onMovePage,
}: ViewerProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(() => initialZoom(pages[0]));
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  const [currentPage, setCurrentPage] = useState(1);
  const firstRenderReported = useRef(false);

  const handleRendered = useCallback((pageNumber: number) => {
    if (pageNumber === 1 && !firstRenderReported.current) {
      firstRenderReported.current = true;
      performance.mark("pdfcraft:first-page-rendered");
    }
  }, []);

  // Track the page closest to the top of the scroll area.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const onScroll = () => {
      const top = root.getBoundingClientRect().top;
      let best = 1;
      let bestDistance = Infinity;
      for (const el of root.querySelectorAll<HTMLElement>(".page")) {
        const distance = Math.abs(el.getBoundingClientRect().top - top);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = Number(el.dataset.pageNumber);
        }
      }
      setCurrentPage(best);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => root.removeEventListener("scroll", onScroll);
  }, []);

  // Pinch to zoom on touch screens (spec 007): the pages scale with a CSS
  // transform during the gesture and are rendered again at the end.
  useEffect(() => {
    const root = scrollRef.current;
    const inner = innerRef.current;
    if (!root || !inner) return;
    let gesture: {
      distance: number;
      zoom: number;
      x: number;
      y: number;
      ox: number;
      oy: number;
    } | null = null;
    let scale = 1;
    const spread = (e: TouchEvent) =>
      Math.hypot(
        e.touches[0]!.clientX - e.touches[1]!.clientX,
        e.touches[0]!.clientY - e.touches[1]!.clientY,
      );
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      const box = root.getBoundingClientRect();
      const x = (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2 - box.left;
      const y = (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2 - box.top;
      gesture = {
        distance: spread(e),
        zoom: zoomRef.current,
        x,
        y,
        ox: root.scrollLeft + x,
        oy: root.scrollTop + y,
      };
      scale = 1;
      inner.style.transformOrigin = `${gesture.ox - inner.offsetLeft}px ${
        gesture.oy - inner.offsetTop
      }px`;
    };
    const onMove = (e: TouchEvent) => {
      if (!gesture || e.touches.length !== 2) return;
      e.preventDefault();
      const next = clampZoom((gesture.zoom * spread(e)) / gesture.distance);
      scale = next / gesture.zoom;
      inner.style.transform = `scale(${scale})`;
    };
    const onEnd = (e: TouchEvent) => {
      if (!gesture || e.touches.length >= 2) return;
      const { x, y, ox, oy, zoom: from } = gesture;
      gesture = null;
      inner.style.transform = "";
      if (Math.abs(scale - 1) < 0.02) return;
      setZoom(from * scale);
      requestAnimationFrame(() => {
        root.scrollLeft = ox * scale - x;
        root.scrollTop = oy * scale - y;
      });
    };
    root.addEventListener("touchstart", onStart, { passive: true });
    root.addEventListener("touchmove", onMove, { passive: false });
    root.addEventListener("touchend", onEnd);
    root.addEventListener("touchcancel", onEnd);
    return () => {
      root.removeEventListener("touchstart", onStart);
      root.removeEventListener("touchmove", onMove);
      root.removeEventListener("touchend", onEnd);
      root.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  // Reordering pages by dragging their thumbnails (spec 013): the mouse after
  // a few pixels, a finger after holding still, so the strip still scrolls.
  const navRef = useRef<HTMLElement>(null);
  const [drag, setDrag] = useState<ThumbDrag | null>(null);
  const moveRef = useRef(onMovePage);
  useEffect(() => {
    moveRef.current = onMovePage;
  }, [onMovePage]);
  const canDrag = !!onMovePage;
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || !canDrag) return;
    let start: {
      index: number;
      x: number;
      y: number;
      active: boolean;
      timer?: number;
    } | null = null;
    let current: ThumbDrag | null = null;
    let suppressClick = false;

    const thumbs = () => [...nav.querySelectorAll<HTMLElement>(".thumbnail")];
    const slotAt = (x: number, y: number) => {
      const row = getComputedStyle(nav).flexDirection.startsWith("row");
      let slot = 0;
      for (const el of thumbs()) {
        const box = el.getBoundingClientRect();
        const middle = row
          ? box.left + box.width / 2
          : box.top + box.height / 2;
        if ((row ? x : y) > middle) slot++;
      }
      // Near an edge, the list scrolls.
      const box = nav.getBoundingClientRect();
      const edge = 32;
      if (row) {
        if (x < box.left + edge) nav.scrollLeft -= 12;
        else if (x > box.right - edge) nav.scrollLeft += 12;
      } else if (y < box.top + edge) nav.scrollTop -= 12;
      else if (y > box.bottom - edge) nav.scrollTop += 12;
      return slot;
    };
    const update = (x: number, y: number) => {
      if (!start) return;
      current = { from: start.index, slot: slotAt(x, y) };
      setDrag(current);
    };
    const finish = (commit: boolean) => {
      if (start?.timer) clearTimeout(start.timer);
      if (start?.active) {
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 0);
        if (commit && current) {
          const { from, slot } = current;
          const to = slot > from ? slot - 1 : slot;
          if (to !== from) moveRef.current?.(from, to);
        }
      }
      start = null;
      current = null;
      setDrag(null);
    };
    const begin = (target: EventTarget | null, x: number, y: number) => {
      const el = (target as HTMLElement | null)?.closest<HTMLElement>(
        ".thumbnail",
      );
      // The page action buttons keep working as buttons.
      if (!el || (target as HTMLElement).closest(".page-actions")) return null;
      return { index: thumbs().indexOf(el), x, y, active: false };
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch" || e.button !== 0) return;
      start = begin(e.target, e.clientX, e.clientY);
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!start || e.pointerType === "touch") return;
      if (!start.active) {
        if (
          Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_DISTANCE
        )
          return;
        start.active = true;
      }
      e.preventDefault();
      update(e.clientX, e.clientY);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "touch" && start) finish(true);
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return finish(false);
      const touch = e.touches[0]!;
      start = begin(e.target, touch.clientX, touch.clientY);
      if (!start) return;
      const pending = start;
      pending.timer = window.setTimeout(() => {
        pending.active = true;
        navigator.vibrate?.(10);
        update(pending.x, pending.y);
      }, HOLD_MS);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!start) return;
      const touch = e.touches[0]!;
      if (!start.active) {
        // Moving before the hold is a scroll.
        if (
          Math.hypot(touch.clientX - start.x, touch.clientY - start.y) >
          HOLD_SLOP
        ) {
          clearTimeout(start.timer);
          start = null;
        }
        return;
      }
      e.preventDefault();
      update(touch.clientX, touch.clientY);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (start?.active) e.preventDefault();
      finish(e.type === "touchend");
    };
    const onClick = (e: MouseEvent) => {
      if (suppressClick) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const onContextMenu = (e: Event) => {
      if (start) e.preventDefault();
    };

    nav.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    nav.addEventListener("touchstart", onTouchStart, { passive: true });
    nav.addEventListener("touchmove", onTouchMove, { passive: false });
    nav.addEventListener("touchend", onTouchEnd);
    nav.addEventListener("touchcancel", onTouchEnd);
    nav.addEventListener("click", onClick, true);
    nav.addEventListener("contextmenu", onContextMenu);
    return () => {
      finish(false);
      nav.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      nav.removeEventListener("touchstart", onTouchStart);
      nav.removeEventListener("touchmove", onTouchMove);
      nav.removeEventListener("touchend", onTouchEnd);
      nav.removeEventListener("touchcancel", onTouchEnd);
      nav.removeEventListener("click", onClick, true);
      nav.removeEventListener("contextmenu", onContextMenu);
    };
  }, [canDrag]);
  /** Where the dragged page would land: a mark before or after a thumbnail. */
  const dropMark = (i: number): "before" | "after" | undefined => {
    if (!drag || drag.slot === drag.from || drag.slot === drag.from + 1)
      return undefined;
    if (drag.slot === i) return "before";
    if (drag.slot === pages.length && i === pages.length - 1) return "after";
    return undefined;
  };

  const goToPage = useCallback((pageNumber: number) => {
    scrollRef.current
      ?.querySelector(`.page[data-page-number="${pageNumber}"]`)
      ?.scrollIntoView({ block: "start" });
    setCurrentPage(pageNumber);
  }, []);

  // Pages can be deleted while one of them is the current page.
  const shownPage = Math.min(currentPage, pages.length);
  const first = pages[0];
  const fit = () => {
    if (!first) return;
    const width = new PageGeometry(first.box, effectiveRotation(first), 1)
      .viewWidth;
    setZoom(fitWidth(width, scrollRef.current?.clientWidth ?? 800));
  };

  const zoomControls = (
    <>
      <span className="toolbar-group zoom-group">
        <button
          type="button"
          onClick={() => setZoom(zoomOut)}
          aria-label={t("viewer.zoomOut")}
        >
          −
        </button>
        <output className="zoom-value" aria-label={t("viewer.zoom")}>
          {formatZoom(zoom)}
        </output>
        <button
          type="button"
          onClick={() => setZoom(zoomIn)}
          aria-label={t("viewer.zoomIn")}
        >
          +
        </button>
        {floating ? (
          // In the floating pill the button is an icon, to keep it small.
          <button
            type="button"
            className="fit-button"
            onClick={fit}
            aria-label={t("viewer.fitWidth")}
            title={t("viewer.fitWidth")}
          >
            <Icon name="fitWidth" size={18} />
          </button>
        ) : (
          <button type="button" className="fit-button" onClick={fit}>
            {t("viewer.fitWidth")}
          </button>
        )}
      </span>
      <span className="page-indicator" aria-live="polite">
        {t("viewer.pageOf", shownPage, pages.length)}
      </span>
    </>
  );

  return (
    <div className={`viewer${thumbnailsOpen ? " thumbs-open" : ""}`}>
      {topBar}
      <div
        className="viewer-toolbar"
        role="toolbar"
        aria-label={t("viewer.toolbar")}
      >
        {toolbar}
        {!floating && zoomControls}
      </div>
      {belowToolbar}
      <div className="viewer-body">
        <nav
          className={`thumbnails${drag ? " dragging" : ""}`}
          aria-label={t("viewer.thumbnails")}
          ref={navRef}
        >
          {thumbnailsHeader}
          {pages.map((entry, i) => (
            <Thumbnail
              key={entry.id}
              doc={doc}
              entry={entry}
              pageNumber={i + 1}
              active={i + 1 === shownPage}
              onSelect={goToPage}
              actions={renderPageActions?.(entry, i)}
              dragged={drag?.from === i}
              dropMark={dropMark(i)}
            />
          ))}
        </nav>
        <div className="pages-area">
          <div className={`pages ${pagesClassName ?? ""}`} ref={scrollRef}>
            <div className="pages-inner" ref={innerRef}>
              {pages.map((entry, i) => (
                <PageView
                  key={entry.id}
                  doc={doc}
                  entry={entry}
                  pageNumber={i + 1}
                  zoom={zoom}
                  onRendered={handleRendered}
                >
                  {renderOverlay
                    ? (geometry) => renderOverlay(entry, geometry)
                    : undefined}
                </PageView>
              ))}
            </div>
          </div>
          {floating && pagesNote}
          {floating && <div className="view-pill">{zoomControls}</div>}
        </div>
        {aside && <aside className="dock">{aside}</aside>}
      </div>
    </div>
  );
}
