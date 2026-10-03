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

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function setToken(token: string): void {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage unavailable */ }
}
export function clearToken(): void {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

/** Synchronous read of the last probe result (null before the first probe). */
export function apiOnline(): boolean {
  return cachedOnline === true;
}

/**
 * Tri-state reachability: "unknown" before the first probe resolves. Callers
 * that must decide whether to *send* something can treat unknown as "try it" —
 * the request itself is the better probe — while "offline" is a known fact.
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
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Request failed (${res.status}).`);
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
