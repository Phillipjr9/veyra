/**
 * API integration tests — boots the real server on an ephemeral port with a
 * fresh database and exercises the full surface over HTTP:
 *
 * auth (login/logout), unauthorized access, role restrictions, staff
 * provisioning, customer/account management, deposits & withdrawals,
 * transfers, KYC workflow, risk/fraud workflow, staff & role management,
 * audit logging & immutability, broadcasts, reports/exports, settings,
 * emergency halt, concurrent financial operations, privilege escalation,
 * data integrity, password reset.
 *
 * Nothing is seeded: the only pre-existing account is the Super Admin
 * bootstrapped from ADMIN_* env vars below. Every member and staff account,
 * and every dollar of balance, is created through the public API — exactly
 * like production traffic.
 *
 * Run: npm run test:api   (or: npx tsx server/scripts/test-api.ts)
 */
import { createApp } from "../src/app.js";
import { applicationFor } from "./fixtures.js";
import { decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, normalizeRecoveryCode, totpCode, verifyTotp } from "../src/totp.js";
import { resetRateLimits } from "../src/security.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let failures = 0;
const expect = (label: string, cond: boolean, extra?: string) => {
  console.log(`${cond ? "✓" : "✗ FAIL:"} ${label}${extra && !cond ? ` — ${extra}` : ""}`);
  if (!cond) failures++;
};

/** Parses one CSV line into cells (handles the exports' quoted fields). */
const csvCells = (line: string): string[] => {
  const cells: string[] = [];
  let cell = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (line[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cell); cell = ""; }
    else cell += ch;
  }
  cells.push(cell);
  return cells;
};
const csvRowFor = (csv: string, needle: string): string[] | null => {
  const line = csv.split("\n").find(l => l.includes(needle));
  return line ? csvCells(line) : null;
};

const tmp = mkdtempSync(join(tmpdir(), "veyra-api-test-"));
// Clean production instance — env-bootstrapped admin, no other identities.
process.env.ADMIN_EMAIL = "ops@veyra.test";
process.env.ADMIN_PASSWORD = "admin-pass-123";
process.env.ADMIN_NAME = "Ops Admin";
const { app, db } = createApp(join(tmp, "test.db"));
const server = await new Promise<{ port: number }>(resolve => {
  const s = app.listen(0, "127.0.0.1", () => resolve({ port: (s.address() as { port: number }).port }));
});
const base = `http://127.0.0.1:${server.port}`;

