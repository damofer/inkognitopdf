/**
 * Signatures of the open PDF (spec 004, HU8, CA11) and the trusted roots the
 * user imported (decision D2: no bundled root store).
 */
import { useEffect, useState } from "react";
import { locale, useT, type MessageKey } from "../i18n";
import { keystore } from "../storage/keystore";
import type { SignatureReport } from "./verify";

/** Certificate files: DER, or PEM with one or more certificates. */
export function parseCertificateFile(bytes: Uint8Array): Uint8Array[] {
  const text = new TextDecoder("latin1").decode(bytes);
  const blocks = [
    ...text.matchAll(
      /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g,
    ),
  ];
  if (blocks.length === 0) return [bytes];
  return blocks.map((m) => {
    const raw = atob(m[1]!.replace(/\s+/g, ""));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  });
}

export async function trustedRoots(): Promise<
  { key: string; value: { label: string; der: Uint8Array } }[]
> {
  try {
    return await keystore.all("roots");
  } catch {
    return [];
  }
}

const TRUST: Record<SignatureReport["trust"], MessageKey> = {
  trusted: "sign.trustTrusted",
  selfSigned: "sign.trustSelfSigned",
  unknown: "sign.trustUnknown",
};

const CHANGES: Record<SignatureReport["laterChanges"], MessageKey> = {
  none: "sign.changesNone",
  annotations: "sign.changesAnnotations",
  modified: "sign.changesModified",
};

function statusOf(r: SignatureReport): "ok" | "warn" | "bad" {
  if (r.integrity !== "valid" || r.laterChanges === "modified") return "bad";
  return r.trust === "trusted" ? "ok" : "warn";
}

interface SignaturesPanelProps {
  reports: SignatureReport[];
  onRootsChanged: () => void;
  onClose: () => void;
}

export function SignaturesPanel({
  reports,
  onRootsChanged,
  onClose,
}: SignaturesPanelProps) {
  const t = useT();
  const [roots, setRoots] = useState<
    { key: string; value: { label: string; der: Uint8Array } }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  const reload = () => void trustedRoots().then(setRoots);
  useEffect(reload, []);

  const importRoots = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const { certificateInfo } = await import("./certificates");
      for (const der of parseCertificateFile(
        new Uint8Array(await file.arrayBuffer()),
      )) {
        const info = await certificateInfo(der);
        await keystore.put("roots", info.fingerprint, {
          label: info.subject,
          der,
        });
      }
      reload();
      onRootsChanged();
    } catch {
      setError(t("sign.badCertificateFile"));
    }
  };

  return (
    <section
      className="sign-panel"
      role="dialog"
      aria-label={t("sign.documentSignatures")}
    >
      <header>
        <h2>{t("sign.documentSignatures")}</h2>
        <button
          type="button"
          aria-label={t("sign.closeSignatures")}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {reports.length === 0 && <p>{t("sign.noSignatures")}</p>}
      <ol className="sig-list">
        {reports.map((r, i) => (
          <li
            key={i}
            className={`sig-report sig-${statusOf(r)}`}
            data-testid="sig-report"
          >
            <strong>{r.signer?.subject ?? r.field}</strong>
            <span data-testid="sig-integrity">
              {r.integrity === "valid"
                ? t("sign.integrityValid")
                : t("sign.integrityInvalid", r.problem ?? "")}
            </span>
            <span data-testid="sig-changes">{t(CHANGES[r.laterChanges])}</span>
            <span data-testid="sig-trust">{t(TRUST[r.trust])}</span>
            {r.signedAt && (
              <span>
                {t("sign.signedAt", r.signedAt.toLocaleString(locale()))}
              </span>
            )}
            {r.reason && <span>{t("sign.reason", r.reason)}</span>}
            {r.signer && (
              <details>
                <summary>{t("sign.certificate")}</summary>
                <dl>
                  <dt>{t("sign.certHolder")}</dt>
                  <dd>
                    {r.signer.subject}
                    {r.signer.email ? ` <${r.signer.email}>` : ""}
                  </dd>
                  <dt>{t("sign.certIssuer")}</dt>
                  <dd>{r.signer.issuer}</dd>
                  <dt>{t("sign.certSerial")}</dt>
                  <dd>{r.signer.serial}</dd>
                  <dt>{t("sign.certValidity")}</dt>
                  <dd>
                    {r.signer.notBefore.toLocaleDateString(locale())} –{" "}
                    {r.signer.notAfter.toLocaleDateString(locale())}
                  </dd>
                  <dt>{t("sign.certFingerprint")}</dt>
                  <dd className="sig-fingerprint">{r.signer.fingerprint}</dd>
                </dl>
              </details>
            )}
          </li>
        ))}
      </ol>
      <details className="sig-roots">
        <summary>{t("sign.trustedRoots", roots.length)}</summary>
        <p className="sign-note">{t("sign.trustedRootsNote")}</p>
        <ul>
          {roots.map((r) => (
            <li key={r.key}>
              {r.value.label}{" "}
              <button
                type="button"
                onClick={async () => {
                  await keystore.delete("roots", r.key).catch(() => {});
                  reload();
                  onRootsChanged();
                }}
              >
                {t("sign.remove")}
              </button>
            </li>
          ))}
        </ul>
        <input
          type="file"
          accept=".cer,.crt,.pem,.der"
          aria-label={t("sign.importRoot")}
          onChange={(e) => {
            void importRoots(e.currentTarget.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
        {error && <p role="alert">{error}</p>}
      </details>
    </section>
  );
}
