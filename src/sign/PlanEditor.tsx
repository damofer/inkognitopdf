/**
 * Preparing a document for several signers (spec 004, HU6): who signs, in
 * which order, and where each one signs.
 */
import { useState } from "react";
import { useT } from "../i18n";
import { signFieldLabel, type SignFieldType } from "../model/signature";
import { GuideLink } from "./GuideLink";
import type { PlanMode, PlanSigner } from "./multi";

interface PlanEditorProps {
  signers: PlanSigner[];
  onSigners: (signers: PlanSigner[]) => void;
  mode: PlanMode;
  onMode: (mode: PlanMode) => void;
  /** Types of the fields already placed, per signer id. */
  placed: Record<string, SignFieldType[]>;
  onPlaceField: (signerId: string, field: SignFieldType) => void;
  onPrepare: (withAudit: boolean) => void;
  busy: boolean;
}

const FIELD_TYPES: SignFieldType[] = [
  "signature",
  "initials",
  "date",
  "name",
  "text",
];

export function PlanEditor({
  signers,
  onSigners,
  mode,
  onMode,
  placed,
  onPlaceField,
  onPrepare,
  busy,
}: PlanEditorProps) {
  const t = useT();
  const [withAudit, setWithAudit] = useState(true);
  const update = (id: string, change: Partial<PlanSigner>) =>
    onSigners(signers.map((s) => (s.id === id ? { ...s, ...change } : s)));
  const add = () =>
    onSigners([
      ...signers,
      {
        id: `s${Date.now().toString(36)}${signers.length}`,
        name: "",
        order: (signers.at(-1)?.order ?? 0) + 1,
      },
    ]);
  const missing = signers.filter(
    (s) =>
      !s.name.trim() ||
      !placed[s.id]?.length ||
      (mode === "pades" && !placed[s.id]!.includes("signature")),
  );

  return (
    <details className="sign-plan" open={signers.length > 0}>
      <summary>{t("sign.severalSigners")}</summary>
      <p className="sign-note">{t("sign.planNote")}</p>
      <GuideLink section="varios-firmantes" />
      <div
        className="sign-row"
        role="radiogroup"
        aria-label={t("sign.signatureType")}
      >
        <label className="sign-check">
          <input
            type="radio"
            name="plan-mode"
            checked={mode === "pades"}
            onChange={() => onMode("pades")}
          />
          {t("sign.modePades")}
        </label>
        <label className="sign-check">
          <input
            type="radio"
            name="plan-mode"
            checked={mode === "visual"}
            onChange={() => onMode("visual")}
          />
          {t("sign.modeVisual")}
        </label>
      </div>
      {mode === "visual" && (
        <p className="sign-warning" role="note">
          {t("sign.visualPlanWarning")}
        </p>
      )}
      <ol className="plan-signers">
        {signers.map((s, i) => (
          <li key={s.id} className="plan-signer" data-testid="plan-signer">
            <div className="sign-row">
              <input
                type="number"
                min={1}
                aria-label={t("sign.signerOrder", i + 1)}
                value={s.order}
                className="plan-order"
                onChange={(e) =>
                  update(s.id, {
                    order: Math.max(1, Number(e.currentTarget.value) || 1),
                  })
                }
              />
              <input
                type="text"
                aria-label={t("sign.signerNameN", i + 1)}
                placeholder={t("sign.name")}
                value={s.name}
                onChange={(e) => update(s.id, { name: e.currentTarget.value })}
              />
              <button
                type="button"
                aria-label={t("sign.removeSigner", i + 1)}
                onClick={() => onSigners(signers.filter((o) => o !== s))}
              >
                ×
              </button>
            </div>
            <input
              type="email"
              aria-label={t("sign.signerEmail", i + 1)}
              placeholder={t("sign.emailOptional")}
              value={s.email ?? ""}
              onChange={(e) =>
                update(s.id, { email: e.currentTarget.value || undefined })
              }
            />
            <div
              className="sign-row"
              role="group"
              aria-label={
                s.name
                  ? t("sign.signerFields", s.name)
                  : t("sign.signerFieldsN", i + 1)
              }
            >
              {FIELD_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onPlaceField(s.id, type)}
                >
                  + {signFieldLabel(type)}
                </button>
              ))}
            </div>
            <span className="sign-note">
              {t("sign.fieldsPlaced", placed[s.id]?.length ?? 0)}
            </span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={add}>
        {t("sign.addSigner")}
      </button>
      <label className="sign-check">
        <input
          type="checkbox"
          checked={withAudit}
          onChange={(e) => setWithAudit(e.currentTarget.checked)}
        />
        {t("sign.addAuditPage")}
      </label>
      {signers.length > 0 && missing.length > 0 && (
        <p className="sign-note" role="note">
          {mode === "pades"
            ? t("sign.signersNeedSignature")
            : t("sign.signersNeedField")}
        </p>
      )}
      <button
        type="button"
        className="primary"
        disabled={busy || signers.length === 0 || missing.length > 0}
        onClick={() => onPrepare(withAudit)}
      >
        {t("sign.saveForSigning")}
      </button>
    </details>
  );
}
