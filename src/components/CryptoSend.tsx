import { useEffect, useRef, useState, type FormEvent } from "react";
import { useReducedMotion } from "motion/react";
import { Send, Wallet } from "lucide-react";
import { apiGet, apiPost } from "../lib/api";
import type { Holding } from "../lib/holdings";
import { FlowTrack } from "./MoneyFlow";
import { useBankingDialog } from "./bankingDialog";
import "../styles/banking-controls.css";

type Withdrawal = { id: string; asset: string; quantity: string; network: string; address: string; reference: string; status: string; created_at: number };
export function CryptoWithdrawalHistory({ revision, changed }: { revision: number; changed: () => void }) {
  const [rows,setRows] = useState<Withdrawal[]>([]), [error,setError] = useState(""), [busy,setBusy] = useState("");
  const load = async () => { const r=await apiGet<{ withdrawals: Withdrawal[] }>("/api/me/crypto-withdrawals"); setRows(r.withdrawals); };
  useEffect(() => { void load().catch(e => setError(e.message)); },[revision]);
  async function cancel(id: string) { setBusy(id); setError(""); try { await apiPost(`/api/me/crypto-withdrawals/${id}/cancel`); await load(); changed(); } catch(e) { setError(e instanceof Error ? e.message : "Could not cancel."); } finally {setBusy("");} }
  return <section className="crypto-request-history"><h3>Crypto withdrawal requests</h3><p>Pending requests have not been broadcast. Reserved units cannot be sold or sent again. No network fee is collected by this request-only flow.</p>{error && <p role="alert">{error}</p>}{!rows.length && <p>No withdrawal requests.</p>}{rows.map(r => <article key={r.id} className="banking-request"><b>{r.quantity} {r.asset} · {r.status}</b><span>{r.reference} · {r.network}</span><code>{r.address}</code>{r.status === 'pending' && <button className="ghost-btn sm" disabled={!!busy} onClick={() => void cancel(r.id)}>{busy === r.id ? 'Cancelling…' : 'Cancel and release units'}</button>}</article>)}</section>;
}
export function CryptoSendDialog({ holding, close, submitted }: { holding: Holding; close: () => void; submitted: () => void }) {
  const [amount,setAmount] = useState(""), [address,setAddress] = useState(""), [stage,setStage] = useState<'form'|'review'|'processing'|'pending'>('form'), [error,setError] = useState(""), [result,setResult] = useState<Withdrawal | null>(null);
  const key = useRef(crypto.randomUUID()), sent = useRef(false), reduce=useReducedMotion();
  const dialog=useBankingDialog(close,stage === 'processing');
  const network = holding.withdrawalNetwork;
  function review(e: FormEvent) {e.preventDefault();setError("");setStage('review');}
  async function submit() {
    if(sent.current) return; sent.current=true; setStage('processing'); setError("");
    const started=Date.now();
    try {
      const r=await apiPost<{ withdrawal: Withdrawal }>("/api/me/crypto-withdrawals",{asset:holding.asset,network,amount,address,requestKey:key.current});
      await new Promise(resolve => setTimeout(resolve,Math.max(0,(reduce ? 200 : 1800)-(Date.now()-started))));
      setResult(r.withdrawal);setStage('pending');submitted();
    } catch(e) {setError(e instanceof Error ? e.message : 'Request failed.');setStage('review');sent.current=false;}
  }
  return <div className="banking-scrim"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Send ${holding.asset}`} className="banking-panel">
    <h2>{stage === 'pending' ? `Withdrawal ${result?.status ?? 'pending'}` : `Send ${holding.asset}`}</h2>
    {error && <p role="alert" className="banking-error">{error}</p>}
    {stage === 'form' && <form className="dash-form" onSubmit={review}>
      <p>Available: {holding.quantity} {holding.asset}. Requests reserve units; they do not broadcast a blockchain transaction.</p>
      <label>Network<input readOnly value={network ?? 'Not supported'} /></label><p>Use only a destination on {network}. Wrong-network addresses may look valid. No live wallet ownership verification is performed.</p>
      <label>Destination wallet address<input required maxLength={120} autoComplete="off" value={address} onChange={e => {setAddress(e.target.value.trim());key.current=crypto.randomUUID();}} /></label>
      <label>Quantity ({holding.asset})<input required inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" value={amount} onChange={e => {setAmount(e.target.value);key.current=crypto.randomUUID();}} /></label>
      <button type="button" className="ghost-btn" onClick={() => {setAmount(holding.quantity);key.current=crypto.randomUUID();}}>Use available amount</button>
      <button className="solid-btn" disabled={!network}>Review withdrawal</button>
    </form>}
    {stage === 'review' && <><div className="funding-instructions"><h3>Review before submitting</h3><p>{amount} {holding.asset} · {network}</p><code>{address}</code><p>Network fee: not quoted. No fee is charged now. This request remains pending until a real custody/broadcast service is integrated; you can cancel it to release reserved units.</p></div><div className="modal-actions"><button className="ghost-btn" onClick={() => setStage('form')}>Edit</button><button className="solid-btn" onClick={() => void submit()}>Confirm pending withdrawal</button></div></>}
    {stage === 'processing' && <div className="flow-processing" role="status"><span className="flow-orbit"><i /><Send size={22} /></span><h3>Submitting withdrawal request…</h3><FlowTrack from={{label:'Your holdings',sub:`${amount} ${holding.asset}`,icon:<Wallet />}} to={{label:'External wallet',sub:network ?? '',icon:<Send />}} state="moving" progress={.65} /><p>Waiting for the server to reserve units and record the request. This animation is not a blockchain confirmation.</p></div>}
    {stage === 'pending' && <div role="status" className="funding-instructions"><h3>{result?.status === 'cancelled' ? 'Previously cancelled request' : 'Pending · not broadcast'}</h3><p>{result?.quantity} {result?.asset}</p><p>Reference: {result?.reference}</p><code>{result?.address}</code><p>No transaction hash or blockchain confirmation exists for this request. Check withdrawal history to cancel and release reserved units.</p></div>}
    <button type="button" className="ghost-btn" disabled={stage === 'processing'} onClick={close}>Close</button>
  </section></div>;
}
