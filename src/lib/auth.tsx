import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet, apiPost, apiPatch, probeApi, getToken, setToken, clearToken, ApiError } from "./api";

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

export type PreviewAccountSnapshot = { userId: string; account: unknown };

type AuthValue = {
  user: User | null;
  /** Server-supplied state from the one-click development preview endpoint. */
  previewAccount: PreviewAccountSnapshot | null;
  ready: boolean;
  /** True when the API could not be reached on the last probe. */
  offline: boolean;
  login: (email: string, password: string) => Promise<User>;
  /** Development-preview role switcher; the server keeps this endpoint disabled outside an explicit preview runtime. */
  previewLogin: (persona: "personal" | "business" | "superadmin") => Promise<User>;
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
  const [previewAccount, setPreviewAccount] = useState<PreviewAccountSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    (async () => {
      // Keep the token that initiated restoration. A user can choose a preview
      // role while this request is still in flight; an old rejected request
      // must never erase that newly-issued session token.
      const restoringToken = getToken();
      const online = await probeApi();
      setOffline(!online);
      if (online && restoringToken) {
        try {
          const { user: me } = await apiGet<{ user: User }>("/api/auth/me");
          if (getToken() === restoringToken) setUser(me);
        } catch {
          if (getToken() === restoringToken) clearToken(); // revoked or expired — sign in again
        }
      }
      setReady(true);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<User> => {
    if (!(await probeApi(true))) throw new Error("Cannot reach the Veyra server. Check your connection and try again.");
    const { token, user: me } = await apiPost<{ token: string; user: User }> ("/api/auth/login", { email: email.trim(), password });
    setToken(token);
    setPreviewAccount(null);
    setUser(me);
    return me;
  }, []);

  const previewLogin = useCallback<AuthValue["previewLogin"]>(async persona => {
    const { token, user: me, account } = await apiPost<{ token: string; user: User; account: unknown }>("/api/auth/preview-access", { persona });
    setToken(token);
    // This data is an authoritative snapshot supplied by the guarded server
    // endpoint, not a client-side demo. It avoids a second auth round trip
    // before the preview dashboard can render.
    setPreviewAccount({ userId: me.id, account });
    setUser(me);
    return me;
  }, []);

  const signup = useCallback<AuthValue["signup"]>(async ({ name, phone = "", business = "", accountType, email, password, plan = "Pro" }) => {
    if (!(await probeApi(true))) throw new Error("Cannot reach the Veyra server. Check your connection and try again.");
    const { token, user: me } = await apiPost<{ token: string; user: User }>("/api/auth/register", {
      name: name.trim(), phone: phone.trim(), business: accountType === "business" ? business.trim() : "",
      accountType, email: email.trim(), password, plan,
    });
    setToken(token);
    setPreviewAccount(null);
    setUser(me);
  }, []);

  const logout = useCallback(() => {
    // Revoke the server session (best-effort — local sign-out proceeds regardless).
    apiPost("/api/auth/logout").catch(() => undefined);
    clearToken();
    setPreviewAccount(null);
    setUser(null);
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
    () => ({ user, previewAccount, ready, offline, login, previewLogin, signup, logout, updateUser, changePassword, forgotPassword, resetPassword }),
    [user, previewAccount, ready, offline, login, previewLogin, signup, logout, updateUser, changePassword, forgotPassword, resetPassword],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export { ApiError };
