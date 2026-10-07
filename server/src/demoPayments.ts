import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { BadInputError, dollarsToCents, inTransaction, getSetting } from './db.js';
import { applyFee, quoteFee } from '../../shared/fees.js';
import { rateLimit } from './security.js';
import { type DemoSnapshot, type DemoResult } from '../../shared/demoPayments.js';

export const demoPaymentsEnabled = () => (process.env.ACCOUNT_LEDGER_ENABLED || process.env.DEMO_PAYMENTS_ENABLED) === '1' && ['development', 'test'].includes(process.env.NODE_ENV ?? 'development');
export function normalizeDemoPhone(value: string): string {
  const input = value.trim();
  if (!/^[+\d() .-]+$/.test(input)) return '';
  const digits = input.replace(/\D/g, '');
  if (input.startsWith('+') && /^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return '';
}
type Member = { id: string; name: string; email: string; phone: string; account_type: string; role: string; team_owner_id: string | null; status: string; review_state: string };
type Account = { id: string; balance_cents: number };
type Preview = { id: string; user_id: string; recipient_id: string | null; identifier: string; name: string; amount_cents: number; method: string; category: string; note: string; expires_at: number; result_json: string | null };
function fail(message: string): never { throw new BadInputError(message); }
const text = (value: unknown, max = 160) => typeof value === 'string' && value.trim().length <= max ? value.trim() : fail('Invalid payment input.');

/** Mock transfers use the existing account ledger, not the retired separate wallet. */
export function createDemoPayments(db: DatabaseSync) {
  const member = (id: string) => db.prepare("SELECT u.*,COALESCE(k.review_state,'approved') AS review_state FROM users u LEFT JOIN kyc_records k ON k.user_id=u.id WHERE u.id=?").get(id) as Member;
  const owners = () => db.prepare("SELECT id,email,phone FROM users WHERE role='user' AND team_owner_id IS NULL").all() as Pick<Member,'id'|'email'|'phone'>[];
  const account = (id: string) => db.prepare('SELECT id,balance_cents FROM accounts WHERE user_id=?').get(id) as Account | undefined;
  const eligible = (m: Member | undefined) => !!m && m.role === 'user' && !m.team_owner_id && m.status === 'active' && m.review_state === 'approved';
  function recipient(identifier: string) {
    const email = identifier.includes('@'), canonical = email ? identifier.toLowerCase() : normalizeDemoPhone(identifier);
    if (!canonical) fail('Use the recipient’s signup email or phone with country code.');
    const matches = owners().filter(u => (email ? u.email.toLowerCase() : normalizeDemoPhone(u.phone ?? '')) === canonical);
    if (matches.length !== 1) fail('No unique recipient matches. Check the email or use email instead of a shared phone.');
    const m = member(matches[0].id);
    if (!eligible(m)) fail('This recipient cannot receive payments.');
    return { member: m, identifier: canonical };
  }
  function snapshot(id: string): DemoSnapshot {
    const m = member(id), enabled = demoPaymentsEnabled() && eligible(m), phone = normalizeDemoPhone(m.phone ?? '');
    return { demoMode: demoPaymentsEnabled(), enabled,
      reason: !demoPaymentsEnabled() ? 'Account transfers are unavailable. External processing is not connected.' : !eligible(m) ? 'Payments require an active, approved account-owner login.' : '',
      member: { name: m.name, email: m.email, phone: m.phone ?? '', phoneUsable: !!phone && owners().filter(u => normalizeDemoPhone(u.phone ?? '') === phone).length === 1, accountType: m.account_type },
      balanceCents: enabled ? account(id)?.balance_cents ?? null : null, bankStatus: 'unlinked', cardLinked: false, events: [], inbox: [] };
  }
  function entry(id: string, cents: number, p: Preview, name: string, reference: string, at: number, feeCents = 0) {
    const cash = applyFee(cents, feeCents);
    const a = account(id);
    if (!a || !Number.isSafeInteger(a.balance_cents + cash) || a.balance_cents + cash < 0 || a.balance_cents + cash > 1000000000) fail('Insufficient balance or account balance limit exceeded.');
    db.prepare('UPDATE accounts SET balance_cents=balance_cents+?,updated_at=? WHERE id=?').run(cash,at,a.id);
    db.prepare("INSERT INTO transactions(id,account_id,user_id,merchant,category,method,amount_cents,fee_cents,status,reference,note,created_at,performed_by) VALUES(?,?,?,?,?,?,?,?,'cleared',?,?,?,?)").run(randomUUID(),a.id,id,name,p.category || 'Transfer',p.method,cents,feeCents,reference,`Account transfer — no external settlement.${feeCents ? ` Fee ${feeCents/100}.` : ''} ${p.note}`,at,p.user_id);
  }
  function action(id: string, body: Record<string, unknown>): DemoResult {
    if (!demoPaymentsEnabled()) fail('Account transfers are unavailable. No payment was submitted.');
    if (!eligible(member(id))) fail('Only an active, approved account owner can make payments.');
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Invalid payment request.');
    if (Object.keys(body).some(k => !['action','method','identifier','amount','category','note','id','decision'].includes(k))) fail('Unexpected payment fields. Do not submit bank or card credentials.');
    if (!rateLimit(`demo:${id}`,100,60000)) fail('Too many payment requests. Try again in a minute.');
    if (getSetting(db,'payment_rails') === 'halted') fail('Payment rails are temporarily halted.');
    return inTransaction(db, () => {
      if (body.action === 'preview_transfer') {
        const method = text(body.method), category = text(body.category ?? '',80), note = text(body.note ?? '',500);
        if (!['Zelle','ACH','Wire','Vendor Bill'].includes(method)) fail('Unknown payment method.');
        if (member(id).account_type === 'business' && !category) fail('Choose a category for a business payment.');
        if (!['string','number'].includes(typeof body.amount) || !/^\d+(\.\d{1,2})?$/.test(String(body.amount))) fail('Use a positive amount with at most two decimals.');
        const cents = dollarsToCents(body.amount as string | number);
        if (cents < 1 || cents > 25000000) fail('Payments must be between $0.01 and $250,000.');
        let identifier = text(body.identifier), name = identifier, recipientId: string | null = null;
        if (!name) fail('Enter a recipient.');
        if (method === 'Zelle') {
          const found = recipient(identifier);
          if (found.member.id === id) fail('Use a different recipient, not your own identifier.');
          identifier = found.identifier; name = found.member.name; recipientId = found.member.id;
        }
        const fee = quoteFee('transfer', cents);
        const previewId = randomUUID(), expires = Date.now() + 600000;
        db.prepare('DELETE FROM demo_account_payment_previews WHERE user_id=? AND expires_at<? AND result_json IS NULL').run(id,Date.now());
        db.prepare('INSERT INTO demo_account_payment_previews VALUES(?,?,?,?,?,?,?,?,?,?,NULL)').run(previewId,id,recipientId,identifier,name,cents,method,category,note,expires);
        return { message: 'Review the recipient, amount and fee.', preview: { id: previewId, name, identifier, amountCents: cents, feeCents: fee.feeCents, method, category, expiresAt: expires } };
      }
      if (body.action !== 'confirm_transfer') fail('This separate-wallet action is retired. Use Add funds on your account.');
      const p = db.prepare('SELECT * FROM demo_account_payment_previews WHERE id=? AND user_id=?').get(text(body.id),id) as Preview | undefined;
      if (!p) fail('Payment review not found. Review again.');
      if (body.decision !== 'completed') fail('Only a confirmed payment can be submitted. Cancel before submitting to make no payment.');
      if (p.result_json) return JSON.parse(p.result_json) as DemoResult;
      if (p.expires_at < Date.now()) fail('Payment review expired. Review again.');
      if (member(id).account_type === 'business' && !p.category) fail('Choose a business category and review again.');
      if (p.recipient_id) {
        const found = recipient(p.identifier).member;
        if (found.id !== p.recipient_id || found.name !== p.name) fail('Recipient changed. Review again.');
      }
      const before = account(id)?.balance_cents;
      if (before === undefined) fail('Account unavailable.');
      const fee = quoteFee('transfer', p.amount_cents);
      const reference = `VYR-${randomUUID().slice(0,12).toUpperCase()}`, at = Date.now();
      entry(id,-p.amount_cents,p,p.name,reference,at,fee.feeCents);
      if (p.recipient_id) entry(p.recipient_id,p.amount_cents,p,member(id).name,reference,at);
      const result: DemoResult = { message: fee.feeCents ? 'Payment recorded in your account. The transfer fee was debited with the payment.' : 'Payment recorded in your account.', result: { reference, date: at, amount: p.amount_cents/100, fee: fee.feeCents/100, balanceBefore: before/100, balanceAfter: (before-p.amount_cents-fee.feeCents)/100, reward: 0, scout: 0 } };
      db.prepare('UPDATE demo_account_payment_previews SET result_json=? WHERE id=?').run(JSON.stringify(result),p.id);
      return result;
    });
  }
  return { snapshot, action };
}
