/**
 * Usage measurement (spec 011): events go out only with the visitor's consent,
 * only on the production site, and only as the closed list of `events.ts`.
 */
import { getConsent, onConsentChange } from "./consent";
import { sanitize, type EventName, type EventParams } from "./events";

/** Hosts of the production site: its domain and Firebase's own addresses. */
export const PRODUCTION_HOSTS = [
  "inkognitopdf.com",
  "www.inkognitopdf.com",
  "inkognitopdf.web.app",
  "inkognitopdf.firebaseapp.com",
];
/** Lets the end-to-end tests measure on localhost, with Google intercepted. */
const DEBUG = "inkognito.analytics.debug";

function enabled(): boolean {
  if (getConsent() !== "granted") return false;
  if (PRODUCTION_HOSTS.includes(location.hostname)) return true;
  try {
    return localStorage.getItem(DEBUG) === "1";
  } catch {
    return false;
  }
}

export function track(name: EventName, params: EventParams = {}) {
  if (!enabled()) return;
  const event = sanitize(name, params);
  if (!event) return;
  import("./firebase")
    .then((m) => m.send(event.name, event.params))
    .catch(() => {});
}

const sent = new Set<string>();

/** Counts a feature once per document: `scope` changes when one is opened. */
export function trackOnce(
  scope: string | number,
  name: EventName,
  params: EventParams = {},
) {
  const key = `${scope}:${name}`;
  if (sent.has(key)) return;
  sent.add(key);
  track(name, params);
}

/** Starts measuring when the visitor accepts, and stops when they reject. */
export function watchConsent(onAccept: () => void) {
  let last = getConsent();
  return onConsentChange(() => {
    const now = getConsent();
    if (now === last) return;
    const was = last;
    last = now;
    if (now === "granted") onAccept();
    else if (was === "granted")
      import("./firebase").then((m) => m.stop()).catch(() => {});
  });
}
