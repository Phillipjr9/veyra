import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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

type StoredUser = User & { hash: string };

const USERS_KEY = "veyra.users";
const SESSION_KEY = "veyra.session";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/** Non-reversible digest so raw passwords are never persisted in localStorage. */
export async function digest(password: string, salt = "veyra"): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 5381;
  for (const byte of data) h = ((h << 5) + h + byte) >>> 0;
  return h.toString(16);
}

export function getUsers(): StoredUser[] {
  return read<Array<Partial<StoredUser> & { hash?: string }>>(USERS_KEY, []).flatMap(raw => {
    if (!raw.id || !raw.email || !raw.hash) return [];
    return [{
      id: raw.id,
      name: raw.name?.trim() || "Veyra member",
      phone: raw.phone?.trim() || "",
      business: raw.business?.trim() || "",
      accountType: raw.accountType === "personal" ? "personal" : "business",
      email: raw.email,
      avatarUrl: raw.avatarUrl || "/images/avatar-3d-default.svg",
      role: (raw.role === "superadmin" || raw.email === "admin@veyra.com") ? "superadmin"
        : raw.role === "admin" || raw.role === "compliance" || raw.role === "support" ? raw.role
        : "user",
      plan: raw.plan === "Starter" ? "Starter" : "Pro",
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
      hash: raw.hash,
    }];
  });
}

/**
 * Grants or revokes staff access on an existing user (no second account
 * system). The acting admin's id is required so nobody can change their own
 * role, and the master superadmin account can never be demoted.
 */
export function setUserRole(targetUserId: string, role: UserRole, actorId: string): void {
  if (targetUserId === actorId) throw new Error("You cannot change your own role.");
  const users = getUsers();
  const target = users.find(u => u.id === targetUserId);
  if (!target) throw new Error("That member no longer exists.");
  if (target.role === "superadmin" && role !== "superadmin") throw new Error("A Super Admin cannot be demoted from here.");
  const next = users.map(u => (u.id === targetUserId ? { ...u, role } : u));
  write(USERS_KEY, next);
}

/** Seeds a demo login so the product can be explored without signing up. */
export async function ensureDemoUser() {
  const users = getUsers();
  if (!users.some(u => u.email === "demo@veyra.com")) users.push({
    id: "demo", name: "Hana Park", phone: "+1 (555) 389-2041", business: "Park & Co Studio", accountType: "business", email: "demo@veyra.com", role: "user",
    avatarUrl: "/images/avatar-3d-default.svg",
    plan: "Pro", createdAt: Date.now(), hash: await digest("veyra123"),
  });
  if (!users.some(u => u.email === "personal@veyra.com")) users.push({
    id: "personal-demo", name: "Alex Morgan", phone: "+1 (555) 714-8920", business: "", accountType: "personal", email: "personal@veyra.com", role: "user",
    avatarUrl: "/images/avatar-3d-default.svg",
    plan: "Pro", createdAt: Date.now(), hash: await digest("veyra123"),
  });
  if (!users.some(u => u.email === "admin@veyra.com")) users.push({
    id: "superadmin-master", name: "Chief System Admin", phone: "+1 (800) 555-0199", business: "Veyra Financial HQ", accountType: "business", email: "admin@veyra.com", role: "superadmin",
    avatarUrl: "/images/avatar-3d-default.svg",
    plan: "Pro", createdAt: Date.now(), hash: await digest("admin123"),
  });
  if (!users.some(u => u.email === "compliance@veyra.com")) users.push({
    id: "compliance", name: "Mira Osei", phone: "+1 (555) 204-7781", business: "Veyra Financial HQ", accountType: "business", email: "compliance@veyra.com", role: "compliance",
    avatarUrl: "/images/avatar-3d-default.svg",
    plan: "Pro", createdAt: Date.now(), hash: await digest("veyra123"),
  });
  if (!users.some(u => u.email === "support@veyra.com")) users.push({
    id: "support-desk", name: "Theo Park", phone: "+1 (555) 204-7782", business: "Veyra Financial HQ", accountType: "business", email: "support@veyra.com", role: "support",
    avatarUrl: "/images/avatar-3d-default.svg",
    plan: "Pro", createdAt: Date.now(), hash: await digest("veyra123"),
  });
  write(USERS_KEY, users);
}

