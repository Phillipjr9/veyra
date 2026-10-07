import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { LayoutGroup, MotionConfig, motion, useReducedMotion } from "motion/react";
import { Check, Copy, Download, Wallet, X } from "lucide-react";
import { apiGet, apiPost } from "../lib/api";
import { assetIcon, type Holding } from "../lib/holdings";
import { downloadFile } from "../lib/store";
import { useAuth } from "../lib/auth";
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

const COIN_RADIUS = 46;
const COIN_THICKNESS = 14;
const COIN_SEGMENTS = 32;

/**
 * A real coin, not a flat disc: the rim is built from segments laid around a
 * cylinder, so the piece has genuine thickness and a milled edge that reads
 * as it turns. The front face carries no 3D transform of its own, which keeps
 * the shared-element flight of the asset logo undistorted; the rim and the
 * reverse are pushed back behind it instead.
 */
function Coin3D({ asset, reduce }: { asset: string; reduce: boolean }) {
  const segW = (2 * Math.PI * COIN_RADIUS) / COIN_SEGMENTS;
  const shell = { "--segw": `${segW}px`, "--thick": `${COIN_THICKNESS}px` } as CSSProperties;
  return <motion.div className="coin3d" style={shell}
    initial={reduce ? false : { y: -24, scale: .9 }}
    animate={reduce ? { y: 0, scale: 1 } : { y: 0, scale: 1, rotateY: [0, 1080] }}
    transition={reduce ? { duration: 0 } : {
      y: { type: 'spring', stiffness: 130, damping: 13 },
      scale: { type: 'spring', stiffness: 130, damping: 13 },
      // Three full turns after the coin has landed, then it rests face on.
      rotateY: { duration: 2.1, delay: .32, ease: [0.16, 1, 0.3, 1] },
    }}>
    <span className="coin3d-rim">{Array.from({ length: COIN_SEGMENTS }, (_, i) =>
      <i key={i} className={i % 2 ? 'reed-dark' : 'reed-light'} style={{ transform: `rotateY(${(360 / COIN_SEGMENTS) * i}deg) translateZ(${COIN_RADIUS}px)` }} />)}</span>
    <span className="coin3d-face coin3d-front"><motion.img layoutId="crypto-send-hero" src={assetIcon(asset)} alt="" transition={{ type: 'spring', stiffness: 230, damping: 27 }} /></span>
    <span className="coin3d-face coin3d-back" aria-hidden="true" />
  </motion.div>;
}

/**
 * Coins and shards tumbling on X and Y under perspective, with the further
 * pieces blurred and shrunk for depth. The fiat transfer throws flat
 * rectangles on a single axis; this is deliberately heavier than that.
 */
function CoinBurst({ asset }: { asset: string }) {
  const reduce = useReducedMotion();
  const pieces = useMemo(() => Array.from({ length: 30 }, (_, i) => {
    const angle = (i / 30) * Math.PI * 2 + (i % 4) * 0.2;
    const dist = 80 + ((i * 37) % 76);
    const depth = (i % 5) / 4;
    return {
      id: i,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist * 0.6 - 40,
      size: (9 + ((i * 11) % 13)) * (1 - depth * 0.3),
      spin: 260 + ((i * 113) % 460),
      tilt: (i % 2 ? 1 : -1) * (160 + ((i * 67) % 260)),
      delay: (i % 7) * 0.045,
      coin: i % 4 !== 3,
      logo: i % 7 === 0,
      blur: depth > 0.6 ? 1.1 : 0,
    };
  }), [asset]);
  if (reduce) return null;
  return <div className="crypto-send-burst" aria-hidden="true">{pieces.map(p => <motion.span key={p.id} className={p.coin ? "burst-coin" : "burst-shard"}
    style={{ width: p.size, height: p.coin ? p.size : p.size * 0.38, filter: p.blur ? `blur(${p.blur}px)` : undefined }}
    initial={{ x: 0, y: 0, scale: 0.3, opacity: 0, rotateX: 0, rotateY: 0 }}
    animate={{ x: [0, p.x, p.x * 1.14], y: [0, p.y, p.y + 132], scale: [0.3, 1, 0.82], opacity: [0, 1, 0], rotateX: [0, p.tilt, p.tilt * 1.5], rotateY: [0, p.spin, p.spin * 1.7] }}
    transition={{ duration: 1.85, delay: 0.22 + p.delay, times: [0, 0.38, 1], ease: "easeOut" }}
  >{p.logo && <img src={assetIcon(asset)} alt="" />}</motion.span>)}</div>;
}

