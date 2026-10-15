// Landing page (spec 008): switches the texts the build wrote in English to
// the visitor's language, and runs the ES / EN switch.
import { track, watchConsent } from "../analytics/analytics";
import {
  consentPending,
  getConsent,
  onConsentChange,
  setConsent,
  type Consent,
} from "../analytics/consent";
import { getLang, setLang, t, type Lang, type MessageKey } from "../i18n/core";
import { attrPairs } from "./prerender";
import { donationOrder } from "../support/donations";
import { labelPromo, setupPromo } from "./promo";
import "./landing.css";

function apply() {
  const lang = getLang();
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]"))
    el.textContent = t(el.dataset.i18n as MessageKey);
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-attr]"))
    for (const [attr, key] of attrPairs(el.dataset.i18nAttr ?? ""))
      el.setAttribute(attr, t(key as MessageKey));
  for (const button of document.querySelectorAll<HTMLElement>("[data-lang]"))
    button.setAttribute("aria-pressed", String(button.dataset.lang === lang));
  orderDonations(lang);
  labelPromo();
  showConsent();
  document.documentElement.classList.remove("i18n-pending");
}

/** Donations: the visitor's usual option first, the other one named below. */
function orderDonations(lang: Lang) {
  const box = document.querySelector<HTMLElement>("[data-support-options]");
  if (!box) return;
  donationOrder(lang).forEach((provider, i) => {
    const group = box.querySelector<HTMLElement>(
      `[data-provider="${provider}"]`,
    );
    if (!group) return;
    box.append(group);
    const key =
      i === 0 ? group.dataset.headingFirst : group.dataset.headingLater;
    const heading = group.querySelector<HTMLElement>("[data-support-heading]");
    if (!heading) return;
    heading.hidden = !key;
    heading.textContent = key ? t(key as MessageKey) : "";
  });
}

/** Spec 011: the notice, the state in the analytics section and its buttons. */
function showConsent() {
  const notice = document.querySelector<HTMLElement>("[data-consent-notice]");
  if (notice) notice.hidden = !consentPending();
  const state = document.querySelector<HTMLElement>("[data-analytics-state]");
  const choice = getConsent();
  if (state)
    state.textContent = t(
      choice === "granted"
        ? "privacy.stateGranted"
        : choice === "denied"
          ? "privacy.stateDenied"
          : "privacy.statePending",
    );
  for (const button of document.querySelectorAll<HTMLElement>(
    ".analytics-actions [data-consent]",
  ))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.consent === choice),
    );
}

for (const button of document.querySelectorAll<HTMLElement>("[data-consent]"))
  button.addEventListener("click", () =>
    setConsent(button.dataset.consent as Consent),
  );
onConsentChange(showConsent);

const visit = () =>
  track("page_view", { page_path: "/", page_title: "landing" });
visit();
watchConsent(visit);
for (const link of document.querySelectorAll<HTMLAnchorElement>(
  'a[href="/app/"]',
))
  link.addEventListener("click", () => track("open_app"));

for (const link of document.querySelectorAll<HTMLAnchorElement>("a[data-tier]"))
  link.addEventListener("click", () =>
    track("donate_click", { tier: link.dataset.tier }),
  );

for (const button of document.querySelectorAll<HTMLElement>("[data-lang]"))
  button.addEventListener("click", () => {
    if (button.dataset.lang !== getLang())
      track("change_language", { lang: button.dataset.lang });
    setLang(button.dataset.lang as Lang);
    apply();
  });

setupPromo();
apply();
