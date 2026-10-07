import { useEffect, useRef, useState, type FormEvent } from "react";
import { ExternalLink, ShieldCheck, Wallet, X } from "lucide-react";
import { formatEthWei, readSepoliaReceipt, reviewSepoliaSend, sendSepoliaTransfer, connectSepoliaWallet, SepoliaSendOutcomeUnknownError, type SepoliaReceipt, type SepoliaSendReview } from "../lib/ethereumTestnet";
import type { WalletChoice } from "../lib/web3";
import { useBankingDialog } from "./bankingDialog";

const explorer = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;
const messageOf = (error: unknown) => error instanceof Error ? error.message.slice(0, 240) : "The wallet could not complete this Sepolia test transfer.";

type Stage = "connect" | "form" | "review" | "submitting" | "uncertain" | "pending" | "mined" | "reverted";

export function SepoliaSendDialog({ choices, close }: { choices: WalletChoice[]; close: () => void }) {
  const wallets = choices.filter(choice => !!choice.ethereum);
  const [choice, setChoice] = useState<WalletChoice | null>(null), [from, setFrom] = useState("");
  const [stage, setStage] = useState<Stage>("connect"), [destination, setDestination] = useState(""), [amount, setAmount] = useState("");
  const [review, setReview] = useState<SepoliaSendReview | null>(null), [hash, setHash] = useState(""), [receipt, setReceipt] = useState<SepoliaReceipt | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const dialog = useBankingDialog(close, busy);

  useEffect(() => {
    const provider = choice?.ethereum;
    if (!provider) return;
    const invalidate = () => {
      if (stageRef.current === "submitting") {
        setNotice("Wallet account or network changed while approval was open. Do not approve unless your wallet confirms Ethereum Sepolia.");
        return;
      }
      if (["uncertain", "pending", "mined", "reverted"].includes(stageRef.current)) {
        setNotice("Wallet account or network changed. Use the wallet activity or transaction hash below to check status.");
        return;
      }
      setChoice(null); setFrom(""); setReview(null); setStage("connect");
      setError("The wallet account or network changed. Reconnect to review this transfer again.");
    };
    provider.on?.("accountsChanged", invalidate);
    provider.on?.("chainChanged", invalidate);
    provider.on?.("disconnect", invalidate);
    return () => {
      for (const event of ["accountsChanged", "chainChanged", "disconnect"]) {
        if (provider.removeListener) provider.removeListener(event, invalidate);
        else provider.off?.(event, invalidate);
      }
    };
  }, [choice]);

  async function connect(wallet: WalletChoice) {
    if (!wallet.ethereum || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const address = await connectSepoliaWallet(wallet.ethereum);
      setChoice(wallet); setFrom(address); setStage("form");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  }

  async function createReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choice?.ethereum || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const quote = await reviewSepoliaSend(choice.ethereum, from, destination, amount);
      setReview(quote); setStage("review");
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!choice?.ethereum || !review || busy) return;
    const provider = choice.ethereum;
    setBusy(true); setError(""); setNotice(""); setStage("submitting");
    // Recheck immediately before asking for a wallet signature. Any fee or
    // balance change forces another visible review rather than silent approval.
    let fresh: SepoliaSendReview;
    try { fresh = await reviewSepoliaSend(provider, from, destination, amount); }
    catch (cause) { setError(messageOf(cause)); setStage("review"); setBusy(false); return; }
    const changed = ["from", "to", "valueWei", "gasLimit", "gasPriceWei", "estimatedFeeWei", "balanceWei"]
      .some(key => fresh[key as keyof SepoliaSendReview] !== review[key as keyof SepoliaSendReview]);
    if (changed) {
      setReview(fresh); setStage("review"); setBusy(false);
      setNotice("The wallet balance or fee estimate changed. Review the updated amount and fee before approving.");
      return;
    }

    let submittedHash: string;
    try { submittedHash = await sendSepoliaTransfer(provider, fresh); }
    catch (cause) {
      setError(messageOf(cause));
      setStage(cause instanceof SepoliaSendOutcomeUnknownError ? "uncertain" : "review");
      setBusy(false);
      return;
    }
    setHash(submittedHash); setReceipt(null); setStage("pending"); setBusy(false);

    try {
      const result = await readSepoliaReceipt(provider, submittedHash);
      if (result) { setReceipt(result); setStage(result.status === "success" ? "mined" : "reverted"); }
      else setNotice("The wallet submitted the transaction. It is not mined yet; check again shortly.");
    } catch {
      setNotice("The transaction was submitted, but its receipt is not available yet. Use the Sepolia explorer to check its status.");
    }
  }

  async function checkStatus() {
    if (!choice?.ethereum || !hash || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await readSepoliaReceipt(choice.ethereum, hash);
      if (!result) setNotice("No mined receipt yet. The transaction is still pending or not visible to this wallet provider.");
      else { setReceipt(result); setStage(result.status === "success" ? "mined" : "reverted"); }
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  }

  return <div className="banking-scrim"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Send Sepolia test ETH" className="banking-panel cw-dialog cw-sepolia-dialog">
    <button type="button" className="flow-close" aria-label="Close" disabled={busy} onClick={close}><X size={16} /></button>
    <span className="cw-eyebrow"><ShieldCheck size={14} /> DEVELOPMENT TESTNET · NO REAL-VALUE ETH</span>
    <h2>Send ETH on Sepolia</h2>
    <p className="cw-testnet-disclosure">This sends native test ETH directly from your connected wallet after you approve it there. It never uses or changes Veyra account holdings. Mainnet and token transfers are not available in this test flow.</p>
    {error && <p role="alert" className="banking-error">{error}</p>}
    {notice && <p role="status" className="cw-notice">{notice}</p>}

    {stage === "connect" && <>
      <h3>Choose an Ethereum wallet</h3>
      {wallets.length ? <div className="cw-wallet-choices">{wallets.map(wallet => <button type="button" className="cw-wallet-choice" key={wallet.id} disabled={busy} onClick={() => void connect(wallet)}><Wallet size={22} /><span><b>{wallet.name}</b><small>Ethereum Sepolia · requests wallet approval</small></span></button>)}</div> : <p className="cw-notice">No Ethereum wallet detected. Open Veyra in a standalone browser tab with a supported wallet, then switch that wallet to Sepolia testnet.</p>}
      {busy && <p role="status">Check your wallet for the Sepolia connection request. Veyra never asks for a recovery phrase.</p>}
    </>}

    {stage === "form" && choice && <form onSubmit={event => void createReview(event)}>
      <p>Connected: <b>{choice.name}</b><br /><small>Sender · {from}</small></p>
      <label>Recipient address<input aria-label="Sepolia recipient address" required autoComplete="off" spellCheck={false} value={destination} onChange={event => setDestination(event.target.value.trim())} /></label>
      <label>Amount in ETH<input aria-label="Sepolia ETH amount" required inputMode="decimal" autoComplete="off" placeholder="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
      <p className="cw-notice">Only Sepolia native ETH is supported. Review the network, recipient, amount and estimated fee; your wallet will show the transaction before signing.</p>
      <div className="modal-actions"><button type="button" className="ghost-btn" disabled={busy} onClick={() => { setChoice(null); setFrom(""); setStage("connect"); }}>Choose wallet</button><button type="submit" className="solid-btn" disabled={busy}>{busy ? "Checking wallet…" : "Review transfer"}</button></div>
    </form>}

    {stage === "review" && review && <>
      <div className="cw-sepolia-review"><div><span>Network</span><b>Ethereum Sepolia testnet</b></div><div><span>From</span><code>{review.from}</code></div><div><span>To</span><code>{review.to}</code></div><div><span>Amount</span><b>{formatEthWei(review.valueWei)} ETH</b></div><div><span>Estimated network fee</span><b>{formatEthWei(review.estimatedFeeWei)} ETH</b></div><div><span>Total including estimate</span><b>{formatEthWei(BigInt(review.valueWei) + BigInt(review.estimatedFeeWei))} ETH</b></div></div>
      <p className="cw-notice">The network fee is an estimate; the wallet calculates the final fee and asks you to approve the transaction. No key or signature is sent to Veyra.</p>
      <div className="modal-actions"><button type="button" className="ghost-btn" disabled={busy} onClick={() => setStage("form")}>Edit transfer</button><button type="button" className="solid-btn" disabled={busy} onClick={() => void submit()}>{busy ? "Rechecking wallet…" : "Review and approve in wallet"}</button></div>
    </>}

    {stage === "submitting" && <p role="status">Waiting for your wallet to approve this Sepolia transfer…</p>}
    {stage === "uncertain" && <>
      <p className="cw-notice">Veyra did not receive a trustworthy transaction hash. The wallet may still have broadcast the request. Do not submit it again until you check your wallet's Sepolia activity. This development flow cannot recover a hash the wallet did not return.</p>
      <div className="modal-actions"><button type="button" className="solid-btn" onClick={close}>Close</button></div>
    </>}
    {stage === "pending" && hash && <>
      <p role="status"><b>Submitted to the wallet.</b> Veyra has not marked this as mined or changed any account balance.</p>
      <code className="cw-address">{hash}</code><a className="cw-explorer-link" href={explorer(hash)} target="_blank" rel="noopener noreferrer">Check on Sepolia Etherscan <ExternalLink size={14} /></a>
      <div className="modal-actions"><button type="button" className="ghost-btn" disabled={busy} onClick={() => void checkStatus()}>{busy ? "Checking…" : "Check status"}</button><button type="button" className="solid-btn" onClick={close}>Close</button></div>
    </>}
    {stage === "mined" && hash && receipt && <>
      <p role="status"><b>Included in a Sepolia block.</b> This testnet transaction does not affect Veyra account balances or represent a mainnet transfer.</p>
      <div className="cw-sepolia-review"><div><span>Transaction hash</span><code>{hash}</code></div><div><span>Block</span><b>{receipt.blockNumber}</b></div></div>
      <a className="cw-explorer-link" href={explorer(hash)} target="_blank" rel="noopener noreferrer">View on Sepolia Etherscan <ExternalLink size={14} /></a>
      <button type="button" className="solid-btn cw-close" onClick={close}>Done</button>
    </>}
    {stage === "reverted" && hash && receipt && <>
      <p role="status"><b>The Sepolia transaction reverted.</b> The network may still charge a testnet fee. Veyra account balances were not changed.</p>
      <code className="cw-address">{hash}</code><a className="cw-explorer-link" href={explorer(hash)} target="_blank" rel="noopener noreferrer">View on Sepolia Etherscan <ExternalLink size={14} /></a>
      <button type="button" className="solid-btn cw-close" onClick={close}>Done</button>
    </>}
    <small className="cw-safety"><ShieldCheck size={14} /> Veyra never receives your private key or recovery phrase.</small>
  </section></div>;
}
