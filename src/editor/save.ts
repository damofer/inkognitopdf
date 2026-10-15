import {
  applyEdits,
  type SaveOptions,
  type SaveResult,
} from "../engine/applyEdits";
import type { FontVariant, SubstituteFamily } from "../engine/fonts";
import type { EditorState } from "../model/document";
import { LANGS, t, tIn } from "../i18n";
import type { PdfFile } from "../storage/pdfFile";
import { browserImageCodec } from "./imageCodec";

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

export function editedFileName(name: string | null): string {
  if (!name) return t("editor.defaultFileName");
  return `${name.replace(/\.pdf$/i, "")} (${t("editor.editedSuffix")}).pdf`;
}

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** " (para firmar)", " (signed)"…: the suffixes of every language. */
function signingSuffix(): RegExp {
  const words = LANGS.flatMap((lang) => [
    tIn(lang, "editor.toSignSuffix"),
    tIn(lang, "editor.signedSuffix"),
  ]).map(escapeRegExp);
  return new RegExp(` \\((${words.join("|")})\\)$`);
}

/** "X.pdf", "X (para firmar).pdf" and "X (firmado).pdf" → "X (firmado).pdf". */
export function signedFileName(name: string | null): string {
  const base = name
    ? name.replace(/\.pdf$/i, "").replace(signingSuffix(), "")
    : t("editor.defaultBaseName");
  return `${base} (${t("editor.signedSuffix")}).pdf`;
}

/** A document prepared for several signers (spec 004, HU6). */
export function preparedFileName(name: string | null): string {
  const base = name ? name.replace(/\.pdf$/i, "") : t("editor.defaultBaseName");
  return `${base} (${t("editor.toSignSuffix")}).pdf`;
}

/** `file` is null for a document started from scratch (HU10). */
export function buildPdf(
  file: PdfFile | null,
  state: EditorState,
  options: SaveOptions = {},
): Promise<SaveResult> {
  return applyEdits(
    file ? file.copyBytes() : new Uint8Array(),
    state,
    { loadFont, images: browserImageCodec },
    options,
  );
}

/**
 * Saves the result as a new file through a regular download, so the original
 * is never overwritten (spec 001, HU9).
 */
export function downloadPdf(bytes: Uint8Array, fileName: string): void {
  downloadFile(bytes, fileName, "application/pdf");
}

export function downloadFile(
  bytes: Uint8Array,
  fileName: string,
  type: string,
): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
