# Customer workspaces, shared account updates and Zelle emails

## Scope selected

The user requested dedicated admin pages for customers, incoming/outgoing Zelle email notifications, and account editing across users. For bulk editing they selected **Apply shared bank details**: bank name, routing number and Checking/Savings designation are shared updates; each user's account number remains unique. Personal/Business conversion is not a bulk action.

## Dedicated customer page

From **Admin → Customers**, click a customer's name. The stable URL is `/#/app/superadmin/customers/{memberId}` and works after reload or direct navigation by authorized staff.

The page shows contact information, application state, account status, bank details, available/pending ledger balances, the latest ten transactions, and whether an email provider is configured. Available controls are based on the live server permission grants:

- Edit account/routing numbers, bank name and account designations through the existing audited account editor.
- Configure that member's funding methods and review their pending funding requests.
- Review and confirm a ledger balance adjustment with a reason.
- Review and confirm an account restriction or restoration.

Teammate logins link to the business owner's workspace rather than exposing owner-only bank actions on a teammate's record. Members are redirected away from the admin page; the API independently rejects their access. Missing customers receive a not-found state rather than another account's data. On the dedicated member endpoint, customer-only staff grants do not expose account fields, balances, transaction details or identity profiles without the corresponding read permissions. This endpoint returns full identity data only to identity reviewers; the new page does not display SSNs. This is not a claim that all legacy aggregate endpoints were redesigned.

## Shared bulk account editing

Use **Admin → Customers → Bulk account details**.

1. Select account owners, or choose all current account owners. The all-owner scope is not limited by the directory search filter. Staff and teammate logins are excluded.
2. Enable only the fields to change: bank name, routing number and/or Checking/Savings type. Provide an audit reason.
3. Review the exact customer count, account suffixes and before/after values. Full account numbers are not returned in the bulk preview.
4. Type `UPDATE N`, matching the reviewed count, then apply.

Safeguards:

- Server-side `accounts.edit_number` permission is required for preview and apply; permission changes take effect immediately.
- Routing numbers must pass the nine-digit ABA checksum. A checksum is not verification that an external account or bank connection exists.
- Account numbers, balances, Personal/Business experience and per-user funding instructions are not changed by the bulk operation.
- Reviews expire after ten minutes, belong to the creating administrator, and freeze the exact customer list. Accounts created later are excluded.
- A missing/ineligible owner or changed reviewed metadata causes rejection of the entire batch. Balance-only activity does not invalidate a metadata review.
- Every change and its audit entry commit atomically. An audit/write failure rolls back the whole batch.
- An applied review is idempotent: retrying its ID returns its original result without duplicate writes/audits.
- Each changed customer has an `account.bulk_details` audit entry; `account.bulk_summary` records the batch result.
- Maximum 5,000 owners per review and 20 active reviews per administrator. Expired unused reviews are cleaned up when preparing another review.

Migration 19 stores review snapshots and their committed results in `account_bulk_previews`.

## Zelle activity emails

Notifications use Veyra branding and are sent to the affected account owner's stored email address, never an arbitrary counterparty address or the Zelle contact configured in funding instructions.

| Event | Trigger and wording |
| --- | --- |
| Outgoing recorded | After a successful `/api/me/transfers` ledger debit labelled Zelle. Explicitly says the ledger record is not confirmation of a Zelle network payment or recipient delivery. |
| Incoming pending | After a new Zelle funding request. Says no funds are confirmed or credited. |
| Incoming confirmed | After authorized staff confirm receipt and the ledger credit commits. Identifies this as a staff-confirmed Veyra ledger update, not a notice from Zelle or the receiving bank. |
| Incoming declined | After a request is rejected. Says no funds were credited for that request. |

Messages include amount, direction, status, recorded time, reference and only the last four account-number digits. Counterparty text is HTML-escaped. Review evidence, passwords, card details and full bank numbers are not included. Failed transactions generate no outgoing email. Replayed incoming requests/reviews do not generate another email. Outgoing notifications correspond to newly created ledger transactions; this update does not change the existing outgoing transfer endpoint's retry semantics.

The runtime builder and **Email template studio → Transfers** share the same Zelle designs. Standalone files are generated into `emails/` by `npm run build:emails`. Pending/declined messages avoid the green credited-amount presentation.

### Delivery configuration and limits

Delivery uses the existing best-effort mailer with a ten-second provider timeout. Configure `MAIL_PROVIDER` (`resend`, `postmark` or `sendgrid`), `MAIL_API_KEY`, a verified `MAIL_FROM`, and the correct public `APP_URL` on the server. Keep secrets out of chat, client code and Git. `off` and `log` modes do not deliver mail. At preview verification time, the provider was **off**; the customer page reports that limitation.

Email is initiated after the database transaction commits. Provider failures are logged and cannot undo or falsely decline the committed ledger operation. There is no persistent email outbox or automatic redelivery in this implementation; operations must monitor provider errors. A configured provider is not proof of successful inbox delivery. No live inbox delivery was tested here.

These notifications do not activate Zelle, ACH, card funding, bank linking or other external settlement services.

## Verification

- Application/E2E typechecks and production build pass.
- Full `npm test` passes: existing suites plus **49 customer-admin checks** (bulk permissions, snapshot ownership/expiry, field validation, atomic rollback, idempotency, owner exclusions and notification behavior).
- Route coverage/security audit accounts for 117 server routes.
- All 28 exported email templates pass structural validation.
- Full browser regression: **88/88 passed**, with retries disabled.
- After final mobile contact-spacing and inactive-email badge styling, the three dedicated customer/bulk/email browser scenarios passed again.
- Desktop and mobile live-preview inspection found no page runtime errors or horizontal overflow. Automated layouts cover 320, 390, 768 and 1440px widths.

The live website runs on port 5173 with the API on port 8787; browser requests use the website's relative `/api` proxy. No external funds were moved and no email provider was activated during this work.
