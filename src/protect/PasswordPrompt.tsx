// Spec 014: asks for the password of an encrypted PDF while it is opened.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";

interface PasswordPromptProps {
  fileName: string;
  /** The last password typed was not correct. */
  wrong: boolean;
  onAnswer: (password: string | null) => void;
}

export function PasswordPrompt({
  fileName,
  wrong,
  onAnswer,
}: PasswordPromptProps) {
  const t = useT();
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAnswer(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);

  return createPortal(
    <div className="dialog-backdrop">
      <form
        className="dialog password-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-title"
        onSubmit={(e) => {
          e.preventDefault();
          onAnswer(password);
        }}
      >
        <h2 id="password-title">{t("protect.askTitle")}</h2>
        <p>{t("protect.askText", fileName)}</p>
        <label className="password-field">
          <span>{t("protect.password")}</span>
          <input
            ref={inputRef}
            type="password"
            autoComplete="off"
            value={password}
            aria-invalid={wrong || undefined}
            aria-describedby={wrong ? "password-error" : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {wrong && (
          <p id="password-error" className="dialog-warning" role="alert">
            {t("protect.wrongPassword")}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={() => onAnswer(null)}>
            {t("protect.cancel")}
          </button>
          <button type="submit" className="primary">
            {t("protect.open")}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
