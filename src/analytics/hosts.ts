/** Hosts of the production site: its domain and Firebase's own addresses. */
export const PRODUCTION_HOSTS = [
  "inkognitopdf.com",
  "www.inkognitopdf.com",
  "inkognitopdf.web.app",
  "inkognitopdf.firebaseapp.com",
];

/** Local development and the end-to-end tests. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Whether the measurement question is asked on this host: only where the
 * site may measure, and locally to develop it. Copies of the site elsewhere
 * never ask, since they never measure.
 */
export function asksConsent(hostname: string): boolean {
  return PRODUCTION_HOSTS.includes(hostname) || LOCAL_HOSTS.includes(hostname);
}
