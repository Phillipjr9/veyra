import { checkMarketFeed } from "../src/marketFeedCheck.js";

// Explicit operational check; intentionally not part of the offline test suite.
if (process.env.PREVIEW_CRYPTO_DATA === "1") {
  console.error("Set PREVIEW_CRYPTO_DATA=0 before checking the actual provider connection.");
  process.exitCode = 1;
} else {
  const checks = await checkMarketFeed();
  const ready = checks.every(check => check.ok);
  console.log(JSON.stringify({ ready, checks }, null, 2));
  if (!ready) {
    console.error("Feed is not ready. Network codes indicate connection/TLS failures; HTTP 401/403 require checking key, plan or provider access; HTTP 429 indicates rate/quota limits. Never disable certificate verification.");
    process.exitCode = 1;
  }
}
