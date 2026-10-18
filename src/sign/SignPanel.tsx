/**
 * Signing panel (spec 004): my signature and initials, placing them with the
 * date, and saving the document signed.
 */
import { useEffect, useState, type ReactNode } from "react";
import { locale, useT, type MessageKey } from "../i18n";
import type { SignatureAsset, SignatureRole } from "../model/signature";
import { keystore } from "../storage/keystore";
import type { Placing } from "../editor/EditLayer";
import { GuideLink } from "./GuideLink";
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

/** Spec 019: whether the date goes under the signature, kept per device. */
const AUTO_DATE_KEY = "inkognito.autoDate";
function readAutoDate(): boolean {
  try {
    return localStorage.getItem(AUTO_DATE_KEY) === "1";
  } catch {
    return false;
  }
}

interface SignPanelProps {
  adopted: Adopted;
  onAdopted: (adopted: Adopted) => void;
  onPlace: (placing: Placing) => void;
  /** Spec 019: the initials on every page at once (documents of 2+ pages). */
  onInitialsEverywhere?: (asset: SignatureAsset) => void;
  onClose: () => void;
  /** Saving section (visual or digital), provided by the editor: the second
   * step (spec 025). */
  children?: ReactNode;
  /** Preparing the document for other signers, under the first step. */
  prepare?: ReactNode;
}

export function SignPanel({
  adopted,
  onAdopted,
  onPlace,
  onInitialsEverywhere,
  onClose,
  children,
  prepare,
}: SignPanelProps) {
  const t = useT();
  const [creating, setCreating] = useState<SignatureRole | null>(null);
  // Spec 025: first place the signature, then save the document signed.
  const [step, setStep] = useState<"place" | "save">("place");
  const [remember, setRemember] = useState(false);
  const [format, setFormat] = useState<DateFormat>("dmy");
  const [name, setName] = useState("");
  const [autoDate, setAutoDate] = useState(readAutoDate);
  const changeAutoDate = (on: boolean) => {
    setAutoDate(on);
    try {
      localStorage.setItem(AUTO_DATE_KEY, on ? "1" : "0");
    } catch {
      // Without storage the choice lasts while the panel is open.
    }
  };

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
      <div className="sign-steps" role="group" aria-label={t("sign.steps")}>
        <button
          type="button"
          aria-pressed={step === "place"}
          onClick={() => setStep("place")}
        >
          {t("sign.stepPlace")}
        </button>
        <button
          type="button"
          aria-pressed={step === "save"}
          onClick={() => setStep("save")}
        >
          {t("sign.stepSave")}
        </button>
      </div>
      {step === "save" ? (
        <>
          {children}
          <GuideLink section="firma-digital" />
          <button
            type="button"
            className="sign-back"
            onClick={() => setStep("place")}
          >
            {t("sign.back")}
          </button>
        </>
      ) : (
        <>
          <div className="sign-slots">
            {(["signature", "initials"] as const).map((role) => {
              const asset = adopted[role];
              return (
                <div key={role} className="sign-slot">
                  <span className="sign-slot-label">{t(ROLE_LABEL[role])}</span>
                  <div
                    className="sign-slot-art"
                    data-testid={`adopted-${role}`}
                  >
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
                        asset &&
                        onPlace({
                          kind: "signature",
                          role,
                          asset,
                          ...(role === "signature" && autoDate
                            ? { date: formatDate(new Date(), format) }
                            : {}),
                        })
                      }
                    >
                      {t(PLACE_LABEL[role])}
                    </button>
                    {role === "initials" && onInitialsEverywhere && (
                      <button
                        type="button"
                        title={t("sign.initialsEverywhereHint")}
                        disabled={!asset}
                        onClick={() => asset && onInitialsEverywhere(asset)}
                      >
                        {t("sign.initialsEverywhere")}
                      </button>
                    )}
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
          <label className="sign-check">
            <input
              type="checkbox"
              checked={autoDate}
              onChange={(e) => changeAutoDate(e.currentTarget.checked)}
            />
            {t("sign.autoDate")}
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
          {prepare}
          <button
            type="button"
            className="primary sign-next"
            onClick={() => setStep("save")}
          >
            {t("sign.next")}
          </button>
        </>
      )}
    </section>
  );
}
