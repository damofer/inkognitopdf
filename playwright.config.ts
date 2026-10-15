import { defineConfig } from "@playwright/test";

const port = 4173;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: [["list"]],
  // The scanner tests are CPU heavy; with all workers busy, renders take longer.
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Uses the Chrome already installed on the machine; no browser download needed.
    channel: "chrome",
    viewport: { width: 1280, height: 900 },
    // The tests read the Spanish interface (spec 006 picks it from the browser).
    locale: "es-ES",
    // The usage measurement question (spec 011) is answered beforehand;
    // e2e/analytics.spec.ts starts without an answer.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://127.0.0.1:${port}`,
          localStorage: [{ name: "inkognito.analytics", value: "denied" }],
        },
      ],
    },
  },
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
