/**
 * Account applications: the identity data a bank has to collect before it can
 * open a checking or business account, and the rules that make each field
 * usable by compliance.
 *
 * This module is the single source of truth for those rules. The API validates
 * with it before anything is stored; the sign-up form mirrors the same
 * requirements client-side so people get told immediately, but the server never
 * trusts that — a hand-rolled request gets the same treatment as the form.
 *
 * Stored values are normalised here (SSN `123-45-6789`, EIN `12-3456789`,
 * states upper-case, dates `YYYY-MM-DD`) so every record in the database has
 * one shape, and every message is written for the person filling the form in.
 */

export type AccountType = "personal" | "business";

export const ID_TYPES = [
  "Driver's license",
  "State ID card",
  "US passport",
  "Permanent resident card",
  "Military ID",
] as const;

export const INCOME_RANGES = [
  "Under $25,000",
  "$25,000 – $50,000",
  "$50,000 – $100,000",
  "$100,000 – $250,000",
  "Over $250,000",
] as const;

export const SOURCES_OF_FUNDS = [
  "Salary or wages",
  "Business income",
  "Savings",
  "Investments",
  "Inheritance or gift",
  "Property sale",
  "Other",
] as const;

export const BUSINESS_TYPES = [
  "Sole proprietorship",
  "Single-member LLC",
  "Multi-member LLC",
  "Corporation",
  "S corporation",
  "Partnership",
  "Non-profit",
] as const;

export const MONTHLY_VOLUMES = [
  "Under $10,000",
  "$10,000 – $50,000",
  "$50,000 – $250,000",
  "$250,000 – $1,000,000",
  "Over $1,000,000",
] as const;

/** Every field of an application, after normalisation. */
export type ApplicationValues = {
  firstName: string; middleName: string; lastName: string;
  dob: string; ssn: string; citizenship: string; phone: string; email: string;
  addressLine1: string; addressLine2: string; city: string; state: string; postalCode: string; country: string;
  idType: string; idNumber: string; idIssuer: string; idExpiry: string;
  occupation: string; employer: string; incomeRange: string; sourceOfFunds: string;
  legalName: string; dba: string; ein: string;
  businessType: string; formationState: string; formationDate: string; industry: string; website: string; monthlyVolume: string;
  bizAddressLine1: string; bizAddressLine2: string; bizCity: string; bizState: string; bizPostalCode: string; bizCountry: string;
  ownerName: string; ownerTitle: string; ownerDob: string; ownerSsn: string; ownerOwnership: number;
};

export type ValidationResult =
  | { ok: true; value: ApplicationValues }
  | { ok: false; error: string; field: string };

