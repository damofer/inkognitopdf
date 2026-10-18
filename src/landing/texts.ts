// Switches the texts the build wrote in English (data-i18n and
// data-i18n-attr, see prerender.ts) to the current language. Shared by the
// landing page (spec 008) and the signing guide (spec 036).
import { getLang, t, type MessageKey } from "../i18n/core";
import { attrPairs } from "./prerender";

export function applyTexts() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n]"))
    el.textContent = t(el.dataset.i18n as MessageKey);
  for (const el of document.querySelectorAll<HTMLElement>("[data-i18n-attr]"))
    for (const [attr, key] of attrPairs(el.dataset.i18nAttr ?? ""))
      el.setAttribute(attr, t(key as MessageKey));
  for (const button of document.querySelectorAll<HTMLElement>("[data-lang]"))
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.lang === getLang()),
    );
}
