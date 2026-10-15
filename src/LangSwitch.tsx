import { track } from "./analytics/analytics";
import { LANGS, setLang, useLang, useT } from "./i18n";

/** ES / EN switch; the choice is remembered on this device (spec 006). */
export function LangSwitch() {
  const lang = useLang();
  const t = useT();
  return (
    <div className="lang-switch" role="group" aria-label={t("lang.label")}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={code === lang}
          aria-label={t(code === "es" ? "lang.es" : "lang.en")}
          onClick={() => {
            if (code !== lang) track("change_language", { lang: code });
            setLang(code);
          }}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
