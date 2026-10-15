// Spec 014: encrypted PDFs are decrypted on the device when they are opened.
// The password is asked for only when the file needs one, and is kept in
// memory only to protect the file again when it is saved.
import { t } from "../i18n";
import { createPdfFile, type PdfFile } from "./pdfFile";

/** Asks for the password of a file; null when the person cancels. */
export type AskPassword = (
  fileName: string,
  wrong: boolean,
) => Promise<string | null>;

export interface Unlocked {
  file: PdfFile;
  /** The password the file was opened with, or null when it had none. */
  password: string | null;
  /** The file was encrypted only to restrict permissions. */
  restricted: boolean;
}

export class UnlockCancelledError extends Error {
  constructor(name: string) {
    super(t("protect.cancelled", name));
    this.name = "UnlockCancelledError";
  }
}

/** The file itself when it is not encrypted, else its decrypted copy. */
export async function unlock(
  file: PdfFile,
  ask: AskPassword,
): Promise<Unlocked> {
  const bytes = file.copyBytes();
  // The engine (pdf-lib) loads only for files that look encrypted.
  if (!/\/Encrypt\b/.test(new TextDecoder("latin1").decode(bytes)))
    return { file, password: null, restricted: false };
  const { isEncrypted, decryptPdf, WrongPasswordError } =
    await import("../engine/pdfCrypto");
  if (!isEncrypted(bytes)) return { file, password: null, restricted: false };
  let password = "";
  let wrong = false;
  for (;;) {
    try {
      const input = bytes.slice();
      const open = await decryptPdf(input, password);
      // The same bytes back: "/Encrypt" was only text, not encryption.
      if (open.bytes === input)
        return { file, password: null, restricted: false };
      return {
        file: createPdfFile(file.name, open.bytes),
        password: open.hadUserPassword ? password : null,
        restricted: !open.hadUserPassword,
      };
    } catch (cause) {
      if (!(cause instanceof WrongPasswordError)) throw cause;
    }
    const answer = await ask(file.name, wrong);
    if (answer === null) throw new UnlockCancelledError(file.name);
    password = answer;
    wrong = true;
  }
}
