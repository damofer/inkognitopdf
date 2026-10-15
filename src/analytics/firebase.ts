/**
 * Google Analytics through Firebase (spec 011). Loaded only after the visitor
 * accepts: this module is a separate chunk, imported on demand.
 */
import { initializeApp } from "@firebase/app";
import {
  initializeAnalytics,
  isSupported,
  logEvent,
  setAnalyticsCollectionEnabled,
  setConsent,
  type Analytics,
} from "@firebase/analytics";
import type { EventName, EventParams } from "./events";

/** Public identifiers of the web app (they are not secrets). */
const CONFIG = {
  apiKey: "AIzaSyCeXRLhPxPSnPJkITUNvIV5ALYXALdWN14",
  authDomain: "inkognitopdf.firebaseapp.com",
  projectId: "inkognitopdf",
  storageBucket: "inkognitopdf.firebasestorage.app",
  messagingSenderId: "1066377971065",
  appId: "1:1066377971065:web:e3402f5612ce7db55b5ba8",
  measurementId: "G-G1HHR22T6N",
};

let analytics: Promise<Analytics | null> | null = null;

function start(): Promise<Analytics | null> {
  analytics ??= isSupported()
    .then((supported) => {
      if (!supported) return null;
      // Measuring only: nothing for advertising, ever.
      setConsent({
        analytics_storage: "granted",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
      return initializeAnalytics(initializeApp(CONFIG), {
        config: {
          send_page_view: false,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
          // The route only, without query or fragment.
          page_location: location.origin + location.pathname,
        },
      });
    })
    .catch(() => null);
  return analytics;
}

export async function send(name: EventName, params: EventParams) {
  const instance = await start();
  if (instance) logEvent(instance, name as string, params);
}

/** After a rejection: no more collection, and the cookies go away. */
export async function stop() {
  const instance = await analytics;
  if (instance) setAnalyticsCollectionEnabled(instance, false);
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]!.trim();
    if (name.startsWith("_ga"))
      document.cookie = `${name}=; Max-Age=0; path=/; domain=${location.hostname}`;
  }
}
