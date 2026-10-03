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
const HEALTH_TIMEOUT_MS = 2500;

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

export function getToken(): string | null {
  return memoryToken ?? readStoredToken();
}
export function setToken(token: string): void {
  memoryToken = token;
  try { localStorage.setItem(TOKEN_KEY, token); return; } catch { /* fall through to session storage */ }
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* memory-only session */ }
}
export function clearToken(): void {
  memoryToken = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
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
type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function sessionRejected(hadToken: boolean): void {
  if (!hadToken) return; // a failed sign-in attempt: the form reports it, nothing to clear
  clearToken();
  unauthorizedListeners.forEach(listener => listener());
}

/**
 * Ends the session outright. Used when a 401 arrives on a request that carried
 * no token while the app believes someone is signed in: that combination can
 * only mean the session is unusable (the browser dropped the token — blocked
 * storage, a cleared profile — or it was never there), so the caller must not
 * render a dead end. The login form takes over and says why.
 */
export function endSession(): void {
  clearToken();
  unauthorizedListeners.forEach(listener => listener());
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
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Authenticated JSON request. Throws ApiError with the server's message on failure. */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok) {
    if (res.status === 401) sessionRejected(Boolean(token));
    throw new ApiError(res.status, json?.error ?? `Request failed (${res.status}).`);
  }
  return json as T;
}

/**
 * Authenticated download. Same auth header as `api()`, but returns the raw
 * body (CSV/text) instead of JSON — used for server-generated exports, where
 * the response is a file, not an API envelope.
 */
export async function apiGetText(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { headers });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) sessionRejected(Boolean(token));
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
export const apiGet = <T = unknown,>(path: string) => api<T>("GET", path);
export const apiPost = <T = unknown,>(path: string, body?: unknown) => api<T>("POST", path, body);
export const apiPatch = <T = unknown,>(path: string, body?: unknown) => api<T>("PATCH", path, body);
export const apiPut = <T = unknown,>(path: string, body?: unknown) => api<T>("PUT", path, body);
export const apiDelete = <T = unknown,>(path: string) => api<T>("DELETE", path);
