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
// Preview browsers can be embedded in a context where persistent storage is
// blocked. Keep the active token in memory as well, so a successful sign-in
// always authenticates the current page even when localStorage is unavailable.
// `undefined` means storage has not been checked yet; `null` means explicitly
// signed out, so an old storage value can never be resurrected.
let sessionToken: string | null | undefined;

export function getToken(): string | null {
  // A freshly issued in-memory credential wins over an older persisted value.
  // This matters in embedded previews where storage can be readable but writes
  // or removal are blocked, leaving a stale value behind.
  if (sessionToken !== undefined) return sessionToken;
  try {
    sessionToken = localStorage.getItem(TOKEN_KEY);
  } catch {
    sessionToken = null;
  }
  return sessionToken;
}
export function setToken(token: string): void {
  sessionToken = token;
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* persistence unavailable — current session still works */ }
}
export function clearToken(): void {
  sessionToken = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

/** Synchronous read of the last probe result (null before the first probe). */
export function apiOnline(): boolean {
  return cachedOnline === true;
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
    // Explicitly keep the HttpOnly same-origin session cookie sent by the API.
    // This is a resilient fallback when an embedded browser blocks localStorage.
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Request failed (${res.status}).`);
  return json as T;
}

/** Convenience wrappers */
export const apiGet = <T = unknown,>(path: string) => api<T>("GET", path);
export const apiPost = <T = unknown,>(path: string, body?: unknown) => api<T>("POST", path, body);
export const apiPatch = <T = unknown,>(path: string, body?: unknown) => api<T>("PATCH", path, body);
export const apiPut = <T = unknown,>(path: string, body?: unknown) => api<T>("PUT", path, body);
export const apiDelete = <T = unknown,>(path: string) => api<T>("DELETE", path);
