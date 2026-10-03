import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet, apiPost, apiPatch, probeApi, getToken, setToken, clearToken, onUnauthorized, ApiError } from "./api";

export type UserRole = "user" | "support" | "compliance" | "admin" | "superadmin";

export type User = {
  id: string;
  name: string;
  phone?: string;
  business: string;
  accountType: "personal" | "business";
  email: string;
  avatarUrl?: string; // custom uploaded picture data url or 3d avatar default
  role?: UserRole;
  plan: "Starter" | "Pro";
  createdAt: number;
};

type AuthValue = {
  user: User | null;
  ready: boolean;
  /** True when the API could not be reached on the last probe. */
  offline: boolean;
  /**
   * Set when the server rejected the stored session (revoked, expired, or the
   * token never made it out of a storage-blocked browser) or when a request
   * came back 401 mid-session. The login page shows it, so an interrupted
   * session explains itself instead of dumping the user on a bare form.
   */
  sessionNotice: string;
  /** The server's own wording for the rejection — shown small, for diagnosis. */
  sessionDetail: string;
  dismissSessionNotice: () => void;
  /** Forgets this browser's session entirely (every token store) and returns to the form. */
  resetSession: () => void;
  login: (email: string, password: string) => Promise<User>;
  signup: (input: { name: string; phone?: string; business?: string; accountType: User["accountType"]; email: string; password: string; plan?: User["plan"] }) => Promise<void>;
  logout: () => void;
  updateUser: (patch: Partial<Pick<User, "name" | "phone" | "business" | "accountType" | "email" | "plan" | "role" | "avatarUrl">>) => void;
  changePassword: (current: string, next: string) => Promise<void>;
  /** Step 1 of password recovery — always resolves with a generic response. */
  forgotPassword: (email: string) => Promise<void>;
  /** Step 2 — completes the reset with the token from the email. */
  resetPassword: (token: string, password: string) => Promise<void>;
};

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [sessionNotice, setSessionNotice] = useState("");
  const [sessionDetail, setSessionDetail] = useState("");

  useEffect(() => {
    (async () => {
      const online = await probeApi();
      setOffline(!online);
      if (online && getToken()) {
        // Restore the session from the server via the stored bearer token.
        try {
          // Quiet: a refusal here means a stale token, not a session ending now.
          const { user: me } = await apiGet<{ user: User }>("/api/auth/me", { handleUnauthorized: false });
          setUser(me);
        } catch (err) {
          // A token left over from a previous visit was refused (it expired, was
          // revoked, or the account is gone — a restarted server with a rebuilt
          // database does this). That is the normal start of a new visit, not a
          // failure worth a banner: drop it quietly and show a clean sign-in.
          // Only losing a session you were actively using gets the notice below.
          clearToken();
          if (err instanceof ApiError && err.status === 401) {
            console.info(`[veyra] discarded a stored session: ${err.message}`);
          }
        }
      }
      setReady(true);
    })();
  }, []);

  useEffect(() => onUnauthorized(reason => {
    setUser(null);
    setSessionNotice("Your session ended — sign in again to pick up where you left off.");
    setSessionDetail(reason);
  }), []);

  const dismissSessionNotice = useCallback(() => { setSessionNotice(""); setSessionDetail(""); }, []);

  /** Clears every place a token could hide and drops back to the form. */
  const resetSession = useCallback(() => {
    clearToken();
    setUser(null);
    dismissSessionNotice();
  }, [dismissSessionNotice]);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    // A leftover token must not ride along with a sign-in attempt: if the server
    // rejected the request, the automatic 401 handling would clear the session
    // and claim it "ended" — confusing when the real cause is a typed password.
    clearToken();
    if (!(await probeApi(true))) throw new Error("Cannot reach the Veyra server. Check your connection and try again.");
    const { token, user: me } = await apiPost<{ token: string; user: User }> ("/api/auth/login", { email: email.trim(), password });
    setToken(token);
    setUser(me);
    setSessionNotice("");
    setSessionDetail("");
    return me;
  }, []);

  const signup = useCallback<AuthValue["signup"]>(async ({ name, phone = "", business = "", accountType, email, password, plan = "Pro" }) => {
    if (!(await probeApi(true))) throw new Error("Cannot reach the Veyra server. Check your connection and try again.");
    const { token, user: me } = await apiPost<{ token: string; user: User }>("/api/auth/register", {
      name: name.trim(), phone: phone.trim(), business: accountType === "business" ? business.trim() : "",
      accountType, email: email.trim(), password, plan,
    });
    setToken(token);
    setUser(me);
    setSessionNotice("");
  }, []);

  const logout = useCallback(() => {
    // Revoke the server session (best-effort — local sign-out proceeds regardless).
    apiPost("/api/auth/logout").catch(() => undefined);
    clearToken();
    setUser(null);
    setSessionNotice("");
  }, []);

  const updateUser = useCallback<AuthValue["updateUser"]>(patch => {
    setUser(prev => (prev ? { ...prev, ...patch } : prev));
    // Persist server-side; the optimistic local state stands until the next snapshot.
    apiPatch("/api/me/profile", patch).catch(() => undefined);
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    if (!user) throw new Error("You need to be signed in.");
    await apiPost("/api/auth/change-password", { current, next });
  }, [user]);

  const forgotPassword = useCallback(async (email: string) => {
    await apiPost("/api/auth/forgot-password", { email: email.trim() });
  }, []);

  const resetPassword = useCallback(async (token: string, password: string) => {
    await apiPost("/api/auth/reset-password", { token: token.trim(), password });
  }, []);

  const value = useMemo(
    () => ({ user, ready, offline, sessionNotice, sessionDetail, dismissSessionNotice, resetSession, login, signup, logout, updateUser, changePassword, forgotPassword, resetPassword }),
    [user, ready, offline, sessionNotice, sessionDetail, dismissSessionNotice, resetSession, login, signup, logout, updateUser, changePassword, forgotPassword, resetPassword],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export { ApiError };
