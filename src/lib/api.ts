/**
 * Backend API client.
 *
 * The Express + SQLite backend (server/) is the system of record — auth,
 * accounts, money movement, RBAC and the audit trail are all server-side.
 * /api is proxied in dev and same-origin in production.
 *
 * Reachability is probed via GET /api/health (short timeout) so the UI can
 * show an offline banner when the server can't be reached.
 */

const TOKEN_KEY = "veyra.token";
const DEVICE_KEY = "veyra.device_id";
const HEALTH_TIMEOUT_MS = 2500;
let memoryDeviceId: string | null = null;

/** Stable, non-secret browser id used only to group sessions in Security Center. */
export function getDeviceId(): string {
  if (memoryDeviceId) return memoryDeviceId;
  for (const storage of [() => localStorage, () => sessionStorage]) {
    try {
      const stored = storage().getItem(DEVICE_KEY);
      if (stored && /^[a-f0-9-]{32,36}$/i.test(stored)) {
        memoryDeviceId = stored;
        return stored;
      }
    } catch { /* storage blocked */ }
  }

  const bytes = new Uint8Array(16);
  try { crypto.getRandomValues(bytes); }
  catch { for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256); }
  const id = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  memoryDeviceId = id;
  try { localStorage.setItem(DEVICE_KEY, id); }
  catch { try { sessionStorage.setItem(DEVICE_KEY, id); } catch { /* memory for this page only */ } }
  return id;
}

let cachedOnline: boolean | null = null;
let probe: Promise<boolean> | null = null;
/**
 * The token lives in memory first, and is mirrored into web storage when the
 * browser allows it.
 *
 * The memory copy is not a cache — it is the source of truth for the page's
 * lifetime. Preview frames (and any browser with third-party storage blocked,
 * Safari's ITP, or private mode) make `localStorage.setItem` throw, and a
 * swallowed write used to leave the app rendering a signed-in shell while
 * every request went out with no Authorization header, which the API answers
 * with 401 "Authentication required." — surfacing as "We couldn't load your
 * account". Keeping the token in memory means sign-in works in those contexts;
 * it just doesn't survive a reload, which `storageBlocked()` lets the UI say.
 */
let memoryToken: string | null = null;

function readStoredToken(): string | null {
  try { const t = localStorage.getItem(TOKEN_KEY); if (t) return t; } catch { /* storage blocked */ }
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }

}

/**
 * Last-resort store: `window.name`.
 *
 * Preview frames are frequently sandboxed without same-origin access, which
 * makes localStorage and sessionStorage throw — so a hard reload loses the
 * session and the member is asked to sign in again on every reload, which
 * reads as "I can never log in". `window.name` survives reloads of the frame
 * and works in an opaque origin. It is only written when no real storage is
 * available, and never overwrites a value we did not set, so a host page that
 * uses window.name for its own purposes is left alone.
 */
const NAME_PREFIX = "veyra.token=";

function readNameToken(): string | null {
  try {
    const name = window.name;
    return typeof name === "string" && name.startsWith(NAME_PREFIX) ? name.slice(NAME_PREFIX.length) || null : null;
  } catch { return null; }
}

function writeNameToken(token: string | null): void {
  try {
    const name = window.name;
    if (token) {
      if (name === "" || name.startsWith(NAME_PREFIX)) window.name = NAME_PREFIX + token;
      return;
    }
    if (typeof name === "string" && name.startsWith(NAME_PREFIX)) window.name = "";
  } catch { /* ignore */ }
}

export function getToken(): string | null {
  return memoryToken ?? readStoredToken() ?? readNameToken();
}
export function setToken(token: string): void {
  memoryToken = token;
  try { localStorage.setItem(TOKEN_KEY, token); return; } catch { /* fall through to session storage */ }
  try { sessionStorage.setItem(TOKEN_KEY, token); return; } catch { /* fall through to window.name */ }
  writeNameToken(token);
}
export function clearToken(): void {
  memoryToken = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  writeNameToken(null);
}

/** True when the browser refuses web storage (private mode, blocked third-party storage, sandboxed frame). */
export function storageBlocked(): boolean {
  try {
    const probeKey = "veyra.storage-probe";
    localStorage.setItem(probeKey, "1");
    localStorage.removeItem(probeKey);
    return false;
  } catch { return true; }
}

/**
 * Sign-out of last resort: any request rejected with 401 means the session the
 * app is holding is not usable, so the token is dropped and listeners (the
 * auth provider) send the user back to the login form instead of leaving a
 * dead-end error card on the page.
 */
type UnauthorizedListener = (reason: string) => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function sessionRejected(hadToken: boolean, reason: string): void {
  if (!hadToken) return; // a failed sign-in attempt: the form reports it, nothing to clear
  clearToken();
  unauthorizedListeners.forEach(listener => listener(reason));
}

/**
 * Ends the session outright. Used when a 401 arrives on a request that carried
 * no token while the app believes someone is signed in: that combination can
 * only mean the session is unusable (the browser dropped the token — blocked
 * storage, a cleared profile — or it was never there), so the caller must not
 * render a dead end. The login form takes over and says why.
 */
export function endSession(reason = ""): void {
  clearToken();
  unauthorizedListeners.forEach(listener => listener(reason));
}

/**
 * Tri-state reachability, read synchronously from the last probe (null → the
 * first probe hasn't resolved). Callers that must decide whether to *send*
 * something treat "unknown" as "try it" — the request itself is the better
 * probe — while "offline" is a known fact.
 */
export function apiReachability(): "online" | "offline" | "unknown" {
  return cachedOnline === null ? "unknown" : cachedOnline ? "online" : "offline";
}

