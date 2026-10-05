/**
 * Veyra's public contact details, in one place. Statements, the Contact page
 * and legal copy all read from here so they can never disagree. Set the
 * VITE_* variables at build time to use your real details.
 */
const env = import.meta.env as Record<string, string | undefined>;

export const COMPANY = {
  legalName: env.VITE_COMPANY_LEGAL_NAME || "Veyra Financial, Inc.",
  street: env.VITE_COMPANY_STREET || "125 Market Street, Suite 400",
  city: env.VITE_COMPANY_CITY || "San Francisco, CA 94105",
  supportEmail: env.VITE_SUPPORT_EMAIL || "support@veyra.example",
  salesEmail: env.VITE_SALES_EMAIL || "sales@veyra.example",
  /** Optional — leave unset until a staffed phone line exists. */
  supportPhone: env.VITE_SUPPORT_PHONE || "",
} as const;

export const companyAddress = `${COMPANY.street}, ${COMPANY.city}`;
