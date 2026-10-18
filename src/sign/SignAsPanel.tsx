/**
 * Signing a prepared document as one of its signers (spec 004, HU6, CA9).
 */
import { useState } from "react";
import { useT } from "../i18n";
import type { SignatureRole } from "../model/signature";
import { signFieldLabel } from "../model/signature";
import { GuideLink } from "./GuideLink";
import { IdentityPicker, type StoredIdentity } from "./IdentityPicker";
import type { SignerStatus, SigningPlan } from "./multi";
import type { Adopted } from "./SignPanel";
import { SignatureArt } from "./SignaturePreview";
import { SignaturePad } from "./SignaturePad";

interface SignAsPanelProps {
  plan: SigningPlan;
  status: SignerStatus[];
  signerId: string | null;
  onSigner: (id: string) => void;
  adopted: Adopted;
  onAdopted: (adopted: Adopted) => void;
  busy: boolean;
  onSign: (
    signerId: string,
    texts: Record<string, string>,
    identity: StoredIdentity | null,
    /** Adds a trusted timestamp (spec 040). */
    timestamp?: boolean,
  ) => void;
  onClose: () => void;
}

export function SignAsPanel({
  plan,
  status,
  signerId,
  onSigner,
  adopted,
  onAdopted,
  busy,
  onSign,
  onClose,
}: SignAsPanelProps) {
  const t = useT();
  const [creating, setCreating] = useState<SignatureRole | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const me = status.find((s) => s.signer.id === signerId) ?? null;
  const fields = plan.fields.filter((f) => f.signerId === signerId);
  const roles = (["signature", "initials"] as const).filter((r) =>
    fields.some((f) => f.type === r),
  );
  const missing = roles.filter((r) => !adopted[r]);

  if (creating && me)
    return (
      <section className="sign-panel" aria-label={t("sign.signAs")}>
        <SignaturePad
          role={creating}
          name={
            creating === "signature"
              ? me.signer.name
              : me.signer.name
                  .split(/\s+/)
                  .map((w) => w[0]?.toUpperCase() ?? "")
                  .join("")
          }
          onDone={(asset) => {
            onAdopted({ ...adopted, [creating]: asset });
            setCreating(null);
          }}
          onCancel={() => setCreating(null)}
        />
      </section>
    );

  return (
    <section className="sign-panel" role="dialog" aria-label={t("sign.signAs")}>
      <header>
        <h2>{t("sign.signDocument")}</h2>
        <button
          type="button"
          aria-label={t("sign.closeSignAs")}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <ol className="plan-status">
        {status.map((s) => (
          <li key={s.signer.id} data-testid="plan-status">
            <label className="sign-check">
              <input
                type="radio"
                name="sign-as"
                disabled={!s.canSign}
                checked={signerId === s.signer.id}
                onChange={() => onSigner(s.signer.id)}
              />
              {s.signer.order}. {s.signer.name}
              <span
                className={`plan-badge ${s.done ? "done" : s.canSign ? "turn" : "wait"}`}
              >
                {s.done
                  ? t("sign.statusSigned")
                  : s.canSign
                    ? t("sign.statusTurn")
                    : t("sign.statusWaiting")}
              </span>
            </label>
          </li>
        ))}
      </ol>
      <GuideLink section="varios-firmantes" />
      {plan.mode === "visual" && (
        <p className="sign-warning" role="note">
          {t("sign.visualOnlyDocument")}
        </p>
      )}
      {me && (
        <>
          <p className="sign-note">
            {t(
              "sign.yourFields",
              fields.map((f) => signFieldLabel(f.type)).join(", "),
            )}
          </p>
          {roles.map((role) => (
            <div key={role} className="sign-slot">
              <span className="sign-slot-label">
                {role === "signature"
                  ? t("sign.yourSignature")
                  : t("sign.yourInitials")}
              </span>
              <div className="sign-slot-art">
                {adopted[role] ? (
                  <SignatureArt asset={adopted[role]} />
                ) : (
                  <em>{t("sign.notCreated")}</em>
                )}
              </div>
              <button type="button" onClick={() => setCreating(role)}>
                {adopted[role] ? t("sign.change") : t("sign.create")}
              </button>
            </div>
          ))}
          {fields
            .filter((f) => f.type === "text")
            .map((f, i) => (
              <input
                key={f.id}
                type="text"
                aria-label={t("sign.textN", i + 1)}
                placeholder={t("sign.textN", i + 1)}
                value={texts[f.id] ?? ""}
                onChange={(e) =>
                  setTexts({ ...texts, [f.id]: e.currentTarget.value })
                }
              />
            ))}
          {missing.length > 0 ? (
            <p className="sign-note" role="note">
              {missing.includes("signature")
                ? t("sign.createSignatureToContinue")
                : t("sign.createInitialsToContinue")}
            </p>
          ) : plan.mode === "pades" ? (
            <IdentityPicker
              busy={busy}
              modes={["digital"]}
              onSave={(_, identity, { timestamp }) =>
                onSign(me.signer.id, texts, identity, timestamp)
              }
            />
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => onSign(me.signer.id, texts, null)}
            >
              {busy ? t("sign.signing") : t("sign.signAndSave")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
