/**
 * Content-Security-Policy of the site (spec 036). The browser itself refuses
 * any connection that is not to the site, so documents cannot be sent
 * anywhere. The only exception is Google Analytics, which the app contacts
 * only after the visitor accepts the usage measurement (spec 011). Anyone can
 * read this header in the response and check it in the DevTools Network tab.
 *
 * firebase.json and docker/nginx.conf repeat it; a test keeps them equal.
 */
export const CSP = [
  "connect-src 'self' blob: data: https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://firebase.googleapis.com https://firebaseinstallations.googleapis.com",
  "form-action 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");
