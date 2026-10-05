import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet, apiPost, apiPatch, probeApi, getToken, setToken, clearToken, onUnauthorized, ApiError } from "./api";
import { recaptchaField } from "./recaptcha";
import { federatedIdToken, type ProviderId } from "./federated";
import { signInWithPasskey } from "./passkey";

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
  /**
   * Federated sign-in (Google / Apple / Microsoft). Firebase proves identity;
   * the server decides whether that identity may open an existing account
   * (see server/src/federated.ts) and mints the Veyra session the app runs on.
   */
  loginWithProvider: (provider: ProviderId) => Promise<User>;
  /**
   * Passkey sign-in. No email is collected: the credential is discoverable,
   * so the browser shows the member whichever passkeys it holds for this site
   * and the server identifies them from the signed credential id.
   */
  loginWithPasskey: () => Promise<User>;
  /** `profile` carries the full account application (see server/src/identity.ts). */
  signup: (input: {
    name: string; phone?: string; business?: string; accountType: User["accountType"];
    email: string; password: string; plan?: User["plan"]; profile?: Record<string, unknown>;
  }) => Promise<void>;

  logout: () => void;
  updateUser: (patch: Partial<Pick<User, "name" | "phone" | "business" | "accountType" | "email" | "plan" | "role" | "avatarUrl">>) => void;
  changePassword: (current: string, next: string) => Promise<void>;
  /** Step 1 of password recovery — always resolves with a generic response. */
  /**
   * Step 1 — requests a reset. Resolves with a `devCode` when the server is
   * running outside production and no mail provider is configured (see
   * TODO(send-email) in server/src/app.ts): without it the reset screen would
   * ask for a code that only exists in the server log.
   */
  forgotPassword: (email: string) => Promise<{ devCode?: string }>;
  /** Step 2 — completes the reset with the token from the email. */
  resetPassword: (token: string, password: string) => Promise<void>;
};

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Keep the active credential in React state as well as the API module. Vite
  // can hot-reload that module while preserving this provider and user state;
  // without this bridge the UI could still look authenticated while the next
  // protected request was sent without its bearer credential.
  const [activeToken, setActiveToken] = useState<string | null>(() => getToken());
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [sessionNotice, setSessionNotice] = useState("");
  const [sessionDetail, setSessionDetail] = useState("");

  useEffect(() => {
    if (activeToken && getToken() !== activeToken) setToken(activeToken);
  }, [activeToken]);

  useEffect(() => {
    (async () => {
      const online = await probeApi();
      setOffline(!online);
      if (online) {
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
    // A fresh reCAPTCHA token per attempt — they are single-use and expire in
    // about two minutes, so one is never reused across submissions. Resolves
    // to {} when the gate is off or Google is unreachable; the server decides.
    const { token, user: me } = await apiPost<{ token: string; user: User }> ("/api/auth/login", { email: email.trim(), password, ...(await recaptchaField("login")) });
    setToken(token);
    setActiveToken(token);
    setUser(me);
    return me;
  }, []);

  const loginWithProvider = useCallback(async (provider: ProviderId): Promise<User> => {
    // Same reasoning as login(): a leftover token must not ride along, or a
    // rejection would be reported as "your session ended" instead of the real
    // cause (no Veyra account for that address, staff account, and so on).
    clearToken();
    if (!(await probeApi(true))) throw new Error("Cannot reach the Veyra server. Check your connection and try again.");
    const { idToken } = await federatedIdToken(provider);
    const { token, user: me } = await apiPost<{ token: string; user: User; linked: boolean }>("/api/auth/federated", { idToken });
    setToken(token);
    setActiveToken(token);
    setUser(me);
    setSessionNotice("");
    return me;
  }, []);

  const loginWithPasskey = useCallback(async (): Promise<User> => {
    // As in login(): a stale token must not ride along, or a refusal would be
    // reported as "your session ended" rather than the real reason.
    clearToken();
    if (!(await probeApi(true))) throw new Error("Cannot reach the Veyra server. Check your connection and try again.");
    const { token, user: me } = await signInWithPasskey() as { token: string; user: User };
    setToken(token);
    setActiveToken(token);
    setUser(me);
    setSessionNotice("");
    return me;
  }, []);

  const signup = useCallback<AuthValue["signup"]>(async ({ name, phone = "", business = "", accountType, email, password, plan = "Pro", profile }) => {
    if (!(await probeApi(true))) throw new Error("Cannot reach the Veyra server. Check your connection and try again.");
    const { token, user: me } = await apiPost<{ token: string; user: User }>("/api/auth/register", {
      name: name.trim(), phone: phone.trim(), business: accountType === "business" ? business.trim() : "",
      accountType, email: email.trim(), password, plan, profile,
      ...(await recaptchaField("register")),
    });
    setToken(token);
    setActiveToken(token);
    setUser(me);
    setSessionNotice("");
  }, []);

  const logout = useCallback(() => {
    // Revoke the server session (best-effort — local sign-out proceeds regardless).
    apiPost("/api/auth/logout").catch(() => undefined);
    clearToken();
    setActiveToken(null);
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
    const res = await apiPost<{ devCode?: string }>("/api/auth/forgot-password", { email: email.trim(), ...(await recaptchaField("forgotPassword")) });
    return res && typeof res.devCode === "string" ? { devCode: res.devCode } : {};
  }, []);

  const resetPassword = useCallback(async (token: string, password: string) => {
    await apiPost("/api/auth/reset-password", { token: token.trim(), password });
  }, []);

  const value = useMemo(
    () => ({ user, ready, offline, sessionNotice, sessionDetail, dismissSessionNotice, resetSession, login, loginWithProvider, loginWithPasskey, signup, logout, updateUser, changePassword, forgotPassword, resetPassword }),
    [user, ready, offline, sessionNotice, sessionDetail, dismissSessionNotice, resetSession, login, loginWithProvider, loginWithPasskey, signup, logout, updateUser, changePassword, forgotPassword, resetPassword],

  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export { ApiError };
