/**
 * The visitor's choice about usage measurement (spec 011), remembered on this
 * device and shared by the landing and the app. No choice means no measuring.
 */
import { asksConsent } from "./hosts";

export type Consent = "granted" | "denied";

/** The one key for the choice, read by the landing and the app alike. */
export const CONSENT_KEY = "inkognito.analytics";
const KEY = CONSENT_KEY;
const listeners = new Set<() => void>();
/** The choice when local storage is blocked: it lasts until the page closes. */
let memory: Consent | null = null;
/** The notice was opened again from «Privacidad». */
let reopened = false;

const notify = () => {
  for (const listener of listeners) listener();
};

export function getConsent(): Consent | null {
  try {
    const value = localStorage.getItem(KEY);
    if (value === "granted" || value === "denied") return value;
  } catch {
    // Blocked storage: see `memory`.
  }
  return memory;
}

export function setConsent(value: Consent) {
  memory = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Blocked storage: kept in `memory`.
  }
  reopened = false;
  notify();
}

export function onConsentChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// A choice made in another tab (the landing and the app share the key).
try {
  window.addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) notify();
  });
} catch {
  // No window (tests): nothing to follow.
}

/** Shows the notice again, to change the choice. */
export function reopenConsent() {
  reopened = true;
  notify();
}

/** Hides the notice opened again without changing the choice. */
export function closeConsent() {
  reopened = false;
  notify();
}

/**
 * Whether the notice is shown: opened again from «Privacidad», or no choice
 * yet on a host that measures (copies of the site elsewhere never ask).
 */
export function consentPending(hostname = currentHost()): boolean {
  return reopened || (getConsent() === null && asksConsent(hostname));
}

function currentHost(): string {
  try {
    return location.hostname;
  } catch {
    return "";
  }
}
