import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { LayoutGroup, MotionConfig, motion, useReducedMotion } from "motion/react";
import { Check, Download, Wallet, X } from "lucide-react";
import { apiGet, apiPost } from "../lib/api";
import { assetIcon, type Holding } from "../lib/holdings";
import { downloadFile, longDate } from "../lib/store";
import { FlowProcessing, FlowTrack, StageDots } from "./MoneyFlow";
import { useBankingDialog } from "./bankingDialog";
import "../styles/banking-controls.css";
import "../styles/crypto-send.css";

type Withdrawal = { id: string; asset: string; quantity: string; network: string; address: string; reference: string; status: string; created_at: number };
export function CryptoWithdrawalHistory({ revision }: { revision: number }) {
  const [rows,setRows] = useState<Withdrawal[]>([]), [error,setError] = useState(""), [loading,setLoading] = useState(true);
  const load = async () => { setLoading(true); try { const r=await apiGet<{ withdrawals: Withdrawal[] }>("/api/me/crypto-withdrawals"); setRows(r.withdrawals); setError(""); } finally { setLoading(false); } };
  useEffect(() => { void load().catch(e => setError(e.message)); },[revision]);
  return <section className="crypto-request-history"><h3>Crypto withdrawal requests</h3><p>Requests are recorded and the units leave your holdings immediately. Nothing is broadcast on-chain, and no network fee is collected by this flow.</p>{error && <p role="alert">{error}</p>}{loading && <p role="status">Loading withdrawal requests…</p>}{!rows.length && !loading && !error && <p>No withdrawal requests.</p>}{error && <button className="ghost-btn sm" disabled={loading} onClick={() => void load().catch(e => setError(e.message))}>Retry withdrawal history</button>}{rows.map(r => <article key={r.id} className="banking-request"><b>{r.quantity} {r.asset} · {r.status}</b><span>{r.reference} · {r.network}</span><code>{r.address}</code></article>)}</section>;
}
// Presentation steps, not fabricated custody/signing/broadcast progress.
const REQUEST_STEPS = ["Preparing withdrawal details", "Displaying network and destination", "Preparing the request summary", "Preparing your request receipt"];

/**
 * A struck coin pays out: discs that tumble in three dimensions and arcing
 * shards, rather than the flat rectangles the fiat transfer uses. Pieces are
 * generated once per asset so a re-render never restarts the burst.
 */
function CoinBurst({ asset }: { asset: string }) {
  const reduce = useReducedMotion();
  const pieces = useMemo(() => Array.from({ length: 22 }, (_, i) => {
    const angle = (i / 22) * Math.PI * 2 + (i % 3) * 0.22;
    const dist = 74 + ((i * 41) % 62);
    return {
      id: i,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist * 0.6 - 36,
      size: 10 + ((i * 13) % 10),
      spin: 240 + ((i * 107) % 420),
      tilt: (i % 2 ? 1 : -1) * (150 + ((i * 61) % 240)),
      delay: (i % 6) * 0.05,
      coin: i % 3 !== 2,
      logo: i % 6 === 0,
    };
  }), [asset]);
  if (reduce) return null;
  return <div className="crypto-send-burst" aria-hidden="true">{pieces.map(p => <motion.span key={p.id} className={p.coin ? "burst-coin" : "burst-shard"}
    style={{ width: p.size, height: p.coin ? p.size : p.size * 0.38 }}
    initial={{ x: 0, y: 0, scale: 0.3, opacity: 0, rotateX: 0, rotateY: 0 }}
    animate={{ x: [0, p.x, p.x * 1.14], y: [0, p.y, p.y + 128], scale: [0.3, 1, 0.82], opacity: [0, 1, 0], rotateX: [0, p.tilt, p.tilt * 1.5], rotateY: [0, p.spin, p.spin * 1.7] }}
    transition={{ duration: 1.75, delay: 0.22 + p.delay, times: [0, 0.38, 1], ease: "easeOut" }}
  >{p.logo && <img src={assetIcon(asset)} alt="" />}</motion.span>)}</div>;
}

