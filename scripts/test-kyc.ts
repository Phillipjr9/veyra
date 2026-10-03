/**
 * Headless tests for the admin-initiated KYC request flow.
 * Run: npm test   (or: npx tsx scripts/test-kyc.ts)
 */
const backing = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => backing.set(k, v),
  removeItem: (k: string) => backing.delete(k),
};

const store = await import("../src/lib/store.tsx");
let failures = 0;
const expect = (label: string, cond: boolean) => {
  console.log(`${cond ? "✓" : "✗ FAIL:"} ${label}`);
  if (!cond) failures++;
};

// 1. Admin requests verification for a personal member
store.requestKycForUser("user1", { name: "Alex Morgan", business: "", email: "alex@x.co", accountType: "personal" }, {
  requestedBy: "Chief System Admin",
  reason: "Annual compliance review — verification is required to lift your account limits.",
  requirements: ["identity", "address", "selfie"],
});

const peeked = store.peekKycForUser("user1");
expect("status becomes 'requested'", peeked.status === "requested");
expect("completeness seeded (72)", peeked.completeness === 72);

// 2. Peeking a never-seen user must not seed their store
const fresh = store.peekKycForUser("nobody");
expect("unknown user peeks 'not_started'", fresh.status === "not_started");
expect("peek does not seed storage", !backing.has("veyra.account.nobody"));

// 3. Request fields persist through a save/load round-trip
const raw = JSON.parse(backing.get("veyra.account.user1")!);
expect("requestedBy persisted", raw.kyc.requestedBy === "Chief System Admin");
expect("requirements persisted", raw.kyc.requirements.join(",") === "identity,address,selfie");
expect("member notification pushed", raw.notifications.some((n: any) => n.title === "Identity verification requested"));

// 4. Approved accounts are immune to re-requests
backing.set("veyra.account.user2", JSON.stringify({ ...raw, kyc: { ...raw.kyc, status: "approved" } }));
store.requestKycForUser("user2", { name: "Hana Park", business: "Park & Co", email: "h@x.co", accountType: "business" }, { requestedBy: "Admin", reason: "re-check", requirements: ["funds"] });
expect("approved status immutable", store.peekKycForUser("user2").status === "approved");

console.log(failures === 0 ? "\nALL KYC FLOW TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