export function CryptoSendDialog({ holding, close, submitted }: { holding: Holding; close: () => void; submitted: () => void | Promise<void> }) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(""), [copyNotice, setCopyNotice] = useState("");
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
  // Build the visible and downloaded receipts from the same confirmed response.
  // IDs are Veyra records, never blockchain hashes. No prices, fees or wallet
  // balances are inferred from the client's pre-send holdings snapshot.
  const receiptSections = result ? [
    { title: 'Transfer details', rows: [
      ['Type', 'Crypto send'],
      ['Status', cancelled ? 'Cancelled' : result.status === 'recorded' ? 'Sent' : result.status],
      ['Reference', result.reference],
      ['Date', new Date(result.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })],
      ['Asset', `${holding.name} · ${result.asset}`],
      ['Quantity', `${result.quantity} ${result.asset}`],
      ['Network fee', 'None collected'],
      ['Total debited', `${cancelled ? '0' : result.quantity} ${result.asset}`],
    ] },
    { title: 'Sender & destination', rows: [
      ['From', 'Your Veyra account'],
      ['Account holder', user?.name ?? 'Unavailable'],
      ['Account type', user?.accountType === 'business' ? 'Business' : user?.accountType === 'personal' ? 'Personal' : 'Unavailable'],
      ['To', 'External wallet'],
      ['Network', result.network],
    ] },
    { title: 'Record & settlement', rows: [
      ['Veyra record ID', result.id],
      ['Settlement', 'Veyra account record'],
      ['Transaction hash', 'Not available · not broadcast'],
      ['Confirmations', 'Not applicable · account record only'],
    ] },
  ] : [];
  async function copyDetail(label: string, value: string) {
    setCopied(''); setCopyNotice('');
    try {
      await navigator.clipboard.writeText(value);
      if (live.current) { setCopied(label); setCopyNotice(`${label} copied.`); }
    } catch {
      if (live.current) setCopyNotice(`Could not copy ${label.toLowerCase()}. Select the full value to copy it manually, or download the receipt.`);
    }
  }
  const copyButton = (label: string, value: string) => <button type="button" className="crypto-receipt-copy" aria-label={`Copy ${label.toLowerCase()}`} onClick={() => void copyDetail(label, value)}>
    {copied === label ? <Check size={14} /> : <Copy size={14} />}<span>{copied === label ? 'Copied' : 'Copy'}</span>
  </button>;
  const download = () => {
    if (!result) return;
    downloadFile(`veyra-crypto-send-${result.reference}.txt`, [
      'VEYRA — CRYPTO SEND RECEIPT',
      ...receiptSections.flatMap(section => ['', section.title.toUpperCase(), ...section.rows.map(([label, value]) => `${label}: ${value}`)]),
      `Destination wallet address: ${result.address}`,
      '', cancelled ? 'This request was cancelled; it has not been submitted again.' : 'Settled in your Veyra account record. No blockchain transaction hash or confirmation exists.',
      'External custody and on-chain execution are not connected.',
    ].join('\n'));
  };
  return <MotionConfig reducedMotion={reduce ? 'always' : 'never'}><LayoutGroup id={layoutId}>
    <div className="flow-scrim crypto-send-scrim"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Send ${holding.asset}`} className="flow-modal crypto-send-flow" data-motion={reduce ? 'reduced' : 'full'}>
        <div className="flow-head"><StageDots kind="deposit" stage={stage === 'recorded' ? 'success' : stage} completionLabel="Done" />
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
              <motion.span className="coin-glow" initial={reduce ? false : { scale: .5, opacity: 0 }} animate={{ scale: 1, opacity: [0, .85, .45] }} transition={{ duration: 1.1, delay: .18 }} />
              <motion.span className="coin-ring" initial={reduce ? false : { scale: .78, opacity: .6 }} animate={{ scale: 1.85, opacity: 0 }} transition={{ duration: 1.25, delay: .22, ease: 'easeOut' }} />
              <motion.span className="coin-ring" initial={reduce ? false : { scale: .78, opacity: .45 }} animate={{ scale: 1.5, opacity: 0 }} transition={{ duration: 1.1, delay: .5, ease: 'easeOut' }} />
              <Coin3D asset={result.asset} reduce={!!reduce} />
              <motion.span className="coin-sheen" initial={reduce ? false : { x: '-130%' }} animate={{ x: '130%' }} transition={{ duration: .95, delay: .34, ease: 'easeInOut' }} />
              <motion.span className="coin-check" initial={reduce ? false : { scale: .6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20, delay: .2 }}><Check size={19} /></motion.span>
            </div>
            <span className="crypto-send-eyebrow">WITHDRAWAL SENT</span>
            <h2 className="flow-title">{cancelled ? 'Previously cancelled request' : 'Send complete'}</h2>
            <strong className="crypto-send-quantity">{result.quantity} <small>{result.asset}</small></strong>
            <p className="flow-sub">{cancelled ? 'This request is cancelled. It has not been submitted again.' : `${result.quantity} ${result.asset} has been sent from your Veyra holdings.`}</p>
          </div>
          <div className="crypto-send-receipt" aria-label="Crypto send receipt">
            {receiptSections.map((section, sectionIndex) => <section key={section.title} className="receipt crypto-receipt-section" aria-label={section.title}>
              <h3>{section.title}</h3>
              {section.rows.map(([label, value], i) => <motion.div key={label} className={`receipt-row${label === 'Total debited' ? ' crypto-receipt-total' : ''}`} initial={reduce ? false : { opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(sectionIndex * .12 + i * .035, .45) }}>
                <span>{label}</span><div className="crypto-receipt-value"><b>{value}</b>{(label === 'Reference' || label === 'Veyra record ID') && copyButton(label, value)}</div>
              </motion.div>)}
              {section.title === 'Sender & destination' && <div className="crypto-send-destination crypto-receipt-address"><div className="crypto-receipt-address-head"><span>Destination wallet address</span>{copyButton('Destination wallet address', result.address)}</div><code>{result.address}</code></div>}
            </section>)}
          </div>
          <p className="crypto-receipt-copy-notice" aria-live="polite">{copyNotice}</p>
          <p className="crypto-send-note">Completed in your Veyra account record. External custody and on-chain execution are not connected, so no network fee or transaction hash is involved.</p>
          <div className="flow-actions"><button type="button" className="ghost-btn" onClick={download}><Download size={15} /> Send receipt</button><button type="button" className="solid-btn" onClick={close}>Done</button></div>
        </motion.div>}
      </div>
    </section></div>
  </LayoutGroup></MotionConfig>;
}
