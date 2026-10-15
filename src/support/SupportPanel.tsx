// "Apoyar" / "Support": the app is free; donations are optional links.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { track } from "../analytics/analytics";
import { useLang, useT } from "../i18n";
import {
  donationOrder,
  KOFI,
  LINK_REL,
  LINK_TARGET,
  MERCADO_PAGO,
  type DonationLink,
} from "./donations";

/** The donation options, in the order of the current language. */
export function SupportLinks() {
  const t = useT();
  const lang = useLang();

  const link = (d: DonationLink, label: string, className: string) => (
    <a
      key={d.tier}
      className={className}
      href={d.url}
      target={LINK_TARGET}
      rel={LINK_REL}
      data-tier={d.tier}
      onClick={() => track("donate_click", { tier: d.tier })}
    >
      {label}
    </a>
  );

  const mercadoPago = (first: boolean) => (
    <div key="mp" className="support-group" data-provider="mercadoPago">
      <h3>{first ? t("support.mpTitle") : t("support.fromColombia")}</h3>
      <p className="support-note">{t("support.mpNote")}</p>
      <div className="support-amounts">
        {MERCADO_PAGO.map((d) =>
          link(d, d.amount ?? t("support.other"), "support-link"),
        )}
      </div>
    </div>
  );
  const kofi = (first: boolean) => (
    <div key="kofi" className="support-group" data-provider="kofi">
      {!first && <h3>{t("support.abroad")}</h3>}
      {link(KOFI, t("support.kofi"), "support-link support-kofi")}
      <p className="support-note">{t("support.kofiNote")}</p>
    </div>
  );

  return (
    <>
      {donationOrder(lang).map((provider, i) =>
        provider === "kofi" ? kofi(i === 0) : mercadoPago(i === 0),
      )}
    </>
  );
}

export function SupportPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="dialog support-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <h2 id="support-title">{t("support.title")}</h2>
          <button
            ref={closeRef}
            type="button"
            aria-label={t("support.close")}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <p>{t("support.lead")}</p>
        <SupportLinks />
        <p className="support-note">{t("support.thanks")}</p>
      </section>
    </div>,
    document.body,
  );
}
