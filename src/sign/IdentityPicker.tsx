/**
 * Choosing how to save a signed document (spec 004, HU4–HU5): visual only, or
 * a PAdES digital signature with an identity kept on this device.
 */
import { useEffect, useState } from "react";
import { useT } from "../i18n";
import { keystore } from "../storage/keystore";
import type { Identity, KeyAlgorithm } from "./certificates";

export interface StoredIdentity extends Identity {
  id: string;
  label: string;
}

export type SaveMode = "visual" | "digital";

/** Identities kept on this device; the key stays a non-extractable CryptoKey. */
export async function storedIdentities(): Promise<StoredIdentity[]> {
  try {
    return (await keystore.all<StoredIdentity>("identities")).map(
      (e) => e.value,
    );
  } catch {
    return [];
  }
}

interface IdentityPickerProps {
  busy: boolean;
  /** Ways of saving offered; a signing plan in PAdES mode offers only digital. */
  modes?: SaveMode[];
  /** Offers adding the audit page (spec 004, HU7). */
  offerAudit?: boolean;
  onSave: (
    mode: SaveMode,
    identity: StoredIdentity | null,
    options: { audit: boolean },
  ) => void;
}

export function IdentityPicker({
  busy,
  modes = ["digital", "visual"],
  offerAudit = false,
  onSave,
}: IdentityPickerProps) {
  const t = useT();
  const [audit, setAudit] = useState(false);
  const [mode, setMode] = useState<SaveMode>("digital");
  const [identities, setIdentities] = useState<StoredIdentity[]>([]);
  const [chosen, setChosen] = useState<string>("");
  const [adding, setAdding] = useState<"new" | "p12" | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [algorithm, setAlgorithm] = useState<KeyAlgorithm>("ECDSA");
  const [p12, setP12] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void storedIdentities().then((list) => {
      setIdentities(list);
      if (list[0]) setChosen((c) => c || list[0]!.id);
      else setAdding("new");
    });
  }, []);

  const keep = async (identity: Identity, label: string) => {
    const stored: StoredIdentity = {
      ...identity,
      id: `id-${Date.now().toString(36)}`,
      label,
    };
    if (remember)
      await keystore.put("identities", stored.id, stored).catch(() => {});
    setIdentities((list) => [...list, stored]);
    setChosen(stored.id);
    setAdding(null);
  };

  const create = async () => {
    setWorking(true);
    setError(null);
    try {
      const { createSelfSigned } = await import("./certificates");
      const identity = await createSelfSigned({
        commonName: name.trim(),
        email: email.trim() || undefined,
        algorithm,
      });
      await keep(
        identity,
        t(
          "sign.selfSignedLabel",
          name.trim(),
          algorithm === "ECDSA" ? "ECDSA P-256" : "RSA 3072", // i18n-ignore: algorithm names
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  };

  const importFile = async () => {
    if (!p12) return;
    setWorking(true);
    setError(null);
    try {
      const { importPkcs12, certificateInfo } = await import("./certificates");
      const identity = await importPkcs12(
        new Uint8Array(await p12.arrayBuffer()),
        password,
      );
      setPassword("");
      const info = await certificateInfo(identity.certificate);
      await keep(identity, t("sign.issuedByLabel", info.subject, info.issuer));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setWorking(false);
    }
  };

  const forget = async (id: string) => {
    await keystore.delete("identities", id).catch(() => {});
    setIdentities((list) => list.filter((i) => i.id !== id));
    if (chosen === id) setChosen("");
  };

  const identity = identities.find((i) => i.id === chosen) ?? null;

  return (
    <fieldset className="sign-save" disabled={busy || working}>
      <legend>{t("sign.saveSigned")}</legend>
      {modes.length > 1 && (
        <>
          <label className="sign-check">
            <input
              type="radio"
              name="sign-mode"
              checked={mode === "digital"}
              onChange={() => setMode("digital")}
            />
            {t("sign.modeDigital")}
          </label>
          <label className="sign-check">
            <input
              type="radio"
              name="sign-mode"
              checked={mode === "visual"}
              onChange={() => setMode("visual")}
            />
            {t("sign.modeVisual")}
          </label>
        </>
      )}
      {mode === "visual" && (
        <p className="sign-warning" role="note">
          {t("sign.visualWarning")}
        </p>
      )}
      {mode === "digital" && (
        <>
          {identities.length > 0 && (
            <div className="sign-row">
              <select
                aria-label={t("sign.certificate")}
                value={chosen}
                onChange={(e) => setChosen(e.currentTarget.value)}
              >
                {identities.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
              {identity && (
                <button
                  type="button"
                  onClick={() => void forget(identity.id)}
                  title={t("sign.forgetTitle")}
                >
                  {t("sign.forget")}
                </button>
              )}
            </div>
          )}
          <div className="sign-row">
            <button type="button" onClick={() => setAdding("new")}>
              {t("sign.createOwnCertificate")}
            </button>
            <button type="button" onClick={() => setAdding("p12")}>
              {t("sign.importP12")}
            </button>
          </div>
          {adding === "new" && (
            <div className="sign-sub">
              <input
                type="text"
                aria-label={t("sign.signerName")}
                placeholder={t("sign.fullName")}
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
              <input
                type="email"
                aria-label={t("sign.emailOptional")}
                placeholder={t("sign.emailOptional")}
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
              <select
                aria-label={t("sign.algorithm")}
                value={algorithm}
                onChange={(e) =>
                  setAlgorithm(e.currentTarget.value as KeyAlgorithm)
                }
              >
                {/* i18n-ignore: algorithm name, the same in every language */}
                <option value="ECDSA">ECDSA P-256</option>
                <option value="RSA">{t("sign.rsaLegacy")}</option>
              </select>
              <p className="sign-note">{t("sign.selfSignedNote")}</p>
              <button
                type="button"
                disabled={!name.trim()}
                onClick={() => void create()}
              >
                {t("sign.createCertificate")}
              </button>
            </div>
          )}
          {adding === "p12" && (
            <div className="sign-sub">
              <input
                type="file"
                accept=".p12,.pfx,application/x-pkcs12"
                aria-label={t("sign.p12File")}
                onChange={(e) => setP12(e.currentTarget.files?.[0] ?? null)}
              />
              <input
                type="password"
                aria-label={t("sign.filePassword")}
                placeholder={t("sign.password")}
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              <button
                type="button"
                disabled={!p12}
                onClick={() => void importFile()}
              >
                {t("sign.import")}
              </button>
            </div>
          )}
          {adding && (
            <label className="sign-check">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.currentTarget.checked)}
              />
              {t("sign.rememberCertificate")}
            </label>
          )}
        </>
      )}
      {offerAudit && (
        <label className="sign-check">
          <input
            type="checkbox"
            checked={audit}
            onChange={(e) => setAudit(e.currentTarget.checked)}
          />
          {t("sign.addAuditPage")}
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        className="primary"
        disabled={mode === "digital" && !identity}
        onClick={() =>
          onSave(mode, mode === "digital" ? identity : null, { audit })
        }
      >
        {busy ? t("sign.signing") : t("sign.saveSigned")}
      </button>
    </fieldset>
  );
}