const api = async (method: string, path: string, token?: string, body?: unknown, deviceId?: string) => {
  const res = await fetch(base + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(deviceId ? { "X-Veyra-Device": deviceId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* csv or empty */ }
  return { status: res.status, json, text, headers: res.headers };
};

const register = async (name: string, email: string, password: string, extra: Record<string, unknown> = {}) => {
  const accountType = extra.accountType === "personal" ? "personal" : "business";
  const profile = (extra.profile as Record<string, unknown> | undefined)
    ?? applicationFor(accountType, name, typeof extra.business === "string" && extra.business.trim() ? extra.business : undefined);
  return api("POST", "/api/auth/register", undefined, { name, email, password, ...extra, profile });
};

/**
 * Sign-up parks every account in the review queue and the money routes refuse to
 * move until a human clears it. This is how the suite clears the members it is
 * about to move money with — the same decision a reviewer makes.
 */
let decideFor: (userId: string) => Promise<{ status: number }> = async () => ({ status: 0 });

try {
  /* ---------- health & auth ---------- */
  const health = await api("GET", "/api/health");
  expect("health check", health.status === 200 && health.json.ok === true);

  const totpAt = 1_700_000_000_000;
  const knownSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const secret = generateTotpSecret();
  const encryptedSecret = encryptTotpSecret(secret);
  expect("TOTP uses the RFC 6238 six-digit code", totpCode(knownSecret, 59_000) === "287082");
  expect("TOTP accepts clock-skew window and rejects malformed codes",
    verifyTotp(secret, totpCode(secret, totpAt), totpAt) &&
    verifyTotp(secret, totpCode(secret, totpAt - 30_000), totpAt) && !verifyTotp(secret, "abc123", totpAt));
  expect("TOTP secrets encrypt at rest and round-trip", encryptedSecret !== secret && decryptTotpSecret(encryptedSecret) === secret);
  const helperRecoveryCodes = generateRecoveryCodes();
  expect("recovery codes are ten unique, formatted one-time secrets",
    helperRecoveryCodes.length === 10 && new Set(helperRecoveryCodes).size === 10 && helperRecoveryCodes.every(code => /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){2}$/.test(code)));
  expect("recovery code normalization is case/spacing tolerant and stores only a hash",
    normalizeRecoveryCode(` ${helperRecoveryCodes[0].toLowerCase().replaceAll("-", " ")} `) === helperRecoveryCodes[0].replaceAll("-", "") &&
    hashRecoveryCode(helperRecoveryCodes[0]) === hashRecoveryCode(helperRecoveryCodes[0].toLowerCase().replaceAll("-", " ")) &&
    hashRecoveryCode("invalid") === null);

  const bootCount = (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n;
  expect("clean database contains only the bootstrap admin", bootCount === 1);

  const ghostLogin = await api("POST", "/api/auth/login", undefined, { email: "demo@veyra.com", password: "veyra123" });
  expect("no pre-seeded identities exist (login 401)", ghostLogin.status === 401);

  const badLogin = await api("POST", "/api/auth/login", undefined, { email: "ops@veyra.test", password: "wrong" });
  expect("login rejects wrong password (401)", badLogin.status === 401);

  const noToken = await api("GET", "/api/admin/overview");
  expect("unauthenticated admin access rejected (401)", noToken.status === 401);

  const badToken = await api("GET", "/api/admin/overview", "forged.token.here");
  expect("forged token rejected (401)", badToken.status === 401);

  const adminLogin = await api("POST", "/api/auth/login", undefined, { email: "ops@veyra.test", password: "admin-pass-123" });
  expect("env-bootstrapped superadmin login", adminLogin.status === 200 && adminLogin.json.token && adminLogin.json.user.role === "superadmin");
  const admin = adminLogin.json.token;
  const adminId = adminLogin.json.user.id;
  decideFor = (userId: string) => api("POST", `/api/admin/kyc/${userId}/decision`, admin, { decision: "approved", note: "" });

  const hashRow = db.prepare("SELECT password_hash FROM users WHERE email = 'ops@veyra.test'").get() as { password_hash: string };
  expect("passwords stored as scrypt digests, never plaintext", hashRow.password_hash.startsWith("s2$") && !hashRow.password_hash.includes("admin-pass-123"));

  /* ---------- every account is created through the API ---------- */
  const raeReg = await register("Rae Kim", "rae@member.test", "member-pass-1", { accountType: "business", business: "Rae & Co Studio" });
  await decideFor(raeReg.json.user.id); // rae is the suite's working account
  const alexReg = await register("Alex Stone", "alex@member.test", "member-pass-2", { accountType: "personal" });
  const adaReg = await register("Ada Mensah", "ada@staff.test", "staff-pass-1", { accountType: "business", business: "Veyra Financial HQ" });
  const leoReg = await register("Leo Frost", "leo@staff.test", "staff-pass-2", { accountType: "business", business: "Veyra Financial HQ" });
  expect("members register through the API", [raeReg, alexReg, adaReg, leoReg].every(r => r.status === 201));
  const raeId = raeReg.json.user.id, alexId = alexReg.json.user.id;

  const promoteCompliance = await api("POST", `/api/admin/staff/${adaReg.json.user.id}/role`, admin, { role: "compliance" });
  const promoteSupport = await api("POST", `/api/admin/staff/${leoReg.json.user.id}/role`, admin, { role: "support" });
  expect("admin provisions compliance + support staff", promoteCompliance.status === 200 && promoteSupport.status === 200);

  const raeLogin = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" });
  const alexLogin = await api("POST", "/api/auth/login", undefined, { email: "alex@member.test", password: "member-pass-2" });
  const complianceLogin = await api("POST", "/api/auth/login", undefined, { email: "ada@staff.test", password: "staff-pass-1" });
  const supportLogin = await api("POST", "/api/auth/login", undefined, { email: "leo@staff.test", password: "staff-pass-2" });
  const rae = raeLogin.json.token, alex = alexLogin.json.token;
  const compliance = complianceLogin.json.token, support = supportLogin.json.token;
  expect("staff + member logins", rae && alex && compliance && support);

  /* ---------- authenticator-backed two-step sign-in ---------- */
  const initialSecurityState = await api("GET", "/api/me/state", rae);
  expect("new accounts do not claim two-factor is enabled before enrollment",
    initialSecurityState.status === 200 && initialSecurityState.json.account.preferences.twoFactor === false);
  const initialAlertCount = (db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'security'").get(raeId) as { n: number }).n;
  await api("PUT", "/api/me/preferences", rae, { key: "loginAlerts", value: false });
  await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" }, "device-rae-silent-alert-check-01");
  const alertCountWhileOff = (db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'security'").get(raeId) as { n: number }).n;
  await api("PUT", "/api/me/preferences", rae, { key: "loginAlerts", value: true });
  await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" }, "device-rae-alert-check-on-01");
  const alertCountWhileOn = (db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'security'").get(raeId) as { n: number }).n;
  expect("login-alert preference suppresses and enables in-app new-device notifications",
    alertCountWhileOff === initialAlertCount && alertCountWhileOn === alertCountWhileOff + 1);
  const setup2fa = await api("POST", "/api/me/security/two-factor/setup", rae, { password: "member-pass-1" });
  const totpSecret = setup2fa.json.secret as string;
  expect("authenticator setup requires the account password and returns one-time enrollment data",
    setup2fa.status === 200 && /^[A-Z2-7]{32}$/.test(totpSecret) && setup2fa.json.otpauthUrl.startsWith("otpauth://totp/"));
  const storedPendingSecret = db.prepare("SELECT totp_pending_secret_encrypted FROM users WHERE id = ?").get(raeId) as { totp_pending_secret_encrypted: string };
  expect("pending authenticator secret is encrypted in the database",
    Boolean(storedPendingSecret.totp_pending_secret_encrypted) && !storedPendingSecret.totp_pending_secret_encrypted.includes(totpSecret));
  const badSetupConfirmation = await api("POST", "/api/me/security/two-factor/confirm", rae, { password: "member-pass-1", code: "bad-code" });
  expect("authenticator enrollment cannot be enabled without a valid code", badSetupConfirmation.status === 400 &&
    (await api("GET", "/api/me/state", rae)).json.account.preferences.twoFactor === false);
  const confirm2fa = await api("POST", "/api/me/security/two-factor/confirm", rae, { password: "member-pass-1", code: totpCode(totpSecret) });
  const enrolledRecoveryCodes = Array.isArray(confirm2fa.json?.recoveryCodes) ? confirm2fa.json.recoveryCodes as string[] : [];
  const enrolledRecoveryHashes = (db.prepare("SELECT code_hash FROM totp_recovery_codes WHERE user_id = ?").all(raeId) as Array<{ code_hash: string }>).map(row => row.code_hash);
  const stateAfterEnrollment = (await api("GET", "/api/me/state", rae)).json.account;
  expect("valid authenticator enrollment enables MFA and returns ten one-time recovery codes",
    confirm2fa.status === 200 && stateAfterEnrollment.preferences.twoFactor === true &&
    stateAfterEnrollment.recoveryCodesRemaining === 10 && enrolledRecoveryCodes.length === 10);
  expect("recovery codes are stored only as account-scoped hashes",
    enrolledRecoveryHashes.length === 10 && enrolledRecoveryCodes.every(code => enrolledRecoveryHashes.includes(hashRecoveryCode(code) ?? "")) &&
    enrolledRecoveryHashes.every(digest => !enrolledRecoveryCodes.includes(digest)));
  const loginChallenge = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" }, "device-rae-second-browser-0001");
  expect("password login for an enrolled account returns a code challenge without a token",
    loginChallenge.status === 200 && loginChallenge.json.twoFactorRequired === true && Boolean(loginChallenge.json.challengeId) && !loginChallenge.json.token);
  const badMfaCode = await api("POST", "/api/auth/login/verify", undefined, { challengeId: loginChallenge.json.challengeId, code: "bad-code" });
  expect("invalid authenticator or recovery code does not issue a session", badMfaCode.status === 401 && !badMfaCode.json.token);
  const verifiedLogin = await api("POST", "/api/auth/login/verify", undefined, { challengeId: loginChallenge.json.challengeId, code: totpCode(totpSecret) }, "device-rae-second-browser-0001");
  expect("valid authenticator code completes login and records a live session", verifiedLogin.status === 200 && Boolean(verifiedLogin.json.token) &&
    (await api("GET", "/api/auth/me", verifiedLogin.json.token, undefined, "device-rae-second-browser-0001")).status === 200);

  const firstRecoveryCode = enrolledRecoveryCodes[0] ?? "INVALID-CODE";
  const recoveryLoginChallenge = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" }, "device-rae-recovery-browser-0001");
  const recoveryLogin = await api("POST", "/api/auth/login/verify", undefined, {
    challengeId: recoveryLoginChallenge.json.challengeId,
    code: firstRecoveryCode.toLowerCase().replaceAll("-", " "),
  }, "device-rae-recovery-browser-0001");
  const stateAfterRecoveryLogin = (await api("GET", "/api/me/state", rae)).json.account;
  expect("a formatted, case-insensitive recovery code completes MFA login once",
    recoveryLogin.status === 200 && Boolean(recoveryLogin.json.token) && stateAfterRecoveryLogin.recoveryCodesRemaining === 9);
  const reusedCodeChallenge = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" });
  const reusedRecoveryLogin = await api("POST", "/api/auth/login/verify", undefined, {
    challengeId: reusedCodeChallenge.json.challengeId, code: firstRecoveryCode,
  });
  expect("a consumed recovery code cannot be reused for another sign-in",
    reusedRecoveryLogin.status === 401 && !reusedRecoveryLogin.json.token &&
    (await api("GET", "/api/me/state", rae)).json.account.recoveryCodesRemaining === 9);

  const rejectedRegeneration = await api("POST", "/api/me/security/two-factor/recovery-codes/regenerate", rae, {
    password: "member-pass-1", code: "bad-code",
  });
  expect("recovery-code regeneration requires the current authenticator and preserves codes on failure",
    rejectedRegeneration.status === 400 && (await api("GET", "/api/me/state", rae)).json.account.recoveryCodesRemaining === 9);
  const rejectedPasswordRegeneration = await api("POST", "/api/me/security/two-factor/recovery-codes/regenerate", rae, {
    password: "wrong-password", code: totpCode(totpSecret),
  });
  expect("recovery-code regeneration also verifies the current password",
    rejectedPasswordRegeneration.status === 400 && (await api("GET", "/api/me/state", rae)).json.account.recoveryCodesRemaining === 9);
  const regeneration = await api("POST", "/api/me/security/two-factor/recovery-codes/regenerate", rae, {
    password: "member-pass-1", code: totpCode(totpSecret),
  });
  const regeneratedRecoveryCodes = Array.isArray(regeneration.json?.recoveryCodes) ? regeneration.json.recoveryCodes as string[] : [];
  const regeneratedHashes = (db.prepare("SELECT code_hash FROM totp_recovery_codes WHERE user_id = ?").all(raeId) as Array<{ code_hash: string }>).map(row => row.code_hash);
  expect("password plus authenticator regenerates ten codes and replaces the prior set",
    regeneration.status === 200 && regeneratedRecoveryCodes.length === 10 &&
    (await api("GET", "/api/me/state", rae)).json.account.recoveryCodesRemaining === 10 &&
    regeneratedHashes.length === 10 && regeneratedRecoveryCodes.every(code => regeneratedHashes.includes(hashRecoveryCode(code) ?? "")));

  const staleCode = enrolledRecoveryCodes[1] ?? "INVALID-CODE";
  const regeneratedLoginChallenge = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" });
  const staleRecoveryLogin = await api("POST", "/api/auth/login/verify", undefined, {
    challengeId: regeneratedLoginChallenge.json.challengeId, code: staleCode,
  });
  const regeneratedRecoveryLogin = await api("POST", "/api/auth/login/verify", undefined, {
    challengeId: regeneratedLoginChallenge.json.challengeId, code: regeneratedRecoveryCodes[0] ?? "INVALID-CODE",
  });
  expect("regeneration invalidates old codes while a new recovery code can finish login",
    staleRecoveryLogin.status === 401 && regeneratedRecoveryLogin.status === 200 && Boolean(regeneratedRecoveryLogin.json.token) &&
    (await api("GET", "/api/me/state", rae)).json.account.recoveryCodesRemaining === 9);

  const disableWithRecovery = await api("POST", "/api/me/security/two-factor/disable", rae, {
    password: "member-pass-1", code: (regeneratedRecoveryCodes[1] ?? "INVALID-CODE").toLowerCase().replaceAll("-", " "),
  });
  const stateAfterRecoveryDisable = (await api("GET", "/api/me/state", rae)).json.account;
  expect("a one-time recovery code can disable two-step sign-in with the password",
    disableWithRecovery.status === 200 && stateAfterRecoveryDisable.preferences.twoFactor === false &&
    stateAfterRecoveryDisable.recoveryCodesRemaining === 0 &&
    (db.prepare("SELECT COUNT(*) AS n FROM totp_recovery_codes WHERE user_id = ?").get(raeId) as { n: number }).n === 0);

  const secondSetup = await api("POST", "/api/me/security/two-factor/setup", rae, { password: "member-pass-1" });
  const secondTotpSecret = secondSetup.json.secret as string;
  const secondConfirm = await api("POST", "/api/me/security/two-factor/confirm", rae, {
    password: "member-pass-1", code: totpCode(secondTotpSecret),
  });
  const disable2fa = await api("POST", "/api/me/security/two-factor/disable", rae, {
    password: "member-pass-1", code: totpCode(secondTotpSecret),
  });
  expect("turning off two-step sign-in also accepts the current authenticator and clears recovery codes",
    secondSetup.status === 200 && secondConfirm.status === 200 && disable2fa.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.preferences.twoFactor === false &&
    (await api("GET", "/api/me/state", rae)).json.account.recoveryCodesRemaining === 0);
  const loginAfterDisable = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" });
  expect("login returns to the normal flow after authenticator is disabled", loginAfterDisable.status === 200 && Boolean(loginAfterDisable.json.token));
  const fakeTwoFactorPreference = await api("PUT", "/api/me/preferences", rae, { key: "twoFactor", value: true });
  expect("two-factor enrollment cannot be bypassed with a preference edit", fakeTwoFactorPreference.status === 400 &&
    (await api("GET", "/api/me/state", rae)).json.account.preferences.twoFactor === false);

  /* ---------- live sessions, device trust and real revocation ---------- */
  const tokenSessionId = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).jti as string;
  const trustedDeviceId = "device-rae-second-browser-0001";
  const verifiedSessionId = tokenSessionId(verifiedLogin.json.token);
  const trustVerifiedDevice = await api("PATCH", `/api/me/sessions/${verifiedSessionId}`, rae, { trusted: true });
  const repeatDeviceLogin = await api("POST", "/api/auth/login", undefined, { email: "rae@member.test", password: "member-pass-1" }, trustedDeviceId);
  const repeatDeviceTokenId = tokenSessionId(repeatDeviceLogin.json.token);
  const repeatDeviceState = await api("GET", "/api/me/state", repeatDeviceLogin.json.token, undefined, trustedDeviceId);
  const repeatedSessionIsTrusted = repeatDeviceState.json.account.sessions.some((session: any) => session.id === repeatDeviceTokenId && session.trusted);
  expect("persistent device id carries trust to a later sign-in on that browser",
    trustVerifiedDevice.status === 200 && repeatDeviceLogin.status === 200 && repeatedSessionIsTrusted,
    `trust=${trustVerifiedDevice.status}, login=${repeatDeviceLogin.status}, trusted=${repeatedSessionIsTrusted}, session=${repeatDeviceTokenId}`);
  const registeredSessionId = tokenSessionId(raeReg.json.token);
  const currentSessionId = tokenSessionId(rae);
  const sessionsBefore = (await api("GET", "/api/me/state", rae)).json.account.sessions as Array<{ id: string; current: boolean; trusted: boolean }>;
  expect("session projection contains only live sessions and marks the current token exactly once",
    sessionsBefore.some(session => session.id === registeredSessionId) &&
    sessionsBefore.filter(session => session.current).length === 1 &&
    sessionsBefore.find(session => session.id === currentSessionId)?.current === true);
  const selfRevoke = await api("POST", `/api/me/sessions/${currentSessionId}/revoke`, rae);
  expect("server refuses to revoke the session making the request", selfRevoke.status === 400 && (await api("GET", "/api/auth/me", rae)).status === 200);
  const trustSession = await api("PATCH", `/api/me/sessions/${registeredSessionId}`, rae, { trusted: true });
  expect("device trust updates only a live session", trustSession.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.sessions.some((session: any) => session.id === registeredSessionId && session.trusted));
  const revokeSession = await api("POST", `/api/me/sessions/${registeredSessionId}/revoke`, rae);
  expect("revoking a device session invalidates its actual bearer token", revokeSession.status === 200 &&
    (await api("GET", "/api/auth/me", raeReg.json.token)).status === 401 &&
    !(await api("GET", "/api/me/state", rae)).json.account.sessions.some((session: any) => session.id === registeredSessionId));
  const revokeOthers = await api("POST", "/api/me/sessions/revoke-others", rae);
  expect("sign out other devices revokes every other token while preserving this session",
    revokeOthers.status === 200 && revokeOthers.json.revokedCount >= 1 &&
    (await api("GET", "/api/auth/me", verifiedLogin.json.token)).status === 401 &&
    (await api("GET", "/api/auth/me", rae)).status === 200);

  /* ---------- unauthorized & role restrictions ---------- */
  const memberOnAdmin = await api("GET", "/api/admin/overview", rae);
  expect("member blocked from admin routes (403)", memberOnAdmin.status === 403);

  const supportAdjust = await api("POST", `/api/admin/members/${raeId}/adjust`, support, { direction: "credit", amount: 100, memo: "nope" });
  expect("support cannot adjust balances (403)", supportAdjust.status === 403);

  const supportStaff = await api("GET", "/api/admin/staff", support);
  expect("support cannot manage staff (403)", supportStaff.status === 403);

  const complianceAdjust = await api("POST", `/api/admin/members/${raeId}/adjust`, compliance, { direction: "credit", amount: 100, memo: "nope" });
  expect("compliance cannot adjust balances (403)", complianceAdjust.status === 403);

  const complianceKyc = await api("GET", "/api/admin/kyc/queue", compliance);
  expect("compliance CAN view KYC queue (RBAC grant)", complianceKyc.status === 200 && Array.isArray(complianceKyc.json.queue));

  /* ---------- dashboard overview ---------- */
  const overview = await api("GET", "/api/admin/overview", admin);
  expect("overview KPIs present", overview.status === 200 &&
    typeof overview.json.totals.customers === "number" &&
    typeof overview.json.totals.totalBalanceCents === "number" &&
    Array.isArray(overview.json.recentAudit));

  /* ---------- customers & accounts ---------- */
  const members = await api("GET", "/api/admin/members?q=rae", admin);
  expect("member search finds the API-registered member", members.status === 200 && members.json.members.length === 1 && members.json.members[0].name === "Rae Kim");

  await api("PUT", "/api/me/preferences", rae, { key: "scoutAuto", value: false }); // deterministic balances
  await api("POST", "/api/me/deposits", rae, { amount: 5000, source: "Opening deposit" });

  const memberDetail = await api("GET", `/api/admin/members/${raeId}`, admin);
  expect("member detail with account + transactions", memberDetail.status === 200 && memberDetail.json.member.balance.cents > 0 && memberDetail.json.transactions.length > 0);

  /* ---------- deposits & withdrawals (admin treasury) ---------- */
  const before = memberDetail.json.member.balance.cents as number;
  const credit = await api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "credit", amount: 500, memo: "Wire deposit confirmation" });
  expect("admin credit adjusts member balance (+$500)", credit.status === 200 && credit.json.after.cents === before + 50000);

  const noMemo = await api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "credit", amount: 100 });
  expect("adjustment without audit reason rejected (400)", noMemo.status === 400);

  const debit = await api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "debit", amount: 200, memo: "Fee reversal" });
  expect("admin withdrawal adjusts balance (−$200)", debit.status === 200 && debit.json.after.cents === before + 30000);

  const overdraft = await api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "debit", amount: 99_999_999, memo: "should fail" });
  expect("overdraft withdrawal rejected, balance unchanged", overdraft.status === 400 &&
    (await api("GET", `/api/admin/members/${raeId}`, admin)).json.member.balance.cents === before + 30000);

  /* ---------- concurrent financial operations stay consistent ---------- */
  const concurrentStart = (await api("GET", `/api/admin/members/${raeId}`, admin)).json.member.balance.cents as number;
  await Promise.all(
    Array.from({ length: 5 }, () => api("POST", `/api/admin/members/${raeId}/adjust`, admin, { direction: "credit", amount: 10, memo: "concurrent" })),
  );
  const concurrentEnd = (await api("GET", `/api/admin/members/${raeId}`, admin)).json.member.balance.cents as number;
  expect("5 concurrent credits apply exactly once each (atomicity)", concurrentEnd === concurrentStart + 5 * 1000);

  /* ---------- member transfers & restrictions ---------- */
  const transfer = await api("POST", "/api/me/transfers", rae, { counterparty: "Harbor Studio", amount: 100, category: "Operations", method: "ACH" });
  expect("member transfer succeeds and debits balance (+rewards)", transfer.status === 201 && transfer.json.balance.amount === ((concurrentEnd - 10000) / 100).toFixed(2) && transfer.json.result.reward === 2.5);

  const overdraftTransfer = await api("POST", "/api/me/transfers", rae, { counterparty: "X", amount: 99_999_999 });
  expect("transfer beyond balance rejected", overdraftTransfer.status === 400);

  const reasonCatalogue = await api("GET", "/api/admin/members/status-reasons", admin);
  const suspensionReasons = reasonCatalogue.json?.reasons ?? [];
  expect("admin reason picker has 15 complete presets", reasonCatalogue.status === 200 && suspensionReasons.length === 15 &&
    suspensionReasons.every((r: any) => r.code && r.label && r.note && r.memberText));
  const memberReasonCatalogue = await api("GET", "/api/admin/members/status-reasons", rae);
  expect("members cannot read the admin-only reason catalogue (403)", memberReasonCatalogue.status === 403);

  const unknownReason = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "restricted", reasonCode: "not-a-preset" });
  expect("unknown suspension reason code rejected (400)", unknownReason.status === 400);
  const shortCustomReason = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "restricted", reasonCode: "other", reason: "tiny" });
  expect("short custom suspension reason rejected (400)", shortCustomReason.status === 400);

  const presetReason = suspensionReasons.find((r: any) => r.code === "suspicious_activity");
  const restrict = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "restricted", reasonCode: presetReason.code });
  expect("account restriction stores the preset's member-facing sentence", restrict.status === 200 &&
    restrict.json.status === "restricted" && restrict.json.reason === presetReason.memberText && restrict.json.reasonCode === presetReason.code);
  const restrictedState = (await api("GET", "/api/me/state", rae)).json.account;
  expect("member state exposes the exact suspension reason and operator", restrictedState.statusReason === presetReason.memberText &&
    restrictedState.statusChangedBy === "Ops Admin" && typeof restrictedState.statusChangedAt === "number");
  const blockedTransfer = await api("POST", "/api/me/transfers", rae, { counterparty: "Y", amount: 5 });
  expect("restricted member's transfers blocked server-side (403)", blockedTransfer.status === 403);
  const depositStillWorks = await api("POST", "/api/me/deposits", rae, { amount: 25, source: "Incoming ACH" });
  expect("deposits still land while restricted", depositStillWorks.status === 201);
  const restore = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "active" });
  const restoredState = (await api("GET", "/api/me/state", rae)).json.account;
  expect("restoring clears the member-facing suspension reason", restore.status === 200 && restore.json.status === "active" &&
    restoredState.accountStatus === "active" && !restoredState.statusReason);

  const customText = "We paused this account while we review a reported scam payment.";
  const customRestrict = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "restricted", reasonCode: "other", reason: customText });
  const customState = (await api("GET", "/api/me/state", rae)).json.account;
  expect("Other stores the exact custom sentence for the member", customRestrict.status === 200 &&
    customRestrict.json.reason === customText && customState.statusReason === customText);
  const customRestore = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "active" });
  expect("custom suspension can also be restored", customRestore.status === 200 &&
    !(await api("GET", "/api/me/state", rae)).json.account.statusReason);

  const restrictNoReason = await api("POST", `/api/admin/members/${raeId}/status`, admin, { status: "restricted" });
  expect("restriction without a reason rejected", restrictNoReason.status === 400);

  /* ---------- KYC workflow (request → submit → approve) ---------- */
  const kycRequest = await api("POST", "/api/admin/kyc/request", admin, { userId: alexId, requirements: ["identity", "address"], reason: "Annual compliance review" });
  expect("admin KYC request sets 'requested'", kycRequest.status === 200 && kycRequest.json.status === "requested");

  const alexNotifs = await api("GET", "/api/me/notifications", alex);
  expect("member notified of verification request", alexNotifs.json.notifications.some((n: any) => n.title === "Identity verification requested"));

  const kycSubmit = await api("POST", "/api/me/kyc/submit", alex, {
    legalName: "Alex Stone", dob: "1992-09-21", country: "United States", documentType: "Drivers License",
    source: "Salary income", taxId: "7710", documents: [{ key: "idFront", label: "License", name: "license.jpg" }],
  });
  expect("member submission enters review", kycSubmit.status === 201 && kycSubmit.json.status === "in_review");

  const queue = await api("GET", "/api/admin/kyc/queue", admin);
  expect("submission appears in admin queue with payload", queue.json.queue.some((q: any) => q.userId === alexId && q.submission.legalName === "Alex Stone"));

  const decisionNoNote = await api("POST", `/api/admin/kyc/${alexId}/decision`, admin, { decision: "needs_attention" });
  expect("changes-rejected without a note (400)", decisionNoNote.status === 400);

  const approve = await api("POST", `/api/admin/kyc/${alexId}/decision`, admin, { decision: "approved" });
  expect("approval verified member", approve.status === 200 && approve.json.status === "approved");
  const afterApprove = await api("GET", "/api/me/kyc", alex);
  expect("member sees approved status (100%)", afterApprove.json.kyc.status === "approved" && afterApprove.json.kyc.completeness === 100);

  const reRequest = await api("POST", "/api/admin/kyc/request", admin, { userId: alexId });
  expect("re-requesting an approved member rejected (409)", reRequest.status === 409);

  /* ---------- risk & fraud workflow ---------- */
  const memberDispute = await api("POST", "/api/me/disputes", alex, { reason: "Duplicate charge", merchant: "City Electric", amount: 96.12 });
  expect("member can open a dispute", memberDispute.status === 201);
  const disputeId = memberDispute.json.dispute.id;

  // The app files disputes against a specific ledger row; the server enforces
  // one open case per transaction (retries and second tabs included).
  const raeOutflow = (await api("GET", "/api/me/state", rae)).json.account.transactions.find((t: any) => t.amount < 0);
  const linkedDispute = await api("POST", "/api/me/disputes", rae, { transactionId: raeOutflow.id, reason: "Unauthorized charge", detail: "Card was in my possession." });
  expect("member can dispute a specific transaction", linkedDispute.status === 201);
  const duplicateDispute = await api("POST", "/api/me/disputes", rae, { transactionId: raeOutflow.id, reason: "Unauthorized charge", detail: "" });
  expect("second filing for the same transaction rejected (409)", duplicateDispute.status === 409);

  const disputes = await api("GET", "/api/admin/risk/disputes", admin);
  expect("risk queue lists the filed dispute", disputes.status === 200 && disputes.json.disputes.length >= 1 &&
    disputes.json.disputes.some((d: any) => d.id === disputeId && d.status === "submitted"));

  const advance1 = await api("POST", `/api/admin/risk/disputes/${disputeId}/advance`, admin);
  expect("dispute advances to reviewing", advance1.status === 200 && advance1.json.status === "reviewing");
  const alexBalanceBefore = (await api("GET", "/api/me/account", alex)).json.balance.cents as number;
  const advance2 = await api("POST", `/api/admin/risk/disputes/${disputeId}/advance`, admin);
  expect("dispute resolution credits the member", advance2.status === 200 && advance2.json.status === "resolved" &&
    (await api("GET", "/api/me/account", alex)).json.balance.cents === alexBalanceBefore + 9612);

  /* ---------- staff management & privilege escalation ---------- */
  const promote = await api("POST", `/api/admin/staff/${alexId}/role`, admin, { role: "compliance" });
  expect("member promoted to compliance", promote.status === 200 && promote.json.role === "compliance");
  const demote = await api("POST", `/api/admin/staff/${alexId}/role`, admin, { role: "user" });
  expect("staff access revoked", demote.status === 200);

  const selfChange = await api("POST", `/api/admin/staff/${adminId}/role`, admin, { role: "user" });
  expect("self role change rejected (escalation guard)", selfChange.status === 400);

  /* ---------- role matrix (server-enforced) ---------- */
  const rolesBefore = await api("GET", "/api/admin/roles", admin);
  expect("roles endpoint lists matrix", rolesBefore.status === 200 && rolesBefore.json.roles.length === 4);

  await api("PUT", "/api/admin/roles", admin, { role: "support", permissions: ["dashboard.view"] });
  const supportAfterChange = await api("GET", "/api/admin/members", support);
  expect("revoking a permission takes effect immediately (403)", supportAfterChange.status === 403);

  await api("POST", "/api/admin/roles/reset", admin, { role: "support" });
  const supportAfterReset = await api("GET", "/api/admin/members", support);
  expect("role reset restores grants", supportAfterReset.status === 200);

  const complianceRolesEdit = await api("PUT", "/api/admin/roles", compliance, { role: "admin", permissions: [] });
  expect("compliance cannot edit the role matrix (403)", complianceRolesEdit.status === 403);

  /* ---------- broadcasts & notifications ---------- */
  const broadcast = await api("POST", "/api/admin/broadcasts", admin, { title: "Maintenance window", detail: "Sunday 02:00–04:00 UTC.", audience: "all" });
  expect("broadcast delivered to members", broadcast.status === 200 && broadcast.json.delivered >= 2);
  const raeNotifsAfter = await api("GET", "/api/me/notifications", rae);
  expect("broadcast visible in member notifications", raeNotifsAfter.json.notifications.some((n: any) => n.title === "Maintenance window"));

  /* ---------- settings & emergency halt ---------- */
  const settingsSave = await api("PUT", "/api/admin/settings", admin, { coreApy: 4.5 });
  expect("settings saved", settingsSave.status === 200 && settingsSave.json.settings.core_apy === "4.50");

  const halt = await api("PUT", "/api/admin/settings", admin, { paymentRails: "halted" });
  expect("emergency halt engaged", halt.status === 200);
  const haltedTransfer = await api("POST", "/api/me/transfers", rae, { counterparty: "Z", amount: 10 });
  expect("transfers blocked while rails halted (503)", haltedTransfer.status === 503);
  const resume = await api("PUT", "/api/admin/settings", admin, { paymentRails: "operational" });
  expect("rails resumed", resume.status === 200);

  /* ---------- reports & exports ---------- */
  for (const kind of ["customers", "accounts", "transactions", "kyc"]) {
    const report = await api("GET", `/api/admin/reports/${kind}.csv`, admin);
    expect(`report export: ${kind}`, report.status === 200 && report.text.includes(",") && (report.headers.get("content-type") ?? "").includes("text/csv"));
  }
  // The exports mirror the console tables column for column: a column the
  // console shows but the file omits is a gap, so both are asserted here.
  const accountsCsv = await api("GET", "/api/admin/reports/accounts.csv", admin);
  const accountsHeader = accountsCsv.text.split("\n")[0];
  const accountColumns = ["Member", "Type", "Balance", "Pending", "Cards", "Frozen cards",
    "Transactions", "Pending transactions", "KYC", "Status", "Last activity"];
  expect("accounts export carries every Accounts-console column",
    accountColumns.every(c => accountsHeader.includes(c)));
  const consoleAccounts = ((await api("GET", "/api/admin/state", admin)).json as any).accounts as any[];
  const raeConsole = consoleAccounts.find(a => a.email === "rae@member.test");
  // Read the file by column NAME, not position: the export grows columns as the
  // console does, and a positional test would break every time it does.
  const headerColumns = accountsHeader.split(",").map(h => h.replace(/^"|"$/g, ""));
  const valueFor = (row: string[], column: string) => {
    const i = headerColumns.indexOf(column);
    return i === -1 ? undefined : row[i];
  };
  const raeRow = csvRowFor(accountsCsv.text, "rae@member.test") ?? [];
  expect("accounts export matches the console's own counts for a member",
    raeRow.length > 14 && raeConsole !== undefined &&
    valueFor(raeRow, "Cards") === String(raeConsole.cards) &&
    valueFor(raeRow, "Frozen cards") === String(raeConsole.frozenCards) &&
    valueFor(raeRow, "Transactions") === String(raeConsole.txnCount) &&
    valueFor(raeRow, "Pending transactions") === String(raeConsole.pendingTxns) &&
    valueFor(raeRow, "KYC") === raeConsole.kycStatus &&
    valueFor(raeRow, "Status") === raeConsole.accountStatus,
    `csv=${JSON.stringify(raeRow)} console=${JSON.stringify(raeConsole)}`);
  expect("accounts export reports real activity, not placeholders",
    raeConsole !== undefined && raeConsole.txnCount > 0 && Number(valueFor(raeRow, "Transactions")) === raeConsole.txnCount);
  expect("accounts export carries the member's application (identity columns filled)",
    valueFor(raeRow, "Date of birth") === raeConsole.dob && valueFor(raeRow, "SSN") === raeConsole.ssn &&
    valueFor(raeRow, "ID document") === raeConsole.idType);

  const kycCsv = await api("GET", "/api/admin/reports/kyc.csv", admin);
  const kycHeader = kycCsv.text.split("\n")[0];
  const kycColumns = ["KYC status", "Completeness", "Submitted", "Legal name", "Document", "Files",
    "Source of funds", "Requested at", "Updated"];
  expect("kyc export carries every KYC-console column",
    kycColumns.every(c => kycHeader.includes(c)));
  // 0 User ID, 1 Member, 2 Email, 3 Type, 4 KYC status, 5 Completeness,
  // 6 Submitted, 7 Legal name, 8 Document, 9 Files, 10 Source of funds, 11 Requested at, 12 Updated.
  const alexKycRow = csvRowFor(kycCsv.text, "alex@member.test") ?? [];
  // The case has been decided by now, so its row is no longer in the review
  // queue — the console's Accounts view is where its KYC standing shows.
  const alexConsoleKyc = consoleAccounts.find(a => a.email === "alex@member.test")?.kycStatus;
  expect("kyc export carries the reviewed case's submission details",
    alexKycRow[7] === "Alex Stone" && alexKycRow[8] === "Drivers License" &&
    alexKycRow[9] === "1" && alexKycRow[10] === "Salary income",
    `row=${JSON.stringify(alexKycRow)}`);
  expect("kyc export status matches the console's KYC column",
    alexKycRow[4] === alexConsoleKyc && alexKycRow[5] === "100%" && alexKycRow[6] !== "—",
    `csv=${JSON.stringify(alexKycRow.slice(4, 7))} console=${alexConsoleKyc}`);
  const auditCsv = await api("GET", "/api/admin/audit/export.csv", admin);
  expect("report export: audit (CSV)", auditCsv.status === 200 && auditCsv.text.includes(",") && (auditCsv.headers.get("content-type") ?? "").includes("text/csv"));
  const exportNoPerm = await api("GET", "/api/admin/reports/customers.csv", support);
  expect("support cannot export reports (403)", exportNoPerm.status === 403);
  // `transactions.export` is the Transactions console's own permission: it
  // opens the ledger file only — the directory, balances and KYC files stay
  // behind reports.view.
  await api("PUT", "/api/admin/roles", admin, { role: "support", permissions: ["dashboard.view", "transactions.export"] });
  const ledgerByTxnExport = await api("GET", "/api/admin/reports/transactions.csv", support);
  const directoryByTxnExport = await api("GET", "/api/admin/reports/customers.csv", support);
  expect("transactions.export opens the ledger export (200)", ledgerByTxnExport.status === 200 && ledgerByTxnExport.text.includes(","));
  expect("transactions.export does not open the other reports (403)", directoryByTxnExport.status === 403);
  await api("POST", "/api/admin/roles/reset", admin, { role: "support" });

  /* ---------- audit trail ---------- */
  const auditList = await api("GET", "/api/admin/audit?category=Financial", admin);
  expect("audit trail lists financial actions", auditList.status === 200 && auditList.json.entries.length >= 3);

  const auditSearch = await api("GET", "/api/admin/audit?q=overdraw", admin);
  expect("audit search works", auditSearch.status === 200);

  const supportAudit = await api("GET", "/api/admin/audit", support);
  expect("support cannot read audit logs (403)", supportAudit.status === 403);

  let triggerFired = false;
  try { db.exec("UPDATE audit_log SET summary = 'tampered'"); } catch { triggerFired = true; }
  expect("audit_log UPDATE blocked by DB trigger", triggerFired);
  triggerFired = false;
  try { db.exec("DELETE FROM audit_log"); } catch { triggerFired = true; }
  expect("audit_log DELETE blocked by DB trigger", triggerFired);

  /* ---------- data integrity ---------- */
  const txnsAfter = db.prepare("SELECT COUNT(*) AS n FROM transactions").get() as { n: number };
  // Exactly the 11 applied operations so far (rae: 2 deposits + 1 credit + 1
  // debit + 5 concurrent credits + 1 transfer; alex: 1 dispute credit) —
  // every applied op wrote a row and every rejected op wrote none.
  expect("every financial op wrote a ledger row (and rejected ops wrote none)", txnsAfter.n === 11);
  const orphanTxns = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id NOT IN (SELECT id FROM users)").get() as { n: number };
  const orphanAccounts = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE user_id NOT IN (SELECT id FROM users)").get() as { n: number };
  expect("no orphaned ledger rows or accounts (FK integrity)", orphanTxns.n === 0 && orphanAccounts.n === 0);

  /* ---------- logout revokes the session ---------- */
  const logout = await api("POST", "/api/auth/logout", support);
  expect("logout succeeds", logout.status === 200);
  const afterLogout = await api("GET", "/api/auth/me", support);
  expect("revoked token no longer authenticates (401)", afterLogout.status === 401);

  /* ---------- registration ---------- */
  const juneReg = await register("June Okafor", "june@okafor.design", "supersafe123", { accountType: "business", business: "Okafor Design" });
  expect("registration creates a member + account + token", juneReg.status === 201 && juneReg.json.token);
  const dupe = await register("X", "june@okafor.design", "supersafe123");
  expect("duplicate email rejected (409)", dupe.status === 409);

  /* ---------- member lifecycle: empty start → real activity ---------- */
  const juneToken = juneReg.json.token;
  const juneId = juneReg.json.user.id;
  const adaId = adaReg.json.user.id;
  const juneState = await api("GET", "/api/me/state", juneToken);
  const js = juneState.json.account;
  expect("new member starts EMPTY (production behavior)", juneState.status === 200 &&
    js.balance === 0 && js.pendingBalance === 0 && js.cards.length === 0 && js.transactions.length === 0 &&
    js.invoices.length === 0 && js.team.length === 1 && js.team[0].role === "Owner" &&
    js.savingsPockets.length === 0 && js.payees.length === 0 && js.scheduledPayments.length === 0 &&
    js.perks.length === 0 && js.disputes.length === 0 &&
    js.notifications.length === 1 && js.notifications[0].title === "Application received — we're reviewing it" &&
    js.bankDetails.accountNumber.length === 12 && js.kyc.status === "in_review" && js.kyc.completeness === 100 &&
    js.accountStatus === "active");
  const heldMove = await api("POST", "/api/me/deposits", juneToken, { amount: 10, source: "Too early" });
  expect("money is blocked while the application is in review (403 review_pending)",
    heldMove.status === 403 && heldMove.json.code === "review_pending");
  const juneApproval = await decideFor(juneId);
  expect("reviewer approves the application", juneApproval.status === 200);
  await api("PUT", "/api/me/preferences", juneToken, { key: "scoutAuto", value: false }); // deterministic balances
  await api("POST", "/api/me/deposits", juneToken, { amount: 1200, source: "Payroll" });
  const juneCard = await api("POST", "/api/me/cards", juneToken, { label: "Everyday", type: "virtual", limit: 500, cardholder: "June Okafor" });
  await api("POST", "/api/me/transfers", juneToken, { counterparty: "Acme Supplies", amount: 180, category: "Operations", method: "Card", cardId: juneCard.json.card.id });
  const juneAfter = (await api("GET", "/api/me/state", juneToken)).json.account;
  expect("member builds real history through the API", juneAfter.balance === 1200 - 180 &&
    juneAfter.transactions.length === 2 && juneAfter.cards.length === 1 &&
    juneAfter.cards[0].spent === 180 && juneAfter.team[0].name === "June Okafor");

  // Cards: issue → patch → controls → freeze-all → replace → shipping → delete
  const newCard = await api("POST", "/api/me/cards", rae, { label: "Test card", type: "virtual", limit: 800, cardholder: "Rae Kim" });
  expect("card issued with generated numbers", newCard.status === 201 && newCard.json.card.last4.length === 4 && newCard.json.card.fullNumber.startsWith("9"));
  const cardId = newCard.json.card.id;
  const cardPatch = await api("PATCH", `/api/me/cards/${cardId}`, rae, { frozen: true, limit: 1500, pin: "9876", controls: { international: true } });
  expect("card patch updates fields", cardPatch.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.cards.some((c: any) => c.id === cardId && c.frozen === true && c.limit === 1500 && c.pin === "9876" && c.controls.international === true));
  const badPin = await api("PATCH", `/api/me/cards/${cardId}`, rae, { pin: "12" });
  expect("invalid PIN rejected (400)", badPin.status === 400);
  const foreignCard = await api("PATCH", `/api/me/cards/${cardId}`, alex, { frozen: false });
  expect("cannot patch another member's card (404)", foreignCard.status === 404);
  const freezeAll = await api("POST", "/api/me/cards/freeze-all", rae);
  expect("freeze-all freezes every card", freezeAll.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.cards.every((c: any) => c.frozen === true));
  const replaced = await api("POST", `/api/me/cards/${cardId}/replace`, rae, { reason: "Compromised" });
  expect("card replacement issues a new card + freezes old", replaced.status === 201 &&
    (await api("GET", "/api/me/state", rae)).json.account.cards.some((c: any) => c.id === replaced.json.card.id && c.label === "Test card replacement"));
  const physical = await api("POST", "/api/me/cards", rae, { label: "Ship me", type: "physical", limit: 2000 });
  const ship = await api("POST", `/api/me/cards/${physical.json.card.id}/shipping/advance`, rae);
  expect("shipping advances processing → printing", ship.status === 200 && ship.json.status === "printing");
  const deleted = await api("DELETE", `/api/me/cards/${physical.json.card.id}`, rae);
  expect("card deleted", deleted.status === 200);

  // Invoices: create → remind → mark paid credits balance
  const inv = await api("POST", "/api/me/invoices", rae, { client: "Test Client", clientEmail: "t@c.example", amount: 500, dueDays: 14, description: "Integration test" });
  expect("invoice created with next sequential id", inv.status === 201 && Number(inv.json.invoice.id) > 1047);
  const remind = await api("POST", `/api/me/invoices/${inv.json.invoice.id}/remind`, rae);
  expect("invoice reminder recorded", remind.status === 200);
  const balanceBeforeInv = (await api("GET", "/api/me/state", rae)).json.account.balance;
  const markPaid = await api("POST", `/api/me/invoices/${inv.json.invoice.id}/paid`, rae);
  expect("invoice payment credits balance", markPaid.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.balance === balanceBeforeInv + 500);
  const paidAgain = await api("POST", `/api/me/invoices/${inv.json.invoice.id}/paid`, rae);
  expect("double payment rejected (409)", paidAgain.status === 409);

  // Savings pockets: create → fund → withdraw → delete refunds
  const pocket = await api("POST", "/api/me/pockets", rae, { name: "Integration fund", target: 1000, color: "#7558dc", icon: "general" });
  const pocketId = pocket.json.pocket.id;
  const balPrePocket = (await api("GET", "/api/me/state", rae)).json.account.balance;
  await api("POST", `/api/me/pockets/${pocketId}/move`, rae, { amount: 300, direction: "to_pocket" });
  let state = (await api("GET", "/api/me/state", rae)).json.account;
  expect("pocket funding moves money out of checking", state.balance === balPrePocket - 300 &&
    state.savingsPockets.find((p: any) => p.id === pocketId).balance === 300);
  const overPocket = await api("POST", `/api/me/pockets/${pocketId}/move`, rae, { amount: 99999, direction: "to_pocket" });
  expect("pocket funding beyond balance rejected", overPocket.status === 400);
  await api("POST", `/api/me/pockets/${pocketId}/move`, rae, { amount: 100, direction: "to_checking" });
  await api("DELETE", `/api/me/pockets/${pocketId}`, rae);
  state = (await api("GET", "/api/me/state", rae)).json.account;
  expect("pocket withdrawal + delete refunds remainder", state.balance === balPrePocket && !state.savingsPockets.some((p: any) => p.id === pocketId));

  // Payees & scheduled payments: add → schedule → pay debits
  const payee = await api("POST", "/api/me/payees", rae, { name: "Integration Vendor", bankName: "Civic Bank", routingNumber: "071000288", accountLast4: "9090", accountType: "Checking" });
  expect("payee added", payee.status === 201);
  const badPayee = await api("POST", "/api/me/payees", rae, { name: "Bad", bankName: "X", routingNumber: "123", accountLast4: "12" });
  expect("payee validation enforced (400)", badPayee.status === 400);
  const sched = await api("POST", "/api/me/scheduled", rae, { payeeId: payee.json.payee.id, payeeName: "Integration Vendor", amount: 250, category: "Operations", frequency: "monthly", nextDate: Date.now() + 86_400_000, autopay: true, memo: "Integration" });
  expect("scheduled payment created", sched.status === 201);
  const balPreSched = (await api("GET", "/api/me/state", rae)).json.account.balance;
  const payNow = await api("POST", `/api/me/scheduled/${sched.json.payment.id}/pay`, rae);
  expect("pay-now debits and advances next date", payNow.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.balance === balPreSched - 250);
  // The response carries the id of the ledger row the server just wrote, so a
  // dispute filed before the snapshot refreshes still links to that row.
  const paidTxnId = payNow.json.transaction?.id as string | undefined;
  expect("pay-now returns the ledger row id", typeof paidTxnId === "string" && paidTxnId.startsWith("txn"));
  const disputePaidTxn = await api("POST", "/api/me/disputes", rae, { transactionId: paidTxnId, reason: "Duplicate charge", detail: "Filed immediately after paying." });
  expect("a dispute filed with that id links to the row (201)", disputePaidTxn.status === 201);
  const paused = await api("PATCH", `/api/me/scheduled/${sched.json.payment.id}`, rae);
  expect("scheduled payment pause/resume toggle", paused.status === 200 && paused.json.status === "paused");
  const resumed = await api("PATCH", `/api/me/scheduled/${sched.json.payment.id}`, rae, { status: "active" });
  expect("explicit status wins over the toggle (app contract)", resumed.status === 200 && resumed.json.status === "active");
  const badStatus = await api("PATCH", `/api/me/scheduled/${sched.json.payment.id}`, rae, { status: "cancelled" });
  expect("unknown scheduled status rejected (400)", badStatus.status === 400);
  const foreignSched = await api("PATCH", `/api/me/scheduled/${sched.json.payment.id}`, alex, { status: "paused" });
  expect("cannot pause another member's payment (404)", foreignSched.status === 404);

  // Rewards redemption
  const rewardsPre = (await api("GET", "/api/me/state", rae)).json.account;
  const redeem = await api("POST", "/api/me/rewards/redeem", rae);
  state = (await api("GET", "/api/me/state", rae)).json.account;
  expect("rewards redeem 1:1 into checking", redeem.status === 200 && Math.abs(state.balance - (rewardsPre.balance + rewardsPre.rewards)) < 0.001 && state.rewards === 0);

  // Scout idempotency
  const scout1 = await api("POST", "/api/me/scout/apply", rae, { opportunityId: "opp-test-1", merchant: "Fable Cloud", amount: 42.5, note: "Annual plan" });
  const scout2 = await api("POST", "/api/me/scout/apply", rae, { opportunityId: "opp-test-1", merchant: "Fable Cloud", amount: 42.5, note: "Annual plan" });
  expect("scout savings apply exactly once", scout1.json.applied === true && scout2.json.applied === false);

  // Preferences + profile + KYC patch
  const pref = await api("PUT", "/api/me/preferences", rae, { key: "weeklyDigest", value: true });
  expect("preference updated", pref.status === 200 &&
    (await api("GET", "/api/me/state", rae)).json.account.preferences.weeklyDigest === true);

  // Member cash plans: durable limits are part of the account snapshot.
  const budget = await api("POST", "/api/me/budgets", rae, { name: "Monthly software", category: "Software", monthlyLimit: 800, alertPercent: 75 });
  const budgetId = budget.json.budget?.id;
  expect("member can create a live spending plan", budget.status === 201 && budget.json.budget.monthlyLimit === 800 &&
    (await api("GET", "/api/me/state", rae)).json.account.budgets.some((item: any) => item.id === budgetId && item.alertPercent === 75));
  const invalidBudget = await api("POST", "/api/me/budgets", rae, { name: "", category: "Software", monthlyLimit: 0, alertPercent: 20 });
  expect("budget validation rejects invalid limits", invalidBudget.status === 400);
  const deletedBudget = await api("DELETE", `/api/me/budgets/${budgetId}`, rae);
  expect("member can remove a spending plan", deletedBudget.status === 200 &&
    !(await api("GET", "/api/me/state", rae)).json.account.budgets.some((item: any) => item.id === budgetId));

  const profile = await api("PATCH", "/api/me/profile", rae, { name: "Rae Kim", phone: "+1 (555) 000-0001" });
  expect("profile patch persists", profile.status === 200 && profile.json.user.phone === "+1 (555) 000-0001");
  const kycPatch = await api("PATCH", "/api/me/kyc", rae, { nextStep: "Final review", completeness: 95 });
  expect("kyc wizard progress saved", kycPatch.status === 200);

  // Team invite + owner protection
  const invite = await api("POST", "/api/me/team", rae, { name: "Ada Lovelace", email: "ada@raeandco.com", role: "Admin", monthlyLimit: 3000 });
  expect("team invite recorded as invited", invite.status === 201 && invite.json.member.status === "invited");
  const ownerRow = (await api("GET", "/api/me/state", rae)).json.account.team.find((m: any) => m.role === "Owner");
  const ownerRemove = await api("DELETE", `/api/me/team/${ownerRow.id}`, rae);
  expect("account owner cannot be removed (400)", ownerRemove.status === 400);

  // Members can open disputes but never resolve their own (compliance resolves)
  const memberAdvance = await api("POST", `/api/me/disputes/${disputeId}/advance`, alex);
  expect("member self-resolution blocked (404 — no such route)", memberAdvance.status === 404);

  /* ---------- card controls are enforced when the card spends ---------- */

  await api("POST", "/api/me/deposits", juneToken, { amount: 900, source: "Card control funding" });
  const controlled = await api("POST", "/api/me/cards", juneToken, { label: "Controls", limit: 300, type: "virtual" });
  const controlId = controlled.json.card.id;
  const spendWithCard = (body: Record<string, unknown>) =>
    api("POST", "/api/me/transfers", juneToken, { counterparty: "Northstar Ads", amount: 10, category: "Software", method: "Card", cardId: controlId, ...body });
  const cardSpent = async () =>
    (await api("GET", "/api/me/state", juneToken)).json.account.cards.find((c: any) => c.id === controlId).spent;

  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { frozen: true });
  const frozenSpend = await spendWithCard({});
  expect("frozen card declines spending (403)", frozenSpend.status === 403);
  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { frozen: false });

  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { controls: { online: false } });
  const onlineOff = await spendWithCard({});
  expect("online payments switched off decline spending (403)", onlineOff.status === 403);
  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { controls: { online: true } });

  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { merchantLock: "Northstar Ads" });
  const wrongMerchant = await spendWithCard({ counterparty: "Someone Else" });
  expect("merchant lock declines a different merchant (400)", wrongMerchant.status === 400);
  const rightMerchant = await spendWithCard({ counterparty: "northstar ads" });
  expect("merchant lock allows its own merchant (case-insensitive, 201)", rightMerchant.status === 201);
  expect("declines never touched the card's spend", await cardSpent() === 10);

  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { merchantLock: "", categoryLock: "Software" });
  const wrongCategory = await spendWithCard({ category: "Travel" });
  expect("category lock declines another category (400)", wrongCategory.status === 400);
  const rightCategory = await spendWithCard({ category: "Software" });
  expect("category lock allows its own category (201)", rightCategory.status === 201);

  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { categoryLock: "", singleTransactionLimit: 50 });
  const overPerTxn = await spendWithCard({ amount: 60 });
  expect("per-transaction limit enforced (400)", overPerTxn.status === 400 && /per-transaction/.test(overPerTxn.json.error));
  await api("PATCH", `/api/me/cards/${controlId}`, juneToken, { singleTransactionLimit: 1000 });
  const withinLimits = await spendWithCard({ amount: 100 });
  expect("spending within every limit succeeds (201)", withinLimits.status === 201);
  const overMonthly = await spendWithCard({ amount: 200 }); // 120 spent + 200 > 300 limit
  expect("monthly card limit enforced (400)", overMonthly.status === 400 && /monthly limit/.test(overMonthly.json.error));
  expect("rejected spend rolled back (spent unchanged at 120)", await cardSpent() === 120);

  /* ---------- body parsing errors are 4xx, never 500 ---------- */

  const malformedJson = await fetch(`${base}/api/me/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${juneToken}` },
    body: '{"name": ',
  });
  expect("malformed JSON body rejected with 400", malformedJson.status === 400);
  const oversized = await fetch(`${base}/api/me/profile`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${juneToken}` },
    body: JSON.stringify({ name: "x".repeat(300_000) }),
  });
  expect("oversized body rejected with 413", oversized.status === 413);

  /* ---------- input hardening (malformed input is 400, never 500) ---------- */

  const hardenState = (await api("GET", "/api/me/state", juneToken)).json.account;
  const hardenCard = hardenState.cards[0];
  const malformed: Array<[string, string, string, unknown]> = [
    ["deposits", "POST", "/api/me/deposits", { amount: "abc", source: "x" }],
    ["deposits (object)", "POST", "/api/me/deposits", { amount: { evil: true }, source: "x" }],
    ["transfers", "POST", "/api/me/transfers", { counterparty: "x", amount: "abc" }],
    ["invoices", "POST", "/api/me/invoices", { client: "x", amount: "abc", dueDays: 1 }],
    ["cards", "POST", "/api/me/cards", { label: "x", limit: "abc", type: "virtual" }],
    ["card patch", "PATCH", `/api/me/cards/${hardenCard.id}`, { limit: "abc" }],
    ["pockets", "POST", "/api/me/pockets", { name: "x", target: "abc" }],
    ["scheduled", "POST", "/api/me/scheduled", { payeeName: "x", amount: "abc", nextDate: Date.now() + 86_400_000 }],
    ["team", "POST", "/api/me/team", { name: "x", email: "x@y.co", role: "Member", monthlyLimit: "abc" }],
    ["admin adjust", "POST", `/api/admin/members/${juneId}/adjust`, { direction: "credit", amount: "abc", memo: "x" }],
  ];
  let badInputAll400 = true;
  let badInputDetail = "";
  for (const [label, method, path, body] of malformed) {
    const token = label.startsWith("admin") ? admin : juneToken;
    const res = await api(method, path, token, body);
    if (res.status !== 400) { badInputAll400 = false; badInputDetail += `${label}→${res.status} `; }
  }
  expect("malformed amounts rejected with 400, never 500", badInputAll400, badInputDetail);
  expect("non-numeric strings are not silently parsed (\"12abc\")",
    (await api("POST", "/api/me/deposits", juneToken, { amount: "12abc", source: "x" })).status === 400);

  /* ---------- enums are validated, never guessed ---------- */

  const badDirection = await api("POST", `/api/admin/members/${juneId}/adjust`, admin, { direction: "debit-typo", amount: 5, memo: "x" });
  expect("unknown adjustment direction rejected (400 — no silent credit)", badDirection.status === 400);
  const badAccStatus = await api("POST", `/api/admin/members/${juneId}/status`, admin, { status: "restrictd", reason: "typo" });
  expect("unknown account status rejected (400 — no silent restore)", badAccStatus.status === 400);
  const badAudience = await api("POST", "/api/admin/broadcasts", admin, { title: "t", detail: "d", audience: "everyone" });
  expect("unknown broadcast audience rejected (400 — no platform-wide send)", badAudience.status === 400);
  const badFrequency = await api("POST", "/api/me/scheduled", juneToken, { payeeName: "x", amount: 1, nextDate: Date.now() + 86_400_000, frequency: "yearly" });
  expect("unknown payment frequency rejected (400)", badFrequency.status === 400);

  /* ---------- member routes act on member accounts only ---------- */

  const staffTargets: Array<[string, string, string, unknown]> = [
    ["view a staff account as a member record", "GET", `/api/admin/members/${adaId}`, undefined],
    ["credit a staff account", "POST", `/api/admin/members/${adaId}/adjust`, { direction: "credit", amount: 1, memo: "x" }],
    ["restrict the Super Admin's account", "POST", `/api/admin/members/${adminId}/status`, { status: "restricted", reason: "x" }],
  ];
  let staffScoped = true;
  let staffDetail = "";
  for (const [label, method, path, body] of staffTargets) {
    const res = await api(method, path, admin, body);
    if (res.status !== 404) { staffScoped = false; staffDetail += `${label}→${res.status} `; }
  }
  expect("staff accounts are not member surface (404, no enumeration)", staffScoped, staffDetail);
  expect("staff account left untouched", (db.prepare("SELECT status FROM users WHERE id = ?").get(adaId) as { status: string }).status === "active");

  /* ---------- foreign resources are 404, not a misleading 400 ---------- */

  const junePocket = (await api("POST", "/api/me/pockets", juneToken, { name: "Foreign probe", target: 10 })).json.pocket;
  const foreignPocket = await api("POST", `/api/me/pockets/${junePocket.id}/move`, alex, { amount: 1, direction: "to_checking" });
  expect("another member's pocket is 404 (move)", foreignPocket.status === 404);
  const foreignPocketDelete = await api("DELETE", `/api/me/pockets/${junePocket.id}`, alex);
  expect("another member's pocket is 404 (delete)", foreignPocketDelete.status === 404);
  const juneSchedule = (await api("POST", "/api/me/scheduled", juneToken, { payeeName: "Foreign probe", amount: 1, nextDate: Date.now() + 86_400_000 })).json.payment;
  const foreignSchedule = await api("POST", `/api/me/scheduled/${juneSchedule.id}/pay`, alex);
  expect("another member's scheduled payment is 404 (pay)", foreignSchedule.status === 404);
  expect("pocket still owned and intact after foreign attempts",
    (await api("GET", "/api/me/state", juneToken)).json.account.savingsPockets.some((p: any) => p.id === junePocket.id));

  /* ---------- registration validation ---------- */

  const emptyBusiness = await register("Empty Biz", "empty-biz@member.test", "member-pass-9", { accountType: "business", business: "   " });
  expect("blank business name rejected for business accounts (400)", emptyBusiness.status === 400);
  const wrongTypeBusiness = await register("Wrong Type", "wrong-type@member.test", "member-pass-9", { accountType: "business", business: 42 });
  expect("non-string business name rejected (400)", wrongTypeBusiness.status === 400);
  const personalNoBusiness = await register("Solo Person", "solo@member.test", "member-pass-9", { accountType: "personal" });
  expect("personal accounts need no business name (201)", personalNoBusiness.status === 201);
  const injectedRole = await register("Role Injector", "role-inject@member.test", "member-pass-9", { accountType: "business", business: "Inject Co", role: "superadmin", status: "active" });
  const injectedRow = db.prepare("SELECT role, status, plan FROM users WHERE email = ?").get("role-inject@member.test") as { role: string; status: string; plan: string };
  expect("registration ignores injected role/status/plan (member, active, Pro)", injectedRole.status === 201 &&
    injectedRole.json.user.role === "user" && injectedRow.role === "user" && injectedRow.status === "active" && injectedRow.plan === "Pro");

  /* ---------- the account application (identity data) ---------- */

  const noProfile = await api("POST", "/api/auth/register", undefined, { name: "No App", email: "no-app@member.test", password: "member-pass-9", accountType: "personal" });
  expect("registration without an application is rejected (422)",
    noProfile.status === 422 && noProfile.json.field === "firstName");

  const weakSsn = await register("Weak Ssn", "weak-ssn@member.test", "member-pass-9", {
    accountType: "personal", profile: { ...applicationFor("personal", "Weak Ssn"), ssn: "666-12-3456" },
  });
  expect("impossible SSN rejected with a field-level error (422)",
    weakSsn.status === 422 && weakSsn.json.field === "ssn" && /Social Security/.test(weakSsn.json.error));

  const child = await register("Too Young", "too-young@member.test", "member-pass-9", {
    accountType: "personal", profile: { ...applicationFor("personal", "Too Young"), dob: "2012-02-02" },
  });
  expect("applicants under 18 rejected (422)", child.status === 422 && child.json.field === "dob");

  const badEin = await register("Bad Ein Co", "bad-ein@member.test", "member-pass-9", {
    accountType: "business", business: "Bad Ein Co",
    profile: { ...applicationFor("business", "Bad Ein Co", "Bad Ein Co"), ein: "07-1234567" },
  });
  expect("invalid EIN rejected for business accounts (422)", badEin.status === 422 && badEin.json.field === "ein");

  const ownerTooSmall = await register("Small Owner Co", "small-owner@member.test", "member-pass-9", {
    accountType: "business", business: "Small Owner Co",
    profile: { ...applicationFor("business", "Small Owner Co", "Small Owner Co"), ownerOwnership: 10 },
  });
  expect("beneficial ownership below 25% rejected (422)", ownerTooSmall.status === 422 && ownerTooSmall.json.field === "ownerOwnership");

  const stored = db.prepare("SELECT first_name, last_name, dob, ssn, state, id_type, ein FROM identity_profiles WHERE user_id = ?").get(raeId) as
    { first_name: string; last_name: string; dob: string; ssn: string; state: string; id_type: string; ein: string };
  expect("the application is stored normalised (name, SSN and EIN shapes)",
    stored.first_name === "Rae" && stored.last_name === "Kim" && stored.ssn === "527-44-8213" && stored.ein === "83-1174265" && stored.state === "TX");

  const fresh = await register("Iris Fresh", "iris@member.test", "member-pass-9", { accountType: "personal" });
  const kycAfterSignup = db.prepare("SELECT status, completeness FROM kyc_records WHERE user_id = ?").get(fresh.json.user.id) as { status: string; completeness: number };
  expect("a completed application enters compliance review (in_review, 100%)",
    fresh.status === 201 && kycAfterSignup.status === "in_review" && kycAfterSignup.completeness === 100);

  const myProfile = await api("GET", "/api/me/profile", rae);
  expect("the member reads their own application back with the SSN masked",
    myProfile.status === 200 && myProfile.json.profile.ssn === "•••-••-8213" &&
    myProfile.json.profile.ein === "••-•••4265" && myProfile.json.profile.addressLine1 === "88 Harper Street" &&
    myProfile.json.profile.legalName === "Rae & Co Studio");

  const alexProfile = await api("GET", "/api/me/profile", alex);
  expect("personal applications carry no business section", alexProfile.status === 200 &&
    alexProfile.json.profile.legalName === undefined && alexProfile.json.profile.ein === undefined);

  const adminSees = await api("GET", `/api/admin/members/${raeId}`, admin);
  expect("staff see the full application, tax IDs unmasked",
    adminSees.status === 200 && adminSees.json.identity.ssn === "527-44-8213" &&
    adminSees.json.identity.ein === "83-1174265" && adminSees.json.identity.ownerSsn === "527-44-8213" &&
    adminSees.json.identity.idType === "Driver's license" && adminSees.json.member.email === "rae@member.test");

  // A fresh applicant of its own: rae was cleared above so the money routes could
  // run, and these two checks are specifically about an application that is still
  // waiting for a decision.
  const pending = await register("Mira Cole", "mira@member.test", "member-pass-9", { accountType: "business", business: "Cole Studio" });
  const pendingId = pending.json.user.id;

  const dir = await api("GET", "/api/admin/members", admin);
  const dirRow = dir.json.members.find((m: any) => m.id === pendingId);
  expect("the customer directory exposes date of birth and tax ID to staff",
    dir.status === 200 && dirRow?.dob === "1990-05-12" && dirRow?.ssn === "527-44-8213" && dirRow?.kycStatus === "in_review");

  const queued = await api("GET", "/api/admin/kyc/queue", admin);
  const queuedPending = queued.json.queue.find((q: any) => q.userId === pendingId);
  expect("the signup application lands in the KYC review queue with its details",
    queued.status === 200 && queuedPending?.submission?.legalName === "Mira Cole" &&
    queuedPending?.submission?.taxId === "527-44-8213" && queuedPending?.submission?.application?.businessType === "Multi-member LLC");

  // Registration budget: only applications that pass validation spend it, and a
  // run of scripted sign-ups from one connection is what it exists to stop.
  resetRateLimits();
  const flood = [];
  for (let i = 0; i < 21; i += 1) {
    const r = await register(`Flood ${String.fromCharCode(65 + i)}a`, `flood-${i}@member.test`, "member-pass-9", { accountType: "personal" });
    flood.push(r.status);
  }
  expect("scripted sign-up runs are throttled (429 after the budget)",
    flood.slice(0, 20).every(s => s === 201) && flood[20] === 429);
  const afterThrottle = await api("POST", "/api/auth/login", undefined, { email: "flood-0@member.test", password: "member-pass-9" });
  expect("an account created inside the budget still works", afterThrottle.status === 200);
  resetRateLimits(); // the suites below keep registering fixtures

  // Change password + production token-based password reset
  resetRateLimits(); // this suite performs many logins — reset the limiter
  const juneParallelLogin = await api("POST", "/api/auth/login", undefined, { email: "june@okafor.design", password: "supersafe123" }, "device-june-second-browser-0001");
  const changePw = await api("POST", "/api/auth/change-password", juneToken, { current: "supersafe123", next: "even safer 99" });
  expect("changing password keeps this session, revokes other sessions and accepts the new password",
    changePw.status === 200 && changePw.json.signedOutOtherSessions === true &&
    (await api("GET", "/api/auth/me", juneToken)).status === 200 &&
    (await api("GET", "/api/auth/me", juneParallelLogin.json.token)).status === 401 &&
    (await api("POST", "/api/auth/login", undefined, { email: "june@okafor.design", password: "even safer 99" })).status === 200);
  const forgotUnknown = await api("POST", "/api/auth/forgot-password", undefined, { email: "nobody@nowhere.example" });
  expect("forgot-password never reveals account existence", forgotUnknown.status === 200 && forgotUnknown.json.ok === true &&
    !forgotUnknown.json.token && !forgotUnknown.json.tempPassword);
  const devReset = await api("POST", "/api/auth/forgot-password", undefined, { email: "june@okafor.design" });
  // Development hands the code back so the reset screen works without a mail
  // provider; production must never put a reset token in a response body.
  expect("development returns the reset code so the flow is usable without mail",
    typeof devReset.json.devCode === "string" && devReset.json.devCode.length > 20);
  const restoreEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const prodReset = await api("POST", "/api/auth/forgot-password", undefined, { email: "june@okafor.design" });
  if (restoreEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = restoreEnv;
  expect("production never returns a reset code in the response",
    prodReset.status === 200 && prodReset.json.devCode === undefined && prodReset.json.token === undefined &&
    !("devCode" in prodReset.json));
  const badReset = await api("POST", "/api/auth/reset-password", undefined, { token: "forged-token", password: "new password 123" });
  expect("forged reset token rejected (400)", badReset.status === 400);
  // Mint a token through the same code path (sha256-hashed, 30-min expiry) for
  // June's real user id, then complete the reset like the emailed link would.
  const crypto = await import("node:crypto");
  const rawToken = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  db.prepare("INSERT INTO password_resets (token_hash, user_id, expires_at, used, created_at) VALUES (?, ?, ?, 0, ?)")
    .run(crypto.createHash("sha256").update(rawToken).digest("hex"), juneReg.json.user.id, Date.now() + 30 * 60_000, Date.now());
  const weakReset = await api("POST", "/api/auth/reset-password", undefined, { token: rawToken, password: "short" });
  expect("reset enforces the 8-char minimum (400)", weakReset.status === 400);
  const goodReset = await api("POST", "/api/auth/reset-password", undefined, { token: rawToken, password: "totally new pass 77" });
  expect("valid token resets the password", goodReset.status === 200 &&
    (await api("POST", "/api/auth/login", undefined, { email: "june@okafor.design", password: "totally new pass 77" })).status === 200);
  const replayReset = await api("POST", "/api/auth/reset-password", undefined, { token: rawToken, password: "another pass 88" });
  expect("reset token is single-use (replay rejected)", replayReset.status === 400);

  /* ---------- durable operations casework ---------- */
  const memberOps = await api("GET", "/api/admin/operations/cases", rae);
  expect("member blocked from operations casework (403)", memberOps.status === 403);
  const opsDueAt = Date.now() + 2 * 86_400_000;
  const createOpsCase = await api("POST", "/api/admin/operations/cases", admin, {
    title: "Review Rae transfer pattern",
    kind: "transaction",
    priority: "high",
    summary: "Review unusual transfer velocity before the next settlement window.",
    userId: raeId,
    sourceType: "transaction",
    sourceId: "ops-test-transfer",
    assignedTo: adaReg.json.user.id,
    dueAt: opsDueAt,
  });
  const opsCaseId = createOpsCase.json.case?.id as string;
  expect("admin opens an assigned operational case", createOpsCase.status === 201 && Boolean(opsCaseId) &&
    createOpsCase.json.case.assignee?.id === adaReg.json.user.id && createOpsCase.json.case.events.length >= 2);
  const duplicateOpsCase = await api("POST", "/api/admin/operations/cases", admin, {
    title: "Duplicate source should fail", kind: "transaction", priority: "high", sourceType: "transaction", sourceId: "ops-test-transfer",
  });
  expect("operation source can only have one tracked case (409)", duplicateOpsCase.status === 409);
  const noteOpsCase = await api("POST", `/api/admin/operations/cases/${opsCaseId}/notes`, compliance, {
    body: "Initial review started; request supporting settlement information.",
  });
  expect("compliance can add a durable internal case note", noteOpsCase.status === 201 &&
    noteOpsCase.json.case.notes.some((note: any) => note.body.includes("Initial review started")));
  const updateOpsCase = await api("PUT", `/api/admin/operations/cases/${opsCaseId}`, admin, {
    status: "investigating", priority: "critical", assignedTo: adaReg.json.user.id,
  });
  expect("case status and priority update with a timeline", updateOpsCase.status === 200 &&
    updateOpsCase.json.case.status === "investigating" && updateOpsCase.json.case.priority === "critical" &&
    updateOpsCase.json.case.events.some((event: any) => event.action === "case.status"));
  const cases = await api("GET", "/api/admin/operations/cases", admin);
  expect("operations queue returns assigned cases with notes and SLA", cases.status === 200 &&
    cases.json.cases.some((item: any) => item.id === opsCaseId && item.dueAt === opsDueAt && item.notes.length === 1));
  let operationTimelineImmutable = false;
  try { db.prepare("UPDATE operation_case_events SET detail = 'tampered' WHERE case_id = ?").run(opsCaseId); } catch { operationTimelineImmutable = true; }
  expect("operation case event timeline is append-only at the DB layer", operationTimelineImmutable);

  /* ---------- admin aggregate state ---------- */
  const adminState = await api("GET", "/api/admin/state", admin);
  const as = adminState.json;
  expect("admin state aggregates the console", adminState.status === 200 &&
    as.users.length >= 6 && as.accounts.length >= 3 && as.transactions.length >= 15 &&
    Array.isArray(as.disputes) && Array.isArray(as.kycQueue) && Array.isArray(as.operationCases) &&
    as.operationCases.some((item: any) => item.id === opsCaseId) && as.audit.length > 0 &&
    as.roles.support.length > 0 && as.settings.payment_rails === "operational");
  const raeMirror = (await api("GET", "/api/me/state", rae)).json.account;
  expect("admin state mirrors member shapes", as.accounts.some((a: any) =>
    a.userId === raeId && a.balance === raeMirror.balance && a.cards === raeMirror.cards.length));
  const memberState = await api("GET", "/api/admin/state", rae);
  expect("admin state blocked for members (403)", memberState.status === 403);

  console.log(failures === 0 ? "\nALL API INTEGRATION TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
} finally {
  server && await new Promise<void>(r => (server as any).close ? (server as any).close(() => r()) : r());
  // allow the event loop to drain
  setTimeout(() => process.exit(failures === 0 ? 0 : 1), 100);
}
