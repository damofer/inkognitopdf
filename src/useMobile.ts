// Phone layout (spec 007): the width below which the app shows its compact
// top bar, the bottom tool bar and sheets instead of the desktop toolbars.
import { useSyncExternalStore } from "react";

export const MOBILE_QUERY = "(max-width: 760px)";

const media = () => globalThis.matchMedia?.(MOBILE_QUERY);

function subscribe(listener: () => void) {
  const query = media();
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
}

const isMobile = () => media()?.matches ?? false;

/** Whether the phone layout is in use; re-renders when it changes. */
export function useMobile(): boolean {
  return useSyncExternalStore(subscribe, isMobile, () => false);
}

const TOUCH_QUERY = "(pointer: coarse)";
const touchMedia = () => globalThis.matchMedia?.(TOUCH_QUERY);

function subscribeTouch(listener: () => void) {
  const query = touchMedia();
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
}

/** Whether the main pointer is a finger (help says "tap", spec 009). */
export function useTouch(): boolean {
  return useSyncExternalStore(
    subscribeTouch,
    () => touchMedia()?.matches ?? false,
    () => false,
  );
}
