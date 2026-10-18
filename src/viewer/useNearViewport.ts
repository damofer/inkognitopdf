import { useEffect, useState, type RefObject } from "react";

/**
 * The closest ancestor that scrolls. The margins are measured from it: with
 * the window as root, its clipping hides anything outside it, margin or not.
 */
function scrollParent(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(p);
    if (/auto|scroll/.test(`${overflowX} ${overflowY}`)) return p;
  }
  return null;
}

/**
 * True once the element comes within `margin` of the scroll viewport: pages
 * are rendered lazily (spec 001, plan: render perezoso). Without
 * `releaseMargin` it stays true afterwards; with it, it turns false again once
 * the element is farther than that, so far pages can free their canvas
 * (spec 035).
 */
export function useNearViewport(
  ref: RefObject<Element | null>,
  margin = "800px",
  releaseMargin?: string,
): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (near && !releaseMargin) return;
    // While far, watch for coming near; while near, watch for going far.
    const observer = new IntersectionObserver(
      (entries) => {
        const inside = entries.some((e) => e.isIntersecting);
        if (!near && inside) setNear(true);
        else if (near && !inside) setNear(false);
      },
      { root: scrollParent(el), rootMargin: near ? releaseMargin : margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, margin, releaseMargin, near]);
  return near;
}
