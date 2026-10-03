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

// 5. Member submits the wizard → appears in the admin review queue
const users = [{ id: "user1", name: "Alex Morgan", email: "alex@x.co", business: "", accountType: "personal", role: "user", hash: "deadbeef" }];
backing.set("veyra.users", JSON.stringify(users));
const submitted = JSON.parse(backing.get("veyra.account.user1")!);
submitted.kyc = {
  ...submitted.kyc,
  status: "in_review",
  completeness: 100,
  submission: {
    legalName: "Alex Morgan", dob: "1991-04-12", country: "United States", documentType: "Passport",
    source: "Employment", taxId: "4821",
    documents: [{ key: "idFront", label: "Government ID — front", name: "passport.jpg" }],
    submittedAt: Date.now(),
  },
};
backing.set("veyra.account.user1", JSON.stringify(submitted));

const queue = store.listKycQueue();
expect("submission appears in review queue", queue.length === 1 && queue[0].userId === "user1");
expect("queue carries submission details", queue[0]?.kyc.submission?.legalName === "Alex Morgan");

// 6. Admin approves → member is verified and notified
store.resolveKycForUser("user1", { name: "Alex Morgan", business: "", email: "alex@x.co", accountType: "personal" }, "approved", "", "Chief System Admin");
const afterApprove = JSON.parse(backing.get("veyra.account.user1")!);
expect("approval sets status approved", afterApprove.kyc.status === "approved");
expect("approval sets completeness 100", afterApprove.kyc.completeness === 100);
expect("approval clears the request fields", afterApprove.kyc.requestedBy === undefined);
expect("approval notification pushed", afterApprove.notifications.some((n: any) => n.title === "Identity verification approved"));
expect("approved member leaves the queue", store.listKycQueue().length === 0);

// 7. Admin requests changes → member sees the reason on their banner
backing.set("veyra.account.user1", JSON.stringify({ ...afterApprove, kyc: { ...afterApprove.kyc, status: "in_review" } }));
store.resolveKycForUser("user1", { name: "Alex Morgan", business: "", email: "alex@x.co", accountType: "personal" }, "needs_attention", "The address document is older than 3 months.", "Chief System Admin");
const afterChanges = JSON.parse(backing.get("veyra.account.user1")!);
expect("changes requested sets needs_attention", afterChanges.kyc.status === "needs_attention");
expect("member sees the admin note", afterChanges.kyc.nextStep === "The address document is older than 3 months.");
expect("changes notification pushed", afterChanges.notifications.some((n: any) => n.title === "Verification changes requested"));

console.log(failures === 0 ? "\nALL KYC FLOW TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
