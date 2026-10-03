/**
 * `npm run demo:seed` — creates/refreshes the demo accounts the login page
 * offers with one click, against a running API.
 *
 * The fixture itself lives in server/src/demo.ts so the dev server can use the
 * same one on boot (a fresh database is never empty).
 *
 *   npm run demo:seed
 *   API_URL=http://other-host:8787 npm run demo:seed
 */
import { seedDemoAccounts, DEMO_PASSWORD, DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } from "../server/src/demo.js";

const baseUrl = (process.env.API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const adminEmail = process.env.ADMIN_EMAIL || DEMO_ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD || DEMO_ADMIN_PASSWORD;

let result;
try {
  result = await seedDemoAccounts({
    baseUrl,
    adminEmail,
    adminPassword,
    log: line => console.log(line),
  });
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}. Start it with: npm run server`);
  process.exit(1);
}

console.log(`\n${result.created} account(s) created, ${result.seeded} seeded, ${result.skipped} already had data.`);
console.log("Sign in from the login page with one click, or use:");
console.log(`  demo.personal@veyra.dev / ${DEMO_PASSWORD}   (personal dashboard)`);
console.log(`  demo.business@veyra.dev / ${DEMO_PASSWORD}   (business dashboard)`);
console.log(`  ${adminEmail} / ${adminPassword}   (admin console)`);
