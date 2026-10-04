/**
 * Demo accounts — the fixture behind the one-click sign-in buttons on the login
 * page (`?demo=1`, or any `npm run dev` session).
 *
 * Creates two members through the public API (exactly like real traffic, so
 * every number the dashboards show is produced by the backend) and gives each
 * one enough history for its dashboard to look alive:
 *
 *   demo.personal@veyra.dev  personal — balance, cash back, savings goals, card spend
 *   demo.business@veyra.dev  business — client deposits, open invoices, payees,
 *                                       scheduled payments, cards, team
 *
 * The Super Admin is not created here: the server bootstraps it from
 * ADMIN_EMAIL / ADMIN_PASSWORD (dev falls back to the same pair the login page
 * offers). This module only checks that those credentials work, and says so if
 * they don't.
 *
 * Safe to re-run: an account that already has activity is left alone.
 *
 * Two callers:
 *   - scripts/seed-demo.ts  (`npm run demo:seed`) against any running API
 *   - server/src/index.ts   — dev boot, so a fresh database is never empty
 */

export const DEMO_PASSWORD = "veyra-demo-2026";
export const DEMO_ADMIN_EMAIL = "admin@veyra.dev";
export const DEMO_ADMIN_PASSWORD = "veyra-admin-2026";

type Json = Record<string, any>;

type Member = {
  name: string; email: string; accountType: "personal" | "business"; business?: string;
  /** The full account application the demo member signed up with. */
  profile: Record<string, unknown>;
};

/**
 * Demo applications are complete, US-shaped records — the same fields a real
 * applicant fills in — so the staff console has genuine data to display and
 * the compliance queue has something to review.
 */
const PERSONAL_PROFILE = {
  firstName: "Maya", middleName: "Rose", lastName: "Bennett",
  dob: "1991-04-17", ssn: "412-88-6207", citizenship: "United States",
  phone: "+1 (555) 019-2834",
  addressLine1: "1841 Maple Grove Avenue", addressLine2: "Apt 4B",
  city: "Brooklyn", state: "NY", postalCode: "11218", country: "United States",
  idType: "Driver's license", idNumber: "B4720-9183-2244", idIssuer: "New York", idExpiry: "2028-06-30",
  occupation: "Product designer", employer: "Northwind Studio", incomeRange: "$50,000 – $100,000", sourceOfFunds: "Salary or wages",
};

const BUSINESS_PROFILE = {
  firstName: "Tunde", middleName: "", lastName: "Ola",
  dob: "1986-11-02", ssn: "387-52-1140", citizenship: "United States",
  phone: "+1 (555) 014-7781",
  addressLine1: "220 West 34th Street", addressLine2: "Suite 12",
  city: "New York", state: "NY", postalCode: "10001", country: "United States",
  idType: "US passport", idNumber: "554812397", idIssuer: "United States", idExpiry: "2029-09-14",
  occupation: "Logistics manager", employer: "Lagos Logistics Ltd", incomeRange: "$100,000 – $250,000", sourceOfFunds: "Business income",
  legalName: "Lagos Logistics Ltd", dba: "Lagos Logistics", ein: "84-2917716", businessType: "Multi-member LLC",
  formationState: "DE", formationDate: "2019-03-11", industry: "Freight & logistics", website: "lagoslogistics.com",
  monthlyVolume: "$50,000 – $250,000",
  bizAddressLine1: "220 West 34th Street", bizAddressLine2: "Suite 12", bizCity: "New York", bizState: "NY",
  bizPostalCode: "10001", bizCountry: "United States",
  ownerName: "Tunde Ola", ownerTitle: "Managing Member", ownerDob: "1986-11-02", ownerSsn: "387-52-1140", ownerOwnership: 100,
};

const MEMBERS: Member[] = [
  { name: "Maya Bennett", email: "demo.personal@veyra.dev", accountType: "personal", profile: PERSONAL_PROFILE },
  { name: "Tunde Ola", email: "demo.business@veyra.dev", accountType: "business", business: "Lagos Logistics Ltd", profile: BUSINESS_PROFILE },
];

export type DemoAccount = {
  id: string;
  label: string;
  detail: string;
  email: string;
  password: string;
};

/**
 * The accounts the login page may offer with one click. Served by the API (see
 * `/api/demo/accounts`) rather than hard-coded in the client, so the panel
 * appears wherever demo accounts actually exist — dev servers, the static
 * preview, a built bundle — and disappears entirely in production, where this
 * function is never exposed.
 */
