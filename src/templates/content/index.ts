// The template catalog (spec 021, CA2) and the names of its categories.
import type { Category, Localized, Template } from "../types";
import { BILLING } from "./billing";
import { L } from "./common";
import { JOBS } from "./jobs";
import { LETTERS } from "./letters";

export const TEMPLATES: Template[] = [...JOBS, ...BILLING, ...LETTERS];

export const CATEGORY_NAMES: Record<Category, Localized> = {
  jobs: L("Empleo", "Jobs"),
  billing: L("Cobros y ventas", "Billing and sales"),
  letters: L("Cartas y constancias", "Letters and certificates"),
};

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
