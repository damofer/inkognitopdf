// Light or dark interface (spec 025): the system's by default, or the one
// chosen in the menu, remembered on this device. The choice is the
// `data-theme` attribute of <html>; styles.css reads it.
import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export const THEMES: readonly ThemeChoice[] = ["system", "light", "dark"];

const STORAGE_KEY = "inkognito.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)"; // i18n-ignore: media query

function stored(): ThemeChoice {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

let current: ThemeChoice = stored();
const listeners = new Set<() => void>();

/** Sets `data-theme` on <html> from the remembered choice. */
export function applyTheme() {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (current === "system") delete root.dataset.theme;
  else root.dataset.theme = current;
}

export function setTheme(choice: ThemeChoice) {
  current = choice;
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Without storage the choice lasts until the page is reloaded.
  }
  applyTheme();
  for (const listener of listeners) listener();
}

const darkMedia = () => globalThis.matchMedia?.(DARK_QUERY);

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = darkMedia();
  media?.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", listener);
  };
}

/** The choice in the menu. */
export function useTheme(): ThemeChoice {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => "system",
  );
}

/** Whether the interface is dark now, by choice or by the system's. */
export function useDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () =>
      current === "dark" ||
      (current === "system" && (darkMedia()?.matches ?? false)),
    () => false,
  );
}