export function demoLoginOptions(): DemoAccount[] {
  return [
    { id: "personal", label: "Personal", detail: "Everyday money · goals, cash back, cards", email: MEMBERS[0].email, password: DEMO_PASSWORD },
    { id: "business", label: "Business", detail: "Lagos Logistics Ltd · treasury, invoices, team", email: MEMBERS[1].email, password: DEMO_PASSWORD },
    { id: "admin", label: "Super Admin", detail: "Platform oversight console", email: DEMO_ADMIN_EMAIL, password: DEMO_ADMIN_PASSWORD },
  ];
}

/** True when this server is allowed to advertise demo credentials. */
export function demoLoginsEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.DEMO_SEED !== "0";
}

export type DemoSeedResult = {
  created: number;
  seeded: number;
  skipped: number;
  adminOk: boolean;
  adminEmail: string;
};

export async function seedDemoAccounts(opts: {
  baseUrl: string;
  adminEmail?: string;
  adminPassword?: string;
  log?: (line: string) => void;
}): Promise<DemoSeedResult> {
  const api = opts.baseUrl.replace(/\/$/, "");
  const log = opts.log ?? (() => undefined);
  const adminEmail = opts.adminEmail ?? DEMO_ADMIN_EMAIL;
  const adminPassword = opts.adminPassword ?? DEMO_ADMIN_PASSWORD;

  const call = async (method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: Json }> => {
    const res = await fetch(api + path, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: Json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    return { status: res.status, json };
  };

  const login = async (email: string, password: string) => {
    const r = await call("POST", "/api/auth/login", undefined, { email, password });
    return r.status === 200 ? (r.json.token as string) : null;
  };

  const result: DemoSeedResult = { created: 0, seeded: 0, skipped: 0, adminOk: false, adminEmail };

  const health = await call("GET", "/api/health").catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(`Can't reach the Veyra API at ${api}`);
  }

  // The console token, used to clear the demo applications through the same
  // endpoint staff use. Demo members represent established customers, not
  // applicants waiting in the queue.
  let adminToken = await login(adminEmail, adminPassword);

  for (const member of MEMBERS) {
    let token = await login(member.email, DEMO_PASSWORD);
    let memberId = token ? ((await call("GET", "/api/auth/me", token)).json.user as { id?: string } | undefined)?.id : undefined;
    if (token) {
      log(`· ${member.email} already exists`);
    } else {
      const reg = await call("POST", "/api/auth/register", undefined, { ...member, password: DEMO_PASSWORD, profile: member.profile });
      if (reg.status !== 201) {
        log(`! ${member.email}: ${reg.json.error ?? `HTTP ${reg.status}`}`);
        continue;
      }
      token = reg.json.token as string;
      memberId = (reg.json.user as { id?: string } | undefined)?.id;
      result.created++;
      log(`+ ${member.email} created`);
    }

    // Sign-up now parks the account until a human approves it. A demo member has
    // to look like a customer who has been banking for a while, so approve it —
    // through the real decision endpoint, which is also what keeps this honest.
    if (token && memberId && adminToken) {
      const state = (await call("GET", "/api/me/state", token)).json.account;
      const review = (state?.kyc as { review?: { state?: string } } | undefined)?.review?.state;
      if (review !== "approved") {
        const decision = await call("POST", `/api/admin/kyc/${memberId}/decision`, adminToken, { decision: "approved" });
        if (decision.status === 200) log(`  ${member.email} application approved for the demo`);
        else log(`! ${member.email}: could not approve the demo application (${decision.json.error ?? decision.status})`);
      }
    }

    const state = (await call("GET", "/api/me/state", token)).json.account;
    if ((state?.transactions ?? []).length > 0) {
      log(`  ${member.email} already has activity — left as is`);
      result.skipped++;
      continue;
    }

    if (member.accountType === "personal") {
      await call("POST", "/api/me/deposits", token, { amount: 5200, source: "Payroll — Acme Studio" });
      await call("POST", "/api/me/deposits", token, { amount: 340, source: "Refund — TravelCo" });
      const card = await call("POST", "/api/me/cards", token, { label: "Everyday debit", limit: 2500, type: "virtual" });
      for (const [merchant, amount, category, useCard] of [
        ["Whole Foods", 128.4, "Operations", true],
        ["Blue Bottle Coffee", 18.5, "Operations", true],
        ["Uber", 42.75, "Travel", true],
        ["Netflix", 22.99, "Software", false],
        ["City Electric", 96.12, "Utilities", false],
        ["Zara", 210, "Operations", true],
      ] as Array<[string, number, string, boolean]>) {
        await call("POST", "/api/me/transfers", token, {
          counterparty: merchant, amount, category, method: useCard ? "Card" : "ACH",
          cardId: useCard ? card.json.card?.id : undefined,
        });
      }
      for (const [name, target, move] of [["Japan trip", 4000, 1450], ["Emergency fund", 6000, 2300]] as Array<[string, number, number]>) {
        const pocket = await call("POST", "/api/me/pockets", token, { name, target });
        if (pocket.json.pocket?.id) await call("POST", `/api/me/pockets/${pocket.json.pocket.id}/move`, token, { amount: move, direction: "to_pocket" });
      }
    } else {
      await call("POST", "/api/me/deposits", token, { amount: 48000, source: "Northwind — invoice #1042" });
      await call("POST", "/api/me/deposits", token, { amount: 16500, source: "Lekki Retail — retainer" });
      for (const invoice of [
        { client: "Northwind Freight", clientEmail: "ap@northwind.test", amount: 12400, dueDays: 21, description: "Q4 haulage" },
        { client: "Ikeja Foods", clientEmail: "finance@ikejafoods.test", amount: 5600, dueDays: 7, description: "Cold chain" },
        { client: "Apapa Terminals", clientEmail: "billing@apapa.test", amount: 9300, dueDays: 1, description: "Dock handling" },
      ]) {
        await call("POST", "/api/me/invoices", token, invoice);
      }

      const payees: Array<{ id?: string; name: string }> = [];
      for (const payee of [
        { name: "Cloud Host", bankName: "Civic Bank", routingNumber: "071000288", accountLast4: "9090", accountType: "Checking" },
        { name: "Fleet Fuel", bankName: "Civic Bank", routingNumber: "071000288", accountLast4: "3311", accountType: "Checking" },
      ]) {
        const res = await call("POST", "/api/me/payees", token, payee);
        payees.push({ id: res.json.payee?.id, name: payee.name });
      }
      for (const [payeeIndex, amount, category, inDays, frequency] of [
        [0, 620, "Software", 5, "monthly"],
        [1, 1180, "Operations", 2, "weekly"],
      ] as Array<[number, number, string, number, "weekly" | "monthly"]>) {
        const payee = payees[payeeIndex];
        await call("POST", "/api/me/scheduled", token, {
          payeeId: payee?.id, payeeName: payee?.name, amount, category,
          frequency, nextDate: Date.now() + inDays * 86_400_000, autopay: true, memo: `${category} autopay`,
        });
      }
      for (const [merchant, amount, category, method] of [
        ["DHL Express", 340, "Operations", "ACH"],
        ["AWS", 890, "Software", "ACH"],
        ["Total Energies", 1250, "Operations", "ACH"],
        ["Radisson Blu", 640, "Travel", "ACH"],
        ["Meta Ads", 1500, "Advertising", "ACH"],
      ] as Array<[string, number, string, string]>) {
        await call("POST", "/api/me/transfers", token, { counterparty: merchant, amount, category, method });
      }
      const opsCard = await call("POST", "/api/me/cards", token, { label: "Ops card", limit: 8000, type: "physical" });
      await call("POST", "/api/me/cards", token, { label: "Driver card", limit: 2000, type: "virtual", cardholder: "Kunle" });
      if (opsCard.json.card?.id) {
        await call("POST", "/api/me/transfers", token, { counterparty: "DHL Express", amount: 120, category: "Operations", method: "Card", cardId: opsCard.json.card.id });
      }
      await call("POST", "/api/me/team", token, { name: "Dana Bookkeeper", email: "dana@lagoslogistics.test", role: "Bookkeeper", monthlyLimit: 1500 });
      await call("POST", "/api/me/team", token, { name: "Kunle Driver Ops", email: "kunle@lagoslogistics.test", role: "Member", monthlyLimit: 400 });
    }
    result.seeded++;
    log(`  ${member.email} seeded`);
  }

  // The Super Admin comes from the environment; make sure the one-click
  // credentials on the login page actually work.
  result.adminOk = Boolean(await login(adminEmail, adminPassword));
  if (result.adminOk) {
    log(`· ${adminEmail} (Super Admin) signs in — matches the login page`);
  } else {
    log(`! ${adminEmail} did not accept the login page's password.`);
    log(`  The console bootstraps it from ADMIN_EMAIL / ADMIN_PASSWORD — align those or update DEMO_ACCOUNTS in src/pages/Auth.tsx.`);
  }

  return result;
}
