// Voluntary donations: plain links to David's Mercado Pago and Ko-fi pages,
// opened in a new tab. No payment SDK or third-party script runs here.
import type { Lang } from "../i18n/core";

export type DonationTier = "10000" | "20000" | "50000" | "other" | "kofi";

export interface DonationLink {
  tier: DonationTier;
  url: string;
  /** Amount shown as is in every language (Colombian pesos). */
  amount?: string;
}

export const MERCADO_PAGO: readonly DonationLink[] = [
  { tier: "10000", amount: "$10.000 COP", url: "https://mpago.li/1Kyib9Q" },
  { tier: "20000", amount: "$20.000 COP", url: "https://mpago.li/1sVMAt1" },
  { tier: "50000", amount: "$50.000 COP", url: "https://mpago.li/2s9ot7Z" },
  { tier: "other", url: "https://link.mercadopago.com.co/damofer" },
];

export const KOFI: DonationLink = {
  tier: "kofi",
  url: "https://ko-fi.com/damofer",
};

/** In Spanish Mercado Pago comes first; in English, Ko-fi. */
export const donationOrder = (lang: Lang): ("mercadoPago" | "kofi")[] =>
  lang === "es" ? ["mercadoPago", "kofi"] : ["kofi", "mercadoPago"];

/** Every donation link opens a new tab, without opener or referrer. */
export const LINK_TARGET = "_blank";
export const LINK_REL = "noopener noreferrer";
