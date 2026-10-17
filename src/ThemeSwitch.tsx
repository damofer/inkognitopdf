import { useT } from "./i18n";
import { Icon, type IconName } from "./icons";
import { setTheme, THEMES, useTheme, type ThemeChoice } from "./theme";

const ICON: Record<ThemeChoice, IconName> = {
  system: "system",
  light: "sun",
  dark: "moon",
};

/** System / light / dark, remembered on this device (spec 025). */
export function ThemeSwitch() {
  const theme = useTheme();
  const t = useT();
  return (
    <div className="theme-switch" role="group" aria-label={t("theme.label")}>
      {THEMES.map((choice) => (
        <button
          key={choice}
          type="button"
          aria-pressed={choice === theme}
          aria-label={t(`theme.${choice}`)}
          title={t(`theme.${choice}`)}
          onClick={() => setTheme(choice)}
        >
          <Icon name={ICON[choice]} size={18} />
        </button>
      ))}
    </div>
  );
}
