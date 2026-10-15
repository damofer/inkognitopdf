import { useEffect, useState, type RefObject } from "react";

/**
 * True once the element comes within `margin` of the scroll viewport, and stays
 * true afterwards: pages are rendered lazily, then kept (spec 001, plan: render perezoso).
 */
export function useNearViewport(
  ref: RefObject<Element | null>,
  margin = "800px",
): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, margin, near]);
  return near;
}
