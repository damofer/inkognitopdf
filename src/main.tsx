import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "pdfjs-dist/web/pdf_viewer.css";
import "./styles.css";
import "./mobile.css";
import { App } from "./App";

// Caches the app shell so it keeps working offline (PWA). Only in production
// builds: in development a service worker left by a build served on the same
// origin would keep serving old code, so it is removed.
if (import.meta.env.PROD) registerSW({ immediate: true });
else
  void navigator.serviceWorker
    ?.getRegistrations()
    .then((all) => Promise.all(all.map((r) => r.unregister())));

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
