import type { FontVariant, SubstituteFamily } from "../engine/fonts";
import { t } from "../i18n/core";

/** Bundled open fonts are served by the app itself (copied from npm at build). */
export async function loadFont(
  family: SubstituteFamily,
  variant: FontVariant,
): Promise<Uint8Array> {
  const url = `${import.meta.env.BASE_URL}fonts/${family}-${variant}.ttf`;
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(t("editor.fontLoadFailed", family, variant));
  return new Uint8Array(await response.arrayBuffer());
}
