/**
 * Link to the signing guide (spec 036), a page of the site outside the app:
 * opens in another tab, so the document stays open.
 */
import { useT } from "../i18n";

export function GuideLink({
  section,
}: {
  section: "firma-digital" | "varios-firmantes";
}) {
  const t = useT();
  return (
    <a
      className="sign-guide"
      href={`/guia/firmar/#${section}`}
      target="_blank"
      rel="noopener"
      title={t("guide.linkHint")}
    >
      {t("guide.link")}
    </a>
  );
}
