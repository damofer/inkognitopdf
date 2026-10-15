// Spec 014: a password to open the saved PDF (AES-256), with print and copy
// permissions that the panel says honestly are only advisory.
import { useState, type FormEvent } from "react";
import { useT } from "../i18n";
import type { Protection } from "../engine/pdfCrypto";

interface ProtectPanelProps {
  protection: Protection | null;
  onSet: (protection: Protection) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function ProtectPanel({
  protection,
  onSet,
  onRemove,
  onClose,
}: ProtectPanelProps) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [allowPrint, setAllowPrint] = useState(protection?.allowPrint ?? true);
  const [allowCopy, setAllowCopy] = useState(protection?.allowCopy ?? true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setError(t("protect.empty"));
    if (password !== repeat) return setError(t("protect.mismatch"));
    setError(null);
    onSet({ password, allowPrint, allowCopy });
    setPassword("");
    setRepeat("");
    setStatus(t("protect.set"));
  };

  return (
    <section
      className="split-panel protect-panel"
      role="dialog"
      aria-labelledby="protect-title"
    >
      <header>
        <h2 id="protect-title">{t("protect.title")}</h2>
        <button type="button" aria-label={t("protect.close")} onClick={onClose}>
          ×
        </button>
      </header>
      {protection && (
        <div className="protect-active">
          <p>{t("protect.active")}</p>
          <button
            type="button"
            onClick={() => {
              onRemove();
              setStatus(t("protect.removed"));
            }}
          >
            {t("protect.remove")}
          </button>
        </div>
      )}
      <form className="protect-form" onSubmit={submit} noValidate>
        <label className="split-field">
          <span>{t("protect.password")}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            aria-invalid={error === t("protect.empty") || undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="split-field">
          <span>{t("protect.repeat")}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={repeat}
            aria-invalid={error === t("protect.mismatch") || undefined}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={allowPrint}
            onChange={(e) => setAllowPrint(e.target.checked)}
          />
          {t("protect.allowPrint")}
        </label>
        <label className="toolbar-check">
          <input
            type="checkbox"
            checked={allowCopy}
            onChange={(e) => setAllowCopy(e.target.checked)}
          />
          {t("protect.allowCopy")}
        </label>
        <small className="protect-note">{t("protect.permsNote")}</small>
        <small className="protect-note">{t("protect.forgetNote")}</small>
        <div className="split-preview" role="status">
          {error ? (
            <p className="split-error">{error}</p>
          ) : (
            status && <p>{status}</p>
          )}
        </div>
        <button type="submit" className="primary">
          {t("protect.apply")}
        </button>
      </form>
    </section>
  );
}
