/**
 * Exports every email template to a standalone HTML file in /emails.
 *
 *   npx tsx scripts/build-emails.ts
 *
 * The generated files are what you'd paste into SendGrid / Postmark / Mailgun
 * or keep in version control for design review. Re-run after editing templates.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emailTemplates } from "../src/emails/templates";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, "..", "emails");

mkdirSync(outDir, { recursive: true });

for (const t of emailTemplates) {
  const file = resolve(outDir, `${t.id}.html`);
  writeFileSync(file, t.html, "utf8");
  console.log(`wrote emails/${t.id}.html`);
}

console.log(`\n${emailTemplates.length} templates exported to ${outDir}`);
