/**
 * The visitor's choice about usage measurement (spec 011), remembered on this
 * device and shared by the landing and the app. No choice means no measuring.
 */
export type Consent = "granted" | "denied";

const KEY = "inkognito.analytics";
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

/** Whether the notice is shown: no choice yet, or opened again. */
export const consentPending = () => reopened || getConsent() === null;
