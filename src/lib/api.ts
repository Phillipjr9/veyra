/**
 * Backend API client.
 *
 * The app runs in two modes:
 *   — API mode: the Express + SQLite backend (server/) is reachable at /api
 *     (proxied in dev, same-origin in production). Auth, money, RBAC and the
 *     audit trail are server-authoritative.
 *   — Local mode: the backend is unreachable; the app falls back to the
 *     original localStorage demo so the standalone experience keeps working.
 *
 * Mode is probed once per page load (plus on demand when logging in) via
 * GET /api/health with a short timeout.
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

/** Convenience wrappers */
export const apiGet = <T = unknown,>(path: string) => api<T>("GET", path);
export const apiPost = <T = unknown,>(path: string, body?: unknown) => api<T>("POST", path, body);
export const apiPatch = <T = unknown,>(path: string, body?: unknown) => api<T>("PATCH", path, body);
export const apiPut = <T = unknown,>(path: string, body?: unknown) => api<T>("PUT", path, body);
export const apiDelete = <T = unknown,>(path: string) => api<T>("DELETE", path);