export function CryptoSendDialog({ holding, close, submitted }: { holding: Holding; close: () => void; submitted: () => void | Promise<void> }) {
  const [amount, setAmount] = useState(""), [address, setAddress] = useState("");
  const [stage, setStage] = useState<'form' | 'review' | 'processing' | 'recorded'>('form');
  const [error, setError] = useState(""), [result, setResult] = useState<Withdrawal | null>(null);
  const key = useRef(crypto.randomUUID()), sent = useRef(false), live = useRef(true);
  const presentation = useRef<(() => void) | null>(null);
  const reduce = useReducedMotion() !== false;
  const layoutId = useId();
  const dialog = useBankingDialog(close, stage === 'processing');
  const network = holding.withdrawalNetwork;
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; presentation.current?.(); presentation.current = null; };
  }, []);
  useEffect(() => {
    dialog.current?.querySelector('.flow-body')?.scrollTo({ top: 0 });
    dialog.current?.focus({ preventScroll: true });
  }, [stage, dialog]);
  function review(e: FormEvent) { e.preventDefault(); if (!network) return; setError(""); setStage('review'); }
  async function submit() {
    if (sent.current || !network || stage !== 'review') return;
    sent.current = true;
    let finish!: () => void;
    const shown = new Promise<void>(resolve => { finish = resolve; });
    presentation.current = finish;
    setStage('processing'); setError("");
    try {
      // Debit immediately. Only the presentation waits; timers cannot create
      // a receipt without the actual server response. Quantities stay strings.
      const r = await apiPost<{ withdrawal: Withdrawal }>("/api/me/crypto-withdrawals", { asset: holding.asset, network, amount, address, requestKey: key.current });
      await shown;
      if (!live.current) return;
      setResult(r.withdrawal); setStage('recorded');
      // A refresh failure must never unlock a second withdrawal submission.
      try { await submitted(); } catch {
        if (live.current) setError("Request recorded. Refresh your holdings to see the remaining units; do not submit it again.");
      }
    } catch (e) {
      if (live.current) { setError(e instanceof Error ? e.message : 'Request failed.'); setStage('review'); sent.current = false; }
    } finally {
      finish();
      if (presentation.current === finish) presentation.current = null;
    }
  }
  const track = {
    from: { label: 'Your holdings', sub: holding.asset, icon: <img src={assetIcon(holding.asset)} alt="" /> },
    to: { label: 'Destination wallet', sub: network ?? 'Not supported', icon: <Wallet size={21} /> },
  };
  const cancelled = result?.status === 'cancelled';
  const download = () => {
    if (!result) return;
    downloadFile(`veyra-withdrawal-request-${result.reference}.txt`, [
      'VEYRA — CRYPTO WITHDRAWAL REQUEST', `Reference: ${result.reference}`, `Date: ${longDate(result.created_at)}`,
      `Quantity: ${result.quantity} ${result.asset}`, `Network: ${result.network}`, `Destination: ${result.address}`,
      `Status: ${result.status === 'recorded' ? 'Sent' : result.status}`,
      'Settled in your Veyra account record. No blockchain transaction hash or confirmation exists.',
      'No network fee collected. External custody and on-chain execution are not connected.',
    ].join('\n'));
  };
  return <MotionConfig reducedMotion={reduce ? 'always' : 'never'}><LayoutGroup id={layoutId}>
    <div className="flow-scrim crypto-send-scrim"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Send ${holding.asset}`} className="flow-modal crypto-send-flow" data-motion={reduce ? 'reduced' : 'full'}>
        <div className="flow-head"><StageDots kind="deposit" stage={stage === 'recorded' ? 'success' : stage} completionLabel="Recorded" />
        <button type="button" className="flow-close" aria-label="Close" disabled={stage === 'processing'} onClick={close}><X size={16} /></button>
      </div>
      <div className="flow-body">
        <div className="crypto-send-context"><span><img src={assetIcon(holding.asset)} alt="" /> {holding.asset}</span><span className="crypto-send-network">{network ?? 'Not supported'}</span></div>
        {error && <p role="alert" className="banking-error">{error}</p>}
        {stage === 'form' && <form className="dash-form crypto-send-details" onSubmit={review}>
          <h2 className="flow-title">Send {holding.asset}</h2>
          <p className="flow-sub">Available: {holding.quantity} {holding.asset}. Requests debit the units immediately; they do not broadcast a blockchain transaction.</p>
          <label>Network<input readOnly value={network ?? 'Not supported'} /></label>
          <p className="crypto-send-note">Use only a destination on {network ?? 'a supported network'}. Wrong-network addresses may look valid. No live wallet ownership verification is performed.</p>
          <label>Destination wallet address<input required maxLength={120} autoComplete="off" spellCheck={false} value={address} onChange={e => { setAddress(e.target.value.trim()); key.current = crypto.randomUUID(); }} /></label>
          <label>Quantity ({holding.asset})<input required inputMode="decimal" pattern="[0-9]+(\.[0-9]+)?" value={amount} onChange={e => { setAmount(e.target.value); key.current = crypto.randomUUID(); }} /></label>
          <button type="button" className="ghost-btn sm" onClick={() => { setAmount(holding.quantity); key.current = crypto.randomUUID(); }}>Use available amount</button>
          <div className="flow-actions"><button type="button" className="ghost-btn" onClick={close}>Cancel</button><button className="solid-btn" disabled={!network}>Review withdrawal</button></div>
        </form>}
        {stage === 'review' && <div className="flow-pane">
          <h2 className="flow-title">Review withdrawal</h2><p className="flow-sub">Check the network, quantity and full destination.</p>
          <strong className="crypto-send-quantity">{amount} <small>{holding.asset}</small></strong>
          <FlowTrack {...track} state="idle" progress={0} />
          <div className="crypto-send-destination"><span>Destination wallet address</span><code>{address}</code></div>
          <div className="flow-rows"><div className="flow-row"><span>Network</span><b>{network}</b></div><div className="flow-row"><span>Network fee</span><b>Not quoted · none charged now</b></div></div>
          <p className="crypto-send-note">This records your request and debits the units immediately. No custody or broadcast service is connected, so the request cannot be cancelled afterwards.</p>
          <div className="flow-actions"><button className="ghost-btn" onClick={() => setStage('form')}>Edit</button><button className="solid-btn flow-confirm" onClick={() => void submit()}>Confirm withdrawal</button></div>
        </div>}
        {stage === 'processing' && <motion.div className="crypto-send-processing" role="status" initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <FlowProcessing title="Submitting withdrawal request…" amount={`${amount} ${holding.asset}`} steps={REQUEST_STEPS} track={track}
            centerIcon={<motion.img layoutId="crypto-send-hero" src={assetIcon(holding.asset)} alt="" transition={{ type: 'spring', stiffness: 230, damping: 27 }} />}
            movingIcon={<img src={assetIcon(holding.asset)} alt="" />} showProgressRing minimumStepMs={600} awaitingConfirmation waitingTitle="Waiting for request confirmation…"
            note="Waiting for the server to debit the units and record the request. This animation is not a blockchain confirmation."
            onDone={() => presentation.current?.()} />
          <div className="crypto-send-destination"><span>Requested destination</span><code>{address}</code></div>
        </motion.div>}
        {stage === 'recorded' && result && <motion.div className="crypto-send-recorded" initial={reduce ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .35 }}>
          <CoinBurst asset={result.asset} />
          <div role="status">
            <div className="crypto-send-recorded-mark" aria-hidden="true">
              <motion.span className="coin-face" initial={reduce ? false : { rotateY: -200, scale: .72 }} animate={{ rotateY: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 110, damping: 13 }} />
              <motion.span className="coin-ring" initial={reduce ? false : { scale: .78, opacity: .6 }} animate={{ scale: 1.85, opacity: 0 }} transition={{ duration: 1.25, delay: .22, ease: 'easeOut' }} />
              <motion.span className="coin-ring" initial={reduce ? false : { scale: .78, opacity: .45 }} animate={{ scale: 1.5, opacity: 0 }} transition={{ duration: 1.1, delay: .5, ease: 'easeOut' }} />
              <motion.img layoutId="crypto-send-hero" src={assetIcon(result.asset)} alt="" transition={{ type: 'spring', stiffness: 230, damping: 27 }} />
              <motion.span className="coin-sheen" initial={reduce ? false : { x: '-130%' }} animate={{ x: '130%' }} transition={{ duration: .95, delay: .34, ease: 'easeInOut' }} />
              <motion.span className="coin-check" initial={reduce ? false : { scale: .6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20, delay: .2 }}><Check size={19} /></motion.span>
            </div>
            <span className="crypto-send-eyebrow">WITHDRAWAL SENT</span>
            <h2 className="flow-title">{cancelled ? 'Previously cancelled request' : 'Send complete'}</h2>
            <strong className="crypto-send-quantity">{result.quantity} <small>{result.asset}</small></strong>
            <p className="flow-sub">{cancelled ? 'This request is cancelled. It has not been submitted again.' : `${result.quantity} ${result.asset} has been sent from your Veyra holdings.`}</p>
          </div>
          <div className="receipt">
            {[['Reference', result.reference], ['Network', result.network], ['Status', 'Sent'], ['Network fee', 'None collected']].map(([label, value], i) => <motion.div key={label} className="receipt-row" initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * .065 }}><span>{label}</span><b>{value}</b></motion.div>)}
          </div>
          <div className="crypto-send-destination"><span>Destination wallet address</span><code>{result.address}</code></div>
          <p className="crypto-send-note">Completed in your Veyra account record. External custody and on-chain execution are not connected, so no network fee or transaction hash is involved.</p>
          <div className="flow-actions"><button type="button" className="ghost-btn" onClick={download}><Download size={15} /> Send receipt</button><button type="button" className="solid-btn" onClick={close}>Done</button></div>
        </motion.div>}
      </div>
    </section></div>
  </LayoutGroup></MotionConfig>;
}