type AuthValue = {
  user: User | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (accountType?: User["accountType"]) => Promise<void>;
  loginWithPasskey: (emailHint?: string) => Promise<void>;
  signup: (input: { name: string; phone?: string; business?: string; accountType: User["accountType"]; email: string; password: string; plan?: User["plan"] }) => Promise<void>;
  logout: () => void;
  updateUser: (patch: Partial<Pick<User, "name" | "phone" | "business" | "accountType" | "email" | "plan" | "role" | "avatarUrl">>) => void;
  changePassword: (current: string, next: string) => Promise<void>;
  resetPassword: (email: string) => Promise<string>;
};

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      await ensureDemoUser();
      const id = read<string | null>(SESSION_KEY, null);
      if (id) {
        const found = getUsers().find(u => u.id === id);
        if (found) { const { hash: _hash, ...safe } = found; setUser(safe); }
      }
      setReady(true);
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const users = getUsers();
    const found = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!found) throw new Error("We couldn't find an account with that email.");
    if (found.hash !== await digest(password)) throw new Error("That password doesn't match our records.");
    const { hash: _hash, ...safe } = found;
    write(SESSION_KEY, found.id);
    setUser(safe);
  }, []);

  const loginWithGoogle = useCallback(async (accountType: User["accountType"] = "personal") => {
    // Authenticate with Google OAuth identity simulation
    await new Promise(r => setTimeout(r, 650));
    const users = getUsers();
    const googleEmail = "alex.google@example.com";
    let found = users.find(u => u.email.toLowerCase() === googleEmail);
    if (!found) {
      found = {
        id: `u_google_${Date.now().toString(36)}`,
        name: "Alex Rivera",
        phone: "+1 (555) 492-8819",
        business: accountType === "business" ? "Rivera Creative Labs" : "",
        accountType,
        email: googleEmail,
        role: "user",
        plan: "Pro",
        createdAt: Date.now(),
        hash: await digest("google-oauth-verified"),
      };
      users.push(found);
      write(USERS_KEY, users);
    }
    write(SESSION_KEY, found.id);
    const { hash: _hash, ...safe } = found;
    setUser(safe);
  }, []);

  const loginWithPasskey = useCallback(async (emailHint?: string) => {
    // FIDO2 / WebAuthn passkey bio authentication simulation
    await new Promise(r => setTimeout(r, 800));
    const users = getUsers();
    // Match hinted user or default to demo account
    const target = emailHint
      ? users.find(u => u.email.toLowerCase() === emailHint.trim().toLowerCase())
      : users.find(u => u.email === "personal@veyra.com") || users[0];
    if (!target) throw new Error("No passkey enrolled on this biometric device.");
    write(SESSION_KEY, target.id);
    const { hash: _hash, ...safe } = target;
    setUser(safe);
  }, []);

  const signup = useCallback<AuthValue["signup"]>(async ({ name, phone = "", business = "", accountType, email, password, plan = "Pro" }) => {
    const users = getUsers();
    if (users.some(u => u.email.toLowerCase() === email.trim().toLowerCase()))
      throw new Error("An account already uses that email. Try signing in.");
    const role: UserRole = email.trim().toLowerCase() === "admin@veyra.com" ? "superadmin" : "user";
    const record: StoredUser = {
      id: `u_${Date.now().toString(36)}`,
      name: name.trim(),
      phone: phone.trim(),
      business: accountType === "business" ? business.trim() : "",
      accountType,
      email: email.trim(),
      role,
      plan,
      createdAt: Date.now(),
      hash: await digest(password),
    };
    users.push(record);
    write(USERS_KEY, users);
    write(SESSION_KEY, record.id);
    const { hash: _hash, ...safe } = record;
    setUser(safe);
  }, []);

  const logout = useCallback(() => {
    try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setUser(null);
  }, []);

  const updateUser = useCallback<AuthValue["updateUser"]>(patch => {
    setUser(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      const users = getUsers().map(u => (u.id === prev.id ? { ...u, ...patch } : u));
      write(USERS_KEY, users);
      return next;
    });
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    if (!user) throw new Error("You need to be signed in.");
    const users = getUsers();
    const found = users.find(u => u.id === user.id);
    if (!found) throw new Error("Account not found.");
    if (found.hash !== await digest(current)) throw new Error("Your current password is incorrect.");
    if (next.length < 8) throw new Error("Use at least 8 characters.");
    found.hash = await digest(next);
    write(USERS_KEY, users);
  }, [user]);

  const resetPassword = useCallback(async (email: string) => {
    const users = getUsers();
    const found = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!found) throw new Error("We couldn't find an account with that email.");
    const temp = `veyra-${Math.random().toString(36).slice(2, 8)}`;
    found.hash = await digest(temp);
    write(USERS_KEY, users);
    return temp;
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, loginWithGoogle, loginWithPasskey, signup, logout, updateUser, changePassword, resetPassword }),
    [user, ready, login, loginWithGoogle, loginWithPasskey, signup, logout, updateUser, changePassword, resetPassword]
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