/** Probes the backend health endpoint. Result is cached for the session. */
export async function probeApi(force = false): Promise<boolean> {
  if (!force && probe) return probe;
  probe = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
      const res = await fetch("/api/health", { signal: ctrl.signal });
      clearTimeout(timer);
      const body = await res.json().catch(() => null);
      cachedOnline = res.ok && body?.ok === true;
    } catch {
      cachedOnline = false;
    }
    return cachedOnline;
  })();
  return probe;
}

export class ApiError extends Error {
  status: number;
  /** The form field a validation failure points at, when the server sends one. */
  field?: string;
  constructor(status: number, message: string, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/**
 * Turns whatever a call threw into something a member can act on: what the
 * server said, the status behind it, and what to do about it. The sign-in form
 * shows all three, so a failure never leaves someone guessing.
 */
export function describeAuthError(err: unknown, action = "sign in"): { message: string; hint: string; status?: number } {
  if (err instanceof ApiError) {
    switch (err.status) {
      case 401:
        return action.toLowerCase().includes("authenticator code")
          ? { message: err.message, hint: "Enter the current six-digit code from your authenticator app. Check your device clock, then try again.", status: err.status }
          : { message: err.message, hint: "Check the email and password — they have to match the account exactly.", status: err.status };
      case 400:
        return action.toLowerCase().includes("authenticator code")
          ? { message: err.message, hint: "The sign-in code request may have expired. Start again with your email and password.", status: err.status }
          : { message: err.message, hint: `The server refused the ${action} request (HTTP ${err.status}).`, status: err.status };
      case 403:
        return { message: err.message, hint: "This account is not allowed to sign in. Contact support if that is unexpected.", status: err.status };
      case 404:
        return { message: err.message, hint: `No account matches that email. Create one, or use a demo account below.`, status: err.status };
      case 429:
        return { message: err.message, hint: "Too many attempts in the last minute. Wait about a minute, then try again.", status: err.status };
      default:
        return {
          message: err.message,
          hint: err.status >= 500
            ? "The server hit an error. Try again in a moment."
            : `The server refused the ${action} request (HTTP ${err.status}).`,
          status: err.status,
        };
    }
  }
  if (err instanceof TypeError) {
    return { message: "Cannot reach the Veyra server.", hint: "The connection failed before the server answered — check your network, or whether the API is running." };
  }
  return { message: err instanceof Error ? err.message : `Could not ${action}.`, hint: "Try again — if it keeps happening, contact support." };
}

/**
 * `handleUnauthorized: false` keeps a 401 out of the app-wide session handling —
 * for the one call that *checks* a leftover session on load, where a rejection
 * is the normal start of a visit rather than a session dying under the member.
 */
type ApiOptions = { handleUnauthorized?: boolean };

/**
 * Auth headers for a request carrying `token`.
 *
 * Both `Authorization` and a custom `X-Veyra-Token` are sent. Reverse proxies —
 * including preview hosts — sometimes consume or strip `Authorization` for
 * their own access control, which makes every authenticated request fail with
 * "Authentication required." even though the client attached the token. The
 * custom header is ignored by such proxies and read by the API, so the session
 * works either way.
 */
function authHeaders(token: string, only?: "custom"): Record<string, string> {
  return only === "custom" ? { "X-Veyra-Token": token } : { Authorization: `Bearer ${token}`, "X-Veyra-Token": token };
}

/** Authenticated JSON request. Throws ApiError with the server's message on failure. */
export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: ApiOptions = {}): Promise<T> {
  const token = getToken();
  const send = (only?: "custom") => {
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-Veyra-Device": getDeviceId(), ...(token ? authHeaders(token, only) : {}) };
    return fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  };
  let res = await send();
  let text = await res.text();

  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }

  // The server saw no token at all while this client sent one: a proxy dropped
  // the header. Retry once over the header proxies leave alone.
  if (res.status === 401 && json?.code === "no_token" && token) {
    res = await send("custom");
    text = await res.text();
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
  }

  if (!res.ok) {
    if (res.status === 401 && opts.handleUnauthorized !== false) sessionRejected(Boolean(token), json?.error ?? "Session rejected.");
    throw new ApiError(res.status, json?.error ?? `Request failed (${res.status}).`, typeof json?.field === "string" ? json.field : undefined);
  }
  return json as T;
}

/**
 * Authenticated download. Same auth header as `api()`, but returns the raw
 * body (CSV/text) instead of JSON — used for server-generated exports, where
 * the response is a file, not an API envelope.
 */
export async function apiGetText(path: string): Promise<string> {
  const token = getToken();
  const send = (only?: "custom") => fetch(path, { headers: { "X-Veyra-Device": getDeviceId(), ...(token ? authHeaders(token, only) : {}) } });
  let res = await send();
  let text = await res.text();
  if (res.status === 401 && token && text.includes("no_token")) {
    res = await send("custom");
    text = await res.text();
  }
  if (!res.ok) {
    if (res.status === 401) sessionRejected(Boolean(token), "Session rejected.");
    let message = `Request failed (${res.status}).`;
    try {
      const json = JSON.parse(text) as { error?: string };
      if (json?.error) message = json.error;
    } catch { /* not a JSON error envelope */ }
    throw new ApiError(res.status, message);
  }
  return text;
}

/** Convenience wrappers */
export const apiGet = <T = unknown,>(path: string, opts?: ApiOptions) => api<T>("GET", path, undefined, opts);
export const apiPost = <T = unknown,>(path: string, body?: unknown) => api<T>("POST", path, body);
export const apiPatch = <T = unknown,>(path: string, body?: unknown) => api<T>("PATCH", path, body);
export const apiPut = <T = unknown,>(path: string, body?: unknown) => api<T>("PUT", path, body);
export const apiDelete = <T = unknown,>(path: string) => api<T>("DELETE", path);
