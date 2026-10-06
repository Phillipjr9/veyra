import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { normalizeGoogleAddress } from "../src/addresses.js";
import { resetRateLimits, rateLimit } from "../src/security.js";

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let clock = originalNow();
Date.now = () => clock;
const savedKey = process.env.GOOGLE_MAPS_API_KEY;
process.env.GOOGLE_MAPS_API_KEY = "";
process.env.ADMIN_EMAIL = ""; process.env.ADMIN_PASSWORD = "";
const { app, db } = createApp(":memory:");
const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const requests: Array<{ url: string; options: RequestInit }> = [];
const component = (type: string, longText: string, shortText = longText) => ({ types: [type], longText, shortText });
const address = [component("street_number", "1841"), component("route", "Maple Grove Avenue"), component("locality", "Austin"), component("administrative_area_level_1", "Texas", "TX"), component("postal_code", "78701"), component("postal_code_suffix", "1234"), component("country", "United States", "US"), component("subpremise", "12")];
let mode = "ok";
let releaseOld!: () => void, sawOld!: () => void;
let oldStarted = Promise.resolve();
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  if (!url.startsWith("https://places.googleapis.com/v1/")) return originalFetch(input, options);
  requests.push({ url, options });
  if (mode === "error") return Response.json({ error: { message: "SENSITIVE_KEY_MUST_NOT_LEAK" } }, { status: 403 });
  if (mode === "timeout") throw new DOMException("upstream details must not leak", "TimeoutError");
  if (options.method === "POST") {
    const body = JSON.parse(String(options.body));
    if (body.input === "old request") { sawOld(); await new Promise<void>(resolve => { releaseOld = resolve; }); }
    return Response.json({ suggestions: [{ placePrediction: { placeId: "Place_fixture", text: { text: "1841 Maple Grove Avenue, Austin, TX" }, ignored: "private upstream data" } }, { queryPrediction: { text: "not an address" } }] });
  }
  return Response.json({ addressComponents: mode === "non-us" ? [component("country", "Canada", "CA")] : address, attributions: [{ provider: "Fixture provider", providerUri: "https://example.com/attribution" }, { provider: "Bad URI", providerUri: "javascript:alert(1)" }] });
};
const post = async (path: string, body: unknown, headers = {}) => {
  const response = await originalFetch(`${base}/api/address/${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as any, cache: response.headers.get("cache-control") };
};
let checks = 0;
function check(name: string, value: unknown) { assert.ok(value, name); checks++; console.log(`✓ ${name}`); }
try {
  let config = await (await originalFetch(`${base}/api/auth/config`)).json() as any;
  check("public configuration disables suggestions without a key", config.addresses.enabled === false);
  check("disabled endpoint makes no provider request", (await post("autocomplete", { input: "1841", sessionToken: randomUUID() })).status === 503 && requests.length === 0);
  process.env.GOOGLE_MAPS_API_KEY = "SENSITIVE_KEY_MUST_NOT_LEAK";
  config = await (await originalFetch(`${base}/api/auth/config`)).json();
  check("configured capability exposes no key", config.addresses.enabled && !JSON.stringify(config).includes(process.env.GOOGLE_MAPS_API_KEY));
  for (const body of [{ input: "ab", sessionToken: randomUUID() }, { input: "x".repeat(161), sessionToken: randomUUID() }, { input: "line\nbreak", sessionToken: randomUUID() }, { input: 1234, sessionToken: randomUUID() }, { input: "1841", sessionToken: "invalid" }]) {
    check("invalid query/session rejected before Google", (await post("autocomplete", body)).status === 400 && requests.length === 0);
  }
  check("cross-site browser call cannot spend provider quota", (await post("autocomplete", { input: "1841", sessionToken: randomUUID() }, { "Sec-Fetch-Site": "cross-site" })).status === 403 && requests.length === 0);
  const token = randomUUID();
  const suggestions = await post("autocomplete", { input: " 1841 ", sessionToken: token, ssn: "ignored", email: "ignored" });
  check("suggestions return only address candidates and disable caching", suggestions.status === 200 && suggestions.body.suggestions.length === 1 && suggestions.cache === "no-store");
  const outgoing = JSON.parse(String(requests[0].options.body));
  check("upstream body excludes all other signup information", outgoing.input === "1841" && !JSON.stringify(outgoing).includes("ignored") && outgoing.includedRegionCodes[0] === "us" && outgoing.sessionToken === token);
  check("fixed Google endpoint, private key header, timeout, no redirects", requests[0].url === "https://places.googleapis.com/v1/places:autocomplete" && new Headers(requests[0].options.headers).get("X-Goog-Api-Key") === process.env.GOOGLE_MAPS_API_KEY && requests[0].options.signal instanceof AbortSignal && requests[0].options.redirect === "error");
  check("unrelated place ID is not a general details proxy", (await post("details", { placeId: "other", sessionToken: token })).status === 400 && requests.length === 1);
  check("unrelated session cannot use another session's suggestion", (await post("details", { placeId: "Place_fixture", sessionToken: randomUUID() })).status === 400 && requests.length === 1);
  check("path-injection place ID rejected", (await post("details", { placeId: "../other?key=x", sessionToken: token })).status === 400);
  const selected = await post("details", { placeId: "Place_fixture", sessionToken: token });
  check("selection fills structured street, unit, city, state and ZIP+4", selected.status === 200 && selected.body.address.street === "1841 Maple Grove Avenue" && selected.body.address.city === "Austin" && selected.body.address.state === "TX" && selected.body.address.postalCode === "78701-1234" && selected.body.address.unit === "12");
  check("details uses same session and minimal fields", requests[1].url.includes(`sessionToken=${token}`) && new Headers(requests[1].options.headers).get("X-Goog-FieldMask") === "addressComponents,attributions");
  check("provider attribution retained, unsafe URLs stripped", selected.body.attributions[0].name === "Fixture provider" && selected.body.attributions[1].url === undefined);
  check("selection consumes session and cannot be replayed", (await post("details", { placeId: "Place_fixture", sessionToken: token })).status === 400 && (await post("autocomplete", { input: "1841", sessionToken: token })).status === 400);
  const incomplete = normalizeGoogleAddress([component("route", "Example Street"), component("country", "United States", "US"), component("administrative_area_level_2", "Not a city")]);
  check("missing locality/ZIP never fabricated from county or display text", incomplete.city === "" && incomplete.postalCode === "");
  const foreign = randomUUID(); await post("autocomplete", { input: "1841", sessionToken: foreign }); mode = "non-us";
  check("non-US detail is not placed into US fields", (await post("details", { placeId: "Place_fixture", sessionToken: foreign })).status === 422);
  mode = "error";
  const failed = await post("autocomplete", { input: "1841", sessionToken: randomUUID() });
  check("upstream failures are sanitized and suggest manual entry", failed.status === 503 && !JSON.stringify(failed.body).includes(process.env.GOOGLE_MAPS_API_KEY));
  mode = "timeout";
  check("timeout fails safely without leaking provider error", (await post("autocomplete", { input: "1841", sessionToken: randomUUID() })).status === 503);
  mode = "ok";
  const expiredToken = randomUUID(); await post("autocomplete", { input: "1841", sessionToken: expiredToken });
  clock += 181_000;
  check("expired suggestion sessions cannot request details", (await post("details", { placeId: "Place_fixture", sessionToken: expiredToken })).status === 400);
  const raceToken = randomUUID();
  oldStarted = new Promise<void>(resolve => { sawOld = resolve; });
  const old = post("autocomplete", { input: "old request", sessionToken: raceToken }); await oldStarted;
  await post("autocomplete", { input: "new request", sessionToken: raceToken });
  await post("details", { placeId: "Place_fixture", sessionToken: raceToken }); releaseOld();
  check("late autocomplete cannot reopen a consumed session", (await old).status === 400);
  clock += 61_000; resetRateLimits(); const before = requests.length;
  for (let i = 0; i < 40; i++) await post("autocomplete", { input: "1841", sessionToken: randomUUID() });
  check("connection budget blocks more provider calls even with spoofed forwarding headers", (await post("autocomplete", { input: "1841", sessionToken: randomUUID() }, { "X-Forwarded-For": "203.0.113.123" })).status === 429 && requests.length === before + 40);
  clock += 61_000; resetRateLimits(); for (let i = 0; i < 600; i++) rateLimit("address:instance", 600, 60 * 60_000);
  check("instance budget also fails closed", (await post("autocomplete", { input: "1841", sessionToken: randomUUID() })).status === 429);
  console.log(`\nALL ADDRESS TESTS PASSED (${checks} checks)`);
} finally {
  globalThis.fetch = originalFetch; Date.now = originalNow;
  if (savedKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY; else process.env.GOOGLE_MAPS_API_KEY = savedKey;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); db.close(); resetRateLimits();
}
