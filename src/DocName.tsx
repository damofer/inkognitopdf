// Spec 034: the name of the open document, in the header, renamed with a
// click. The ".pdf" stays; only what goes before it changes.
import { useRef, useState } from "react";
import { useT } from "./i18n";

/** Longest name kept, without ".pdf". */
export const MAX_STEM = 120;

/**
 * What was typed, as the part of a file name before ".pdf": without the
 * characters Windows, macOS and Android refuse, without a ".pdf" of its own
 * and without the dots and spaces Windows drops at the end.
 */
export function cleanStem(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- control characters are refused too
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
      .trim()
      .replace(/(\.pdf)+$/i, "")
      .replace(/[. ]+$/, "")
      .slice(0, MAX_STEM)
      .trim()
  );
}

interface DocNameProps {
  /** The name shown: "contrato.pdf", or "Documento nuevo". */
  shown: string;
  /** What the field starts with: the shown name without ".pdf". */
  stem: string;
  /** Called with a clean, non-empty stem that differs from `stem`. */
  onRename: (stem: string) => void;
}

export function DocName({ shown, stem, onRename }: DocNameProps) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  // Enter and Esc close the field, and closing it blurs it: once is enough.
  const open = useRef(false);

  if (editing === null)
    return (
      <button
        type="button"
        className="file-name"
        // The name stays what is read; the hint is its description.
        title={t("app.renameHint")}
        onClick={() => {
          open.current = true;
          setEditing(stem);
        }}
      >
        {shown}
      </button>
    );

  const finish = (commit: boolean) => {
    if (!open.current) return;
    open.current = false;
    const next = cleanStem(editing);
    setEditing(null);
    if (commit && next && next !== stem) onRename(next);
  };
  return (
    <span className="file-name editing">
      <input
        // Focus moves here as soon as the name is clicked.
        autoFocus
        value={editing}
        maxLength={MAX_STEM + 20}
        size={Math.max(Math.min(editing.length, 60), 6)}
        spellCheck={false}
        autoComplete="off"
        enterKeyHint="done"
        aria-label={t("app.renameField")}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
          }
        }}
      />
      <span className="file-ext" aria-hidden="true">
        {/* i18n-ignore: the file extension */}
        .pdf
      </span>
    </span>
  );
}
