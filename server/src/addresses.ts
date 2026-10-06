import type { Request, Response } from "express";
import { rateLimit } from "./security.js";

const GOOGLE = "https://places.googleapis.com/v1";
const SESSION = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PLACE = /^[A-Za-z0-9_-]{1,255}$/;
const TTL = 3 * 60_000;
export const addressConfig = () => ({ enabled: Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim()), countries: ["us"] });
class AddressError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
type Component = { longText?: string; shortText?: string; types?: string[] };
export function normalizeGoogleAddress(components: Component[]) {
  const part = (type: string, short = false) => {
    const item = components.find(value => value.types?.includes(type));
    return String((short ? item?.shortText : item?.longText) ?? "").slice(0, 160);
  };
  if (part("country", true) !== "US") throw new AddressError(422, "This application currently supports US addresses. Enter your address manually.");
  const street = [part("street_number"), part("route")].filter(Boolean).join(" ");
  if (!street) throw new AddressError(422, "That suggestion has no street address. Enter the address manually.");
  return {
    street,
    unit: part("subpremise"),
    city: part("locality") || part("postal_town") || part("sublocality_level_1"),
    state: part("administrative_area_level_1", true),
    postalCode: [part("postal_code"), part("postal_code_suffix")].filter(Boolean).join("-"),
    country: "United States",
  };
}

/** Public signup helper, not a general Google proxy. No predictions or typed addresses are persisted. */
export function createAddressService() {
  // Only place IDs are retained briefly to bind a details lookup to suggestions
  // from this connection/session. No address text is stored in this map.
  const clients = new Map<string, { count: number; expires: number }>();
  const sessions = new Map<string, { ids: Set<string>; expires: number; ended?: boolean }>();
  const sessionKey = (ip: string, token: string) => `${ip}:${token}`;
  const sendGoogle = async (path: string, body?: unknown) => {
    const response = await fetch(`${GOOGLE}${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY!.trim(),
        "X-Goog-FieldMask": body ? "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text" : "addressComponents,attributions" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!response.ok) throw new AddressError(503, "Google address suggestions are temporarily unavailable. You can enter the address manually.");
    return await response.json() as {
      suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }>;
      addressComponents?: Component[];
      attributions?: Array<{ provider?: string; providerUri?: string }>;
    };
  };
  const handle = (kind: "autocomplete" | "details") => async (req: Request, res: Response) => {
    try {
      if (!addressConfig().enabled) throw new AddressError(503, "Address suggestions are not configured. Enter the address manually.");
      if (req.header("Sec-Fetch-Site") === "cross-site") throw new AddressError(403, "Use address suggestions from the Veyra application.");
      const token = req.body?.sessionToken;
      if (typeof token !== "string" || !SESSION.test(token)) throw new AddressError(400, "Invalid address session. Try typing the address again.");
      const input = req.body?.input;
      const placeId = req.body?.placeId;
      if (kind === "autocomplete" && (typeof input !== "string" || input.trim().length < 3 || input.length > 160 || /[\u0000-\u001f\u007f]/.test(input))) {
        throw new AddressError(400, "Enter between 3 and 160 characters for address suggestions.");
      }
      if (kind === "details" && (typeof placeId !== "string" || !PLACE.test(placeId))) throw new AddressError(400, "Invalid address selection.");
      const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
      // Never trust a caller-supplied forwarding header as its rate-limit identity.
      for (const [client, budget] of clients) if (budget.expires < Date.now()) clients.delete(client);
      let budget = clients.get(ip);
      if (!budget && clients.size < 1000) {
        budget = { count: 0, expires: Date.now() + 60_000 }; clients.set(ip, budget);
      }
      if (!budget || ++budget.count > 40 || !rateLimit("address:instance", 600, 60 * 60_000)) {
        res.set("Retry-After", "60");
        throw new AddressError(429, "Address lookup limit reached. Enter the address manually.");
      }
      for (const [key, session] of sessions) if (session.expires < Date.now()) sessions.delete(key);
      const key = sessionKey(ip, token);
      if (sessions.get(key)?.ended) throw new AddressError(400, "Start a new address search after a selection.");
      if (kind === "autocomplete") {
        const data = await sendGoogle("/places:autocomplete", { input: input.trim(), sessionToken: token, includedRegionCodes: ["us"], languageCode: "en", regionCode: "us", includeQueryPredictions: false });
        const suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []).flatMap((item: { placePrediction?: { placeId?: string; text?: { text?: string } } }) => {
          const p = item.placePrediction;
          return p && typeof p.placeId === "string" && PLACE.test(p.placeId) && typeof p.text?.text === "string"
            ? [{ placeId: p.placeId, label: p.text.text.slice(0, 350) }] : [];
        }).slice(0, 5);
        if (sessions.get(key)?.ended) throw new AddressError(400, "This address session has ended.");
        const previous = sessions.get(key);
        const ids = new Set([...(previous?.ids ?? []), ...suggestions.map((p: { placeId: string }) => p.placeId)].slice(-25));
        if (sessions.size >= 1000) sessions.delete(sessions.keys().next().value!);
        sessions.set(key, { ids, expires: Date.now() + TTL });
        res.json({ suggestions });
      } else {
        const session = sessions.get(key);
        if (!session?.ids.has(placeId)) throw new AddressError(400, "Select a current suggestion, or enter your address manually.");
        sessions.set(key, { ids: new Set(), expires: Date.now() + TTL, ended: true }); // End the billing session, including in-flight suggestions.
        const data = await sendGoogle(`/places/${encodeURIComponent(placeId)}?sessionToken=${encodeURIComponent(token)}&languageCode=en`);
        const address = normalizeGoogleAddress(Array.isArray(data.addressComponents) ? data.addressComponents : []);
        const attributions = (Array.isArray(data.attributions) ? data.attributions : []).flatMap((a: { provider?: string; providerUri?: string }) => {
          if (typeof a.provider !== "string") return [];
          return [{ name: a.provider.slice(0, 160), url: typeof a.providerUri === "string" && /^https:\/\//.test(a.providerUri) ? a.providerUri : undefined }];
        });
        res.json({ address, attributions });
      }
    } catch (error) {
      // Never echo Google's response, request text or API key to the browser/logs.
      res.status(error instanceof AddressError ? error.status : 503).json({ error: error instanceof AddressError ? error.message : "Address lookup could not complete. Enter the address manually." });
    }
  };
  return { autocomplete: handle("autocomplete"), details: handle("details") };
}