const NAME_RE = /^[A-Za-z][A-Za-z '.,-]{0,59}$/;
const DIGITS = (v: string) => v.replace(/\D/g, "");

const text = (raw: unknown) => (typeof raw === "string" ? raw.trim() : "");

/** `YYYY-MM-DD` → Date at UTC midnight, or null when not a real calendar date. */
function parseDate(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? date : null;
}

export function ageOn(dob: string): number | null {
  const date = parseDate(dob);
  if (!date) return null;
  const nowDate = new Date();
  let age = nowDate.getUTCFullYear() - date.getUTCFullYear();
  const beforeBirthday = nowDate.getUTCMonth() < date.getUTCMonth()
    || (nowDate.getUTCMonth() === date.getUTCMonth() && nowDate.getUTCDate() < date.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * US Social Security number rules, not just a shape check: area 000, 666 and
 * 900–999 are never issued, group 00 and serial 0000 are invalid too.
 */
export function normaliseSsn(raw: string): string | null {
  const digits = DIGITS(raw);
  if (digits.length !== 9) return null;
  const [area, group, serial] = [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5)];
  if (area === "000" || area === "666" || area.startsWith("9")) return null;
  if (group === "00" || serial === "0000") return null;
  return `${area}-${group}-${serial}`;
}

export function normaliseEin(raw: string): string | null {
  const digits = DIGITS(raw);
  if (digits.length !== 9) return null;
  const prefix = digits.slice(0, 2);
  if (prefix === "00" || prefix === "07" || prefix === "08" || prefix === "09") return null;
  return `${prefix}-${digits.slice(2)}`;
}

const mask = (value: string, visible = 4) =>
  value.length <= visible ? value : `${"•".repeat(Math.max(0, value.length - visible - 1))}${value.slice(-visible)}`;

/** `•••••6789` — what the member sees back on their own profile. */
export const maskSsn = (ssn: string) => (ssn ? `•••-••-${ssn.slice(-4)}` : "");
export const maskEin = (ein: string) => (ein ? `••-•••${ein.slice(-4)}` : "");
export const maskIdNumber = (id: string) => (id ? mask(id, 4) : "");

/**
 * Validate a whole application. Fields are checked in the order the form asks
 * for them, so the first error a person sees is the first thing to fix.
 */
export function validateApplication(accountType: AccountType, raw: unknown): ValidationResult {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const v: ApplicationValues = {
    firstName: text(input.firstName), middleName: text(input.middleName), lastName: text(input.lastName),
    dob: text(input.dob), ssn: text(input.ssn), citizenship: text(input.citizenship),
    phone: text(input.phone), email: text(input.email),
    addressLine1: text(input.addressLine1), addressLine2: text(input.addressLine2), city: text(input.city),
    state: text(input.state).toUpperCase(), postalCode: text(input.postalCode), country: text(input.country),
    idType: text(input.idType), idNumber: text(input.idNumber).toUpperCase(), idIssuer: text(input.idIssuer), idExpiry: text(input.idExpiry),
    occupation: text(input.occupation), employer: text(input.employer),
    incomeRange: text(input.incomeRange), sourceOfFunds: text(input.sourceOfFunds),
    legalName: text(input.legalName), dba: text(input.dba), ein: text(input.ein),
    businessType: text(input.businessType), formationState: text(input.formationState).toUpperCase(),
    formationDate: text(input.formationDate), industry: text(input.industry), website: text(input.website),
    monthlyVolume: text(input.monthlyVolume),
    bizAddressLine1: text(input.bizAddressLine1), bizAddressLine2: text(input.bizAddressLine2),
    bizCity: text(input.bizCity), bizState: text(input.bizState).toUpperCase(),
    bizPostalCode: text(input.bizPostalCode), bizCountry: text(input.bizCountry),
    ownerName: text(input.ownerName), ownerTitle: text(input.ownerTitle), ownerDob: text(input.ownerDob),
    ownerSsn: text(input.ownerSsn), ownerOwnership: Number(input.ownerOwnership ?? 0),
  };

  const fail = (field: string, error: string): ValidationResult => ({ ok: false, error, field });

  if (!NAME_RE.test(v.firstName)) return fail("firstName", "Enter your legal first name as it appears on your ID.");
  if (v.middleName && !NAME_RE.test(v.middleName)) return fail("middleName", "Enter your middle name as it appears on your ID, or leave it blank.");
  if (!NAME_RE.test(v.lastName)) return fail("lastName", "Enter your legal last name as it appears on your ID.");

  const age = ageOn(v.dob);
  if (age === null) return fail("dob", "Enter your date of birth.");
  if (age < 18) return fail("dob", "You must be at least 18 years old to open an account.");
  if (age > 120) return fail("dob", "Enter a valid date of birth.");

  const ssn = normaliseSsn(v.ssn);
  if (!ssn) return fail("ssn", "Enter a valid Social Security number, in the format 123-45-6789.");
  v.ssn = ssn;

  if (!v.citizenship) return fail("citizenship", "Select your country of citizenship.");
  if (DIGITS(v.phone).length < 10) return fail("phone", "Enter a mobile number with at least 10 digits.");
  if (!/^\S+@\S+\.\S+$/.test(v.email)) return fail("email", "Enter a valid email address.");

  if (!v.addressLine1) return fail("addressLine1", "Enter your street address.");
  if (!v.city) return fail("city", "Enter your city.");
  if (!/^[A-Z]{2}$/.test(v.state)) return fail("state", "Enter your 2-letter state code, e.g. NY.");
  if (!/^\d{5}(-\d{4})?$/.test(v.postalCode)) return fail("postalCode", "Enter a 5-digit ZIP code.");
  if (!v.country) return fail("country", "Select your country of residence.");

  if (!(ID_TYPES as readonly string[]).includes(v.idType)) return fail("idType", "Choose the identity document you will present.");
  if (v.idNumber.length < 4) return fail("idNumber", "Enter the document number from your ID.");
  if (!v.idIssuer) return fail("idIssuer", "Enter the state or country that issued your ID.");
  const expiry = parseDate(v.idExpiry);
  if (!expiry) return fail("idExpiry", "Enter the expiry date printed on your ID.");
  if (expiry.getTime() < Date.now()) return fail("idExpiry", "That ID has expired — use a valid, unexpired document.");

  if (!v.occupation) return fail("occupation", "Enter your occupation.");
  if (!INCOME_RANGES.includes(v.incomeRange as (typeof INCOME_RANGES)[number])) return fail("incomeRange", "Select your annual income range.");
  if (!SOURCES_OF_FUNDS.includes(v.sourceOfFunds as (typeof SOURCES_OF_FUNDS)[number])) {
    return fail("sourceOfFunds", "Select where the money for this account will come from.");
  }

  if (accountType === "business") {
    if (v.legalName.length < 2) return fail("legalName", "Enter the business's registered legal name.");
    if (v.dba && v.dba.length < 2) return fail("dba", "Enter the trading name, or leave it blank.");
    const ein = normaliseEin(v.ein);
    if (!ein) return fail("ein", "Enter a valid 9-digit business EIN, in the format 12-3456789.");
    v.ein = ein;
    if (!BUSINESS_TYPES.includes(v.businessType as (typeof BUSINESS_TYPES)[number])) return fail("businessType", "Select the business structure.");
    if (!/^[A-Z]{2}$/.test(v.formationState)) return fail("formationState", "Enter the 2-letter state where the business was formed.");
    const formed = parseDate(v.formationDate);
    if (!formed) return fail("formationDate", "Enter the date the business was formed.");
    if (formed.getTime() > Date.now()) return fail("formationDate", "The formation date can't be in the future.");
    if (!v.industry) return fail("industry", "Enter the industry the business operates in.");
    if (v.website && !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v.website)) return fail("website", "Enter a valid website address, or leave it blank.");
    if (!MONTHLY_VOLUMES.includes(v.monthlyVolume as (typeof MONTHLY_VOLUMES)[number])) {
      return fail("monthlyVolume", "Select the expected monthly deposit volume.");
    }
    if (!v.bizAddressLine1) return fail("bizAddressLine1", "Enter the business's street address.");
    if (!v.bizCity) return fail("bizCity", "Enter the business's city.");
    if (!/^[A-Z]{2}$/.test(v.bizState)) return fail("bizState", "Enter the business's 2-letter state code.");
    if (!/^\d{5}(-\d{4})?$/.test(v.bizPostalCode)) return fail("bizPostalCode", "Enter the business's 5-digit ZIP code.");
    if (!v.bizCountry) return fail("bizCountry", "Select the business's country.");

    if (!NAME_RE.test(v.ownerName)) return fail("ownerName", "Enter the full legal name of the beneficial owner.");
    if (!v.ownerTitle) return fail("ownerTitle", "Enter the owner's title, e.g. Managing Member.");
    const ownerAge = ageOn(v.ownerDob);
    if (ownerAge === null) return fail("ownerDob", "Enter the owner's date of birth.");
    if (ownerAge < 18) return fail("ownerDob", "A beneficial owner must be at least 18 years old.");
    const ownerSsn = normaliseSsn(v.ownerSsn);
    if (!ownerSsn) return fail("ownerSsn", "Enter the owner's valid Social Security number, in the format 123-45-6789.");
    v.ownerSsn = ownerSsn;
    if (!Number.isInteger(v.ownerOwnership) || v.ownerOwnership < 25 || v.ownerOwnership > 100) {
      return fail("ownerOwnership", "Enter the owner's percentage of the business (25–100).");
    }
  }

  return { ok: true, value: v };
}

/** The shape the member sees for their own record — tax IDs masked. */
export function memberIdentity(accountType: AccountType, v: ApplicationValues) {
  return {
    firstName: v.firstName, middleName: v.middleName, lastName: v.lastName,
    dob: v.dob, citizenship: v.citizenship, phone: v.phone, email: v.email,
    addressLine1: v.addressLine1, addressLine2: v.addressLine2, city: v.city,
    state: v.state, postalCode: v.postalCode, country: v.country,
    idType: v.idType, idNumber: maskIdNumber(v.idNumber), idIssuer: v.idIssuer, idExpiry: v.idExpiry,
    occupation: v.occupation, employer: v.employer, incomeRange: v.incomeRange, sourceOfFunds: v.sourceOfFunds,
    ssn: maskSsn(v.ssn),
    ...(accountType === "business" ? {
      legalName: v.legalName, dba: v.dba, ein: maskEin(v.ein), businessType: v.businessType,
      formationState: v.formationState, formationDate: v.formationDate, industry: v.industry,
      website: v.website, monthlyVolume: v.monthlyVolume,
      bizAddressLine1: v.bizAddressLine1, bizAddressLine2: v.bizAddressLine2, bizCity: v.bizCity,
      bizState: v.bizState, bizPostalCode: v.bizPostalCode, bizCountry: v.bizCountry,
      ownerName: v.ownerName, ownerTitle: v.ownerTitle, ownerDob: v.ownerDob,
      ownerSsn: maskSsn(v.ownerSsn), ownerOwnership: v.ownerOwnership,
    } : {}),
  };
}

/** Which fields each account type must have before the application is complete. */
export function requiredFields(accountType: AccountType): string[] {
  const base = [
    "firstName", "lastName", "dob", "ssn", "citizenship", "phone", "email",
    "addressLine1", "city", "state", "postalCode", "country",
    "idType", "idNumber", "idIssuer", "idExpiry",
    "occupation", "incomeRange", "sourceOfFunds",
  ];
  if (accountType === "personal") return base;
  return [...base, "legalName", "ein", "businessType", "formationState", "formationDate", "industry",
    "monthlyVolume", "bizAddressLine1", "bizCity", "bizState", "bizPostalCode", "bizCountry",
    "ownerName", "ownerTitle", "ownerDob", "ownerSsn", "ownerOwnership"];
}

/** 0–100 score of how complete an application is, used for the KYC record. */
export function completeness(accountType: AccountType, values: Partial<Record<string, unknown>>): number {
  const required = requiredFields(accountType);
  const filled = required.filter((f) => {
    const val = values[f];
    return val !== undefined && val !== null && String(val).trim() !== "" && val !== 0;
  }).length;
  return Math.round((filled / required.length) * 100);
}

/** Parses a stored identity_profiles row into ApplicationValues. */
export function rowToApplication(row: Record<string, unknown>): ApplicationValues {
  const s = (k: string) => String(row[k] ?? "");
  return {
    firstName: s("first_name"), middleName: s("middle_name"), lastName: s("last_name"),
    dob: s("dob"), ssn: s("ssn"), citizenship: s("citizenship"), phone: s("phone"), email: s("email"),
    addressLine1: s("address_line1"), addressLine2: s("address_line2"), city: s("city"),
    state: s("state"), postalCode: s("postal_code"), country: s("country"),
    idType: s("id_type"), idNumber: s("id_number"), idIssuer: s("id_issuer"), idExpiry: s("id_expiry"),
    occupation: s("occupation"), employer: s("employer"), incomeRange: s("income_range"), sourceOfFunds: s("source_of_funds"),
    legalName: s("legal_name"), dba: s("dba"), ein: s("ein"),
    businessType: s("business_type"), formationState: s("formation_state"), formationDate: s("formation_date"),
    industry: s("industry"), website: s("website"), monthlyVolume: s("monthly_volume"),
    bizAddressLine1: s("biz_address_line1"), bizAddressLine2: s("biz_address_line2"), bizCity: s("biz_city"),
    bizState: s("biz_state"), bizPostalCode: s("biz_postal_code"), bizCountry: s("biz_country"),
    ownerName: s("owner_name"), ownerTitle: s("owner_title"), ownerDob: s("owner_dob"),
    ownerSsn: s("owner_ssn"), ownerOwnership: Number(row.owner_ownership ?? 0),
  };
}

/** Column order for the insert/update statement. */
export const PROFILE_COLUMNS: Array<[keyof ApplicationValues, string]> = [
  ["firstName", "first_name"], ["middleName", "middle_name"], ["lastName", "last_name"],
  ["dob", "dob"], ["ssn", "ssn"], ["citizenship", "citizenship"], ["phone", "phone"], ["email", "email"],
  ["addressLine1", "address_line1"], ["addressLine2", "address_line2"], ["city", "city"],
  ["state", "state"], ["postalCode", "postal_code"], ["country", "country"],
  ["idType", "id_type"], ["idNumber", "id_number"], ["idIssuer", "id_issuer"], ["idExpiry", "id_expiry"],
  ["occupation", "occupation"], ["employer", "employer"], ["incomeRange", "income_range"], ["sourceOfFunds", "source_of_funds"],
  ["legalName", "legal_name"], ["dba", "dba"], ["ein", "ein"],
  ["businessType", "business_type"], ["formationState", "formation_state"], ["formationDate", "formation_date"],
  ["industry", "industry"], ["website", "website"], ["monthlyVolume", "monthly_volume"],
  ["bizAddressLine1", "biz_address_line1"], ["bizAddressLine2", "biz_address_line2"], ["bizCity", "biz_city"],
  ["bizState", "biz_state"], ["bizPostalCode", "biz_postal_code"], ["bizCountry", "biz_country"],
  ["ownerName", "owner_name"], ["ownerTitle", "owner_title"], ["ownerDob", "owner_dob"],
  ["ownerSsn", "owner_ssn"], ["ownerOwnership", "owner_ownership"],
];

/** Full application as the compliance review queue stores and shows it. */
export function submissionFor(accountType: AccountType, v: ApplicationValues, submittedAt: number) {
  const legalName = `${v.firstName}${v.middleName ? ` ${v.middleName}` : ""} ${v.lastName}`.trim();
  return {
    legalName, dob: v.dob, country: v.country, documentType: v.idType, taxId: v.ssn,
    source: v.sourceOfFunds, application: { accountType, ...v }, submittedAt, via: "signup",
  };
}
