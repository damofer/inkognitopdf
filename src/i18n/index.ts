// Interface language (spec 006): the core (core.ts) plus React hooks.
import { useSyncExternalStore } from "react";
import { getLang, subscribe, t, type Lang } from "./core";

export * from "./core";

/** The current language; the component re-renders when it changes. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** `t`, re-rendering the component when the language changes. */
export function useT() {
  useLang();
  return t;
}
