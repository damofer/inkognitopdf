/**
 * Signing panel (spec 004): my signature and initials, placing them with the
 * date, and saving the document signed.
 */
import { useEffect, useState, type ReactNode } from "react";
import { locale, useT, type MessageKey } from "../i18n";
import type { SignatureAsset, SignatureRole } from "../model/signature";
import { keystore } from "../storage/keystore";
import type { Placing } from "../editor/EditLayer";
import { SignatureArt } from "./SignaturePreview";
import { SignaturePad } from "./SignaturePad";

export type Adopted = Partial<Record<SignatureRole, SignatureAsset>>;

type DateFormat = "dmy" | "iso" | "long";
const DATE_FORMATS: DateFormat[] = ["dmy", "iso", "long"];

export function formatDate(date: Date, format: DateFormat): string {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = String(date.getFullYear());
  if (format === "iso") return `${y}-${m}-${d}`;
  if (format === "long")
    return date.toLocaleDateString(locale(), {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  return `${d}/${m}/${y}`;
}

const ROLE_LABEL: Record<SignatureRole, MessageKey> = {
  signature: "sign.roleSignature",
  initials: "sign.roleInitials",
};

const PLACE_LABEL: Record<SignatureRole, MessageKey> = {
  signature: "sign.placeSignature",
  initials: "sign.placeInitials",
};

/** Initials of a name: "Ana Pérez" → "AP". */
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .join("");

interface SignPanelProps {
  adopted: Adopted;
  onAdopted: (adopted: Adopted) => void;
  onPlace: (placing: Placing) => void;
  onClose: () => void;
  /** Saving section (visual or digital), provided by the editor. */
  children?: ReactNode;
}

export function SignPanel({
  adopted,
  onAdopted,
  onPlace,
  onClose,
  children,
}: SignPanelProps) {
  const t = useT();
  const [creating, setCreating] = useState<SignatureRole | null>(null);
  const [remember, setRemember] = useState(false);
  const [format, setFormat] = useState<DateFormat>("dmy");
  const [name, setName] = useState("");

  // Signatures remembered on this device (CA4).
  useEffect(() => {
    let live = true;
    keystore
      .all<SignatureAsset>("signatures")
      .then((stored) => {
        if (!live || stored.length === 0) return;
        setRemember(true);
        const found: Adopted = {};
        for (const { key, value } of stored)
          if (key === "signature" || key === "initials") found[key] = value;
        onAdopted({ ...found, ...adopted });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // Loads once, when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const adopt = async (role: SignatureRole, asset: SignatureAsset) => {
    onAdopted({ ...adopted, [role]: asset });
    if (asset.kind === "typed" && role === "signature") setName(asset.text);
    setCreating(null);
    if (remember) await keystore.put("signatures", role, asset).catch(() => {});
  };

  const setRemembered = async (on: boolean) => {
    setRemember(on);
    try {
      if (on)
        for (const role of ["signature", "initials"] as const) {
          const asset = adopted[role];
          if (asset) await keystore.put("signatures", role, asset);
        }
      else await keystore.clear("signatures");
    } catch {
      // Without IndexedDB (private mode) the signature stays for this session.
    }
  };

  if (creating)
    return (
      <section className="sign-panel" aria-label={t("sign.sign")}>
        <SignaturePad
          role={creating}
          name={creating === "signature" ? name : initialsOf(name)}
          onDone={(asset) => void adopt(creating, asset)}
          onCancel={() => setCreating(null)}
        />
      </section>
    );

  return (
    <section className="sign-panel" role="dialog" aria-label={t("sign.sign")}>
      <header>
        <h2>{t("sign.sign")}</h2>
        <button
          type="button"
          aria-label={t("sign.closeSign")}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="sign-slots">
        {(["signature", "initials"] as const).map((role) => {
          const asset = adopted[role];
          return (
            <div key={role} className="sign-slot">
              <span className="sign-slot-label">{t(ROLE_LABEL[role])}</span>
              <div className="sign-slot-art" data-testid={`adopted-${role}`}>
                {asset ? (
                  <SignatureArt asset={asset} />
                ) : (
                  <em>{t("sign.notCreated")}</em>
                )}
              </div>
              <div className="sign-row">
                <button type="button" onClick={() => setCreating(role)}>
                  {asset ? t("sign.change") : t("sign.create")}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!asset}
                  onClick={() =>
                    asset && onPlace({ kind: "signature", role, asset })
                  }
                >
                  {t(PLACE_LABEL[role])}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <label className="sign-check">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => void setRemembered(e.currentTarget.checked)}
        />
        {t("sign.rememberOnDevice")}
      </label>
      <div className="sign-row">
        <select
          aria-label={t("sign.dateFormat")}
          value={format}
          onChange={(e) => setFormat(e.currentTarget.value as DateFormat)}
        >
          {DATE_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f === "dmy"
                ? t("sign.dateDmy")
                : f === "iso"
                  ? t("sign.dateIso")
                  : formatDate(new Date(2026, 9, 14), "long")}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() =>
            onPlace({ kind: "text", text: formatDate(new Date(), format) })
          }
        >
          {t("sign.placeDate")}
        </button>
      </div>
      {children}
    </section>
  );
}
