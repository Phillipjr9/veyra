import { useEffect, useState } from "react";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import {
  listPasskeys, createPasskey, deletePasskey, passkeySupported, passkeyRegistrationAvailable,
  suggestPasskeyLabel, passkeyErrorMessage, isPasskeyCancellation, type Passkey,
} from "../lib/passkey";
import { useToast } from "./Toast";

function when(ts: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(ts));
}

/**
 * Passkey management, as one panel of the Security Center.
 *
 * A passkey is the only credential on the account that cannot be phished,
 * guessed or reused, so this is where a member is nudged towards one. The
 * panel only lists, adds and removes; the ceremony itself lives in
 * src/lib/passkey.ts and the server-side verification in server/src/webauthn.ts.
 */
export function PasskeysPanel() {
  const toast = useToast();
  const [keys, setKeys] = useState<Passkey[] | null>(null);
  const [canAdd, setCanAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState("");

  useEffect(() => {
    let live = true;
    void listPasskeys()
      .then(result => { if (live) setKeys(result.passkeys); })
      .catch(() => { if (live) setKeys([]); });
    void passkeyRegistrationAvailable().then(available => { if (live) setCanAdd(available); });
    return () => { live = false; };
  }, []);

  const add = async () => {
    setAdding(true);
    try {
      const created = await createPasskey(suggestPasskeyLabel());
      setKeys(current => [created, ...(current ?? [])]);
      toast({ tone: "success", title: `${created.label} added`, description: "You can now sign in without your password." });
    } catch (err) {
      // Backing out of the OS prompt is a decision, not an error.
      if (isPasskeyCancellation(err)) return;
      toast({ tone: "info", title: "Couldn't add that passkey", description: passkeyErrorMessage(err) });
    } finally {
      setAdding(false);
    }
  };

  const remove = async (key: Passkey) => {
    setRemoving(key.id);
    try {
      await deletePasskey(key.id);
      setKeys(current => (current ?? []).filter(k => k.id !== key.id));
      toast({ tone: "info", title: `${key.label} removed` });
    } catch (err) {
      toast({ tone: "info", title: "Couldn't remove that passkey", description: (err as Error).message });
    } finally {
      setRemoving("");
    }
  };

  const supported = passkeySupported();
  return (
    <section className="security-panel security-passkeys-panel">
      <div className="security-panel-heading security-sessions-heading">
        <span className="security-panel-icon"><KeyRound size={18} /></span>
        <div><h2>Passkeys</h2><p>Sign in with your fingerprint, face or device PIN.</p></div>
        {supported && canAdd && (
          <button type="button" className="security-secondary-button" onClick={() => void add()} disabled={adding}>
            {adding ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            {adding ? "Waiting for your device…" : "Add passkey"}
          </button>
        )}
      </div>

      {!supported ? (
        <p className="security-empty-state">This browser doesn't support passkeys. Your password still works everywhere.</p>
      ) : keys === null ? (
        <p className="security-empty-state">Loading…</p>
      ) : keys.length === 0 ? (
        <p className="security-empty-state">
          No passkeys yet. A passkey replaces your password with the lock you already use on this device —
          and unlike a password it can't be phished, guessed, or reused anywhere else.
          {!canAdd && " This device has no fingerprint, face or PIN set up, so add one from a phone or laptop that does."}
        </p>
      ) : (
        <div className="security-session-list">
          {keys.map(key => (
            <article className="security-session-row" key={key.id}>
              <span className="security-device-icon"><KeyRound size={19} /></span>
              <div className="security-session-info">
                <strong>
                  {key.label}
                  {key.syncedToCloud && <span className="security-current-badge">Synced</span>}
                </strong>
                <small>
                  Added {when(key.createdAt)}
                  {key.lastUsedAt ? ` · last used ${when(key.lastUsedAt)}` : " · never used"}
                </small>
              </div>
              <div className="security-session-actions">
                <button type="button" className="security-revoke-button" onClick={() => void remove(key)} disabled={removing === key.id}>
                  {removing === key.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="security-footnote">A passkey signs you in on its own. Two-step sign-in above applies to password sign-ins.</p>
    </section>
  );
}
