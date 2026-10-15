import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import { en } from "./src/i18n/en";
import type { MessageKey } from "./src/i18n/core";
import { prerender } from "./src/landing/prerender";

/** The landing page's texts, in English, written into its HTML (spec 008). */
function englishLanding(key: string): string {
  const message = en[key as MessageKey];
  if (typeof message !== "string")
    throw new Error(`index.html: unknown text key "${key}"`);
  return message;
}

export default defineConfig({
  define: {
    // Lets the user check which build is running (e.g. after an update).
    __BUILD_ID__: JSON.stringify(new Date().toISOString().slice(0, 16)),
  },
  build: {
    // The save engine (pdf-lib + fontkit, ~1.2 MB) is its own chunk, loaded
    // only when saving; the initial bundle stays well under this.
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      // The landing page at "/" and the app at "/app/" (spec 008).
      input: {
        landing: resolve(import.meta.dirname, "index.html"),
        app: resolve(import.meta.dirname, "app/index.html"),
      },
    },
  },
  plugins: [
    react(),
    {
      name: "landing-texts",
      transformIndexHtml: {
        order: "pre",
        handler: (html, ctx) =>
          ctx.path === "/index.html" ? prerender(html, englishLanding) : html,
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      // A new build takes over open tabs at once (no stale code after updates).
      devOptions: { enabled: false },
      manifest: {
        // The id the app was first installed with ("/"), so installs made
        // before the app moved to /app/ are updated rather than duplicated.
        id: "/",
        name: "InkognitoPDF",
        short_name: "InkognitoPDF",
        description:
          "Open-source PDF editor: edit, scan, OCR and sign PDFs. Your documents never leave your device.",
        lang: "en",
        start_url: "/app/",
        scope: "/app/",
        theme_color: "#23272F",
        background_color: "#181b21",
        display: "standalone",
        icons: [
          { src: "brand/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "brand/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "brand/icon-maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "brand/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // App shell plus the pdf.js worker, standard fonts and CMaps, for offline use.
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,ico,pfb,ttf,bcmap}"],
        // The worker serves the whole site ("/"), so the landing page also
        // works offline and installs made when the app lived at "/" keep
        // their worker; navigations inside /app/ fall back to the app.
        navigateFallback: "app/index.html",
        navigateFallbackAllowlist: [/^\/app\//],
        // The open fonts for edited text (7 MB) and the OCR engine and data
        // (~16 MB) are cached on first use. The link-preview images are only
        // for crawlers.
        globIgnores: ["fonts/**", "tesseract/**", "brand/og-*"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes("/fonts/"),
            handler: "CacheFirst",
            options: { cacheName: "pdfcraft-fonts" },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes("/tesseract/"),
            handler: "CacheFirst",
            options: { cacheName: "pdfcraft-ocr" },
          },
        ],
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
