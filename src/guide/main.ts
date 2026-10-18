// Signing guide (spec 036): switches the texts the build wrote in English,
// and the screenshots, to the visitor's language, and runs the ES / EN
// switch. Measures nothing: the page has no usage analytics.
import { getLang, setLang, type Lang } from "../i18n/core";
import { applyTexts } from "../landing/texts";
import "../landing/landing.css";
import "./guide.css";

/** Screenshots of the app in each language, made by scripts/guide-screenshots.mjs. */
export const shotUrl = (name: string, lang: Lang) =>
  `/guia/firmar/img/${lang}/${name}.webp`; // i18n-ignore: a path

function apply() {
  applyTexts();
  for (const img of document.querySelectorAll<HTMLImageElement>(
    "img[data-shot]",
  ))
    img.src = shotUrl(img.dataset.shot!, getLang());
  document.documentElement.classList.remove("i18n-pending");
}

for (const button of document.querySelectorAll<HTMLElement>("[data-lang]"))
  button.addEventListener("click", () => {
    setLang(button.dataset.lang as Lang);
    apply();
  });

apply();
