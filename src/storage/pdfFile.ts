/**
 * An opened PDF. The original bytes are kept private and never handed out
 * directly: pdf.js transfers (detaches) the buffers it receives, and later
 * editing steps must start from the untouched original (spec 001, HU9 / CA9).
 */
export interface PdfFile {
  readonly name: string;
  readonly size: number;
  /** Returns a fresh copy of the original bytes; callers may consume or mutate it. */
  copyBytes(): Uint8Array;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
/** The header may be preceded by junk; PDF readers search the first 1024 bytes. */
const HEADER_SEARCH_WINDOW = 1024;

export class NotAPdfError extends Error {
  constructor(name: string) {
    super(t("storage.notAPdf", name));
    this.name = "NotAPdfError";
  }
}

export function hasPdfHeader(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - PDF_MAGIC.length, HEADER_SEARCH_WINDOW);
  for (let start = 0; start <= limit; start++)
    if (PDF_MAGIC.every((b, i) => bytes[start + i] === b)) return true;
  return false;
}

export function createPdfFile(name: string, bytes: Uint8Array): PdfFile {
  if (!hasPdfHeader(bytes)) throw new NotAPdfError(name);
  const original = bytes.slice();
  return {
    name,
    size: original.length,
    copyBytes: () => original.slice(),
  };
}

/** Reads a user-selected file entirely in memory; nothing leaves the device. */
export async function openPdfFile(
  file: Blob & { name: string },
): Promise<PdfFile> {
  return createPdfFile(file.name, new Uint8Array(await file.arrayBuffer()));
}
import { t } from "../i18n";
