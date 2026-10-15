import { useSyncExternalStore } from "react";
import { useT } from "../i18n";
import { consentPending, onConsentChange, setConsent } from "./consent";

/**
 * Asks once whether usage may be measured (spec 011). Small and out of the
 * way; nothing is measured until «Aceptar».
 */
export function ConsentNotice() {
  const t = useT();
  const pending = useSyncExternalStore(onConsentChange, consentPending);
  if (!pending) return null;
  return (
    <section
      className="consent"
      aria-label={t("privacy.label")}
      data-testid="consent"
    >
      <p>
        {t("privacy.notice")}{" "}
        <a href="/#analytics" target="_blank" rel="noopener">
          {t("privacy.more")}
        </a>
      </p>
      <div className="consent-actions">
        <button type="button" onClick={() => setConsent("denied")}>
          {t("privacy.reject")}
        </button>
        <button type="button" onClick={() => setConsent("granted")}>
          {t("privacy.accept")}
        </button>
      </div>
    </section>
  );
}
