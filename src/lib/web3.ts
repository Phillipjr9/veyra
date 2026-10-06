import { apiPost } from "./api";
import { ETHEREUM_TOKENS, displayUnits, type WalletNetwork } from "../../shared/cryptoWorkspace";
import { validWallet } from "../../shared/walletAddress";

type Listener = (...args: unknown[]) => void;
type EventSource = { on?: (event: string, listener: Listener) => void; removeListener?: (event: string, listener: Listener) => void; off?: (event: string, listener: Listener) => void };
export type EthereumProvider = EventSource & { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
type PublicKey = { toString(): string };
type SolanaProvider = EventSource & { connect(): Promise<{ publicKey: PublicKey }>; publicKey?: PublicKey | null; disconnect?(): Promise<void> };
type BitcoinProvider = EventSource & { requestAccounts(): Promise<string[]>; getAccounts(): Promise<string[]>; getChain(): Promise<{ enum: string }>; getBalance(): Promise<{ confirmed: number; unconfirmed: number; total: number }> };
type WalletWindow = Window & { ethereum?: EthereumProvider; phantom?: { solana?: SolanaProvider }; unisat?: BitcoinProvider };
export type WalletChoice = { id: string; name: string; network: WalletNetwork; ethereum?: EthereumProvider; solana?: SolanaProvider; bitcoin?: BitcoinProvider };
export type WalletBalance = { asset: string; quantity: string | null; note?: string };
export type WalletSession = { choice: WalletChoice; address: string; balances: WalletBalance[]; observedAt: number; networkVerified: boolean };

/** Read-only connections. No signing, transaction, approval or private-key methods. */
export function discoverWallets(changed: (wallets: WalletChoice[]) => void): () => void {
  const browser = window as WalletWindow, found = new Map<string, WalletChoice>();
  function refresh() {
    if (browser.phantom?.solana?.connect) found.set("phantom-solana", { id: "phantom-solana", name: "Phantom", network: "Solana", solana: browser.phantom.solana });
    if (typeof browser.unisat?.requestAccounts === "function" && typeof browser.unisat.getChain === "function") found.set("unisat-bitcoin", { id: "unisat-bitcoin", name: "UniSat", network: "Bitcoin", bitcoin: browser.unisat });
    if (browser.ethereum?.request && ![...found.values()].some(item => item.ethereum === browser.ethereum)) found.set("injected-ethereum", { id: "injected-ethereum", name: "Browser Ethereum wallet", network: "Ethereum", ethereum: browser.ethereum });
    changed([...found.values()]);
  }
  const announce = (event: Event) => {
    const detail = (event as CustomEvent<{ info?: { uuid?: unknown; name?: unknown }; provider?: EthereumProvider }>).detail;
    if (!detail?.info || !detail.provider || typeof detail.provider.request !== "function" || typeof detail.info.uuid !== "string" || !/^[a-f0-9-]{36}$/i.test(detail.info.uuid) || typeof detail.info.name !== "string" || !detail.info.name.trim() || found.size >= 20) return;
    if ([...found.values()].some(item => item.ethereum === detail.provider && item.id !== "injected-ethereum")) return;
    // Provider metadata is self-reported. Ignore its icon/rdns entirely: no remote
    // image requests, inline SVG, links or authentication derived from metadata.
    if (found.get("injected-ethereum")?.ethereum === detail.provider) found.delete("injected-ethereum");
    found.set(detail.info.uuid, { id: detail.info.uuid, name: detail.info.name.slice(0, 64), network: "Ethereum", ethereum: detail.provider });
    refresh();
  };
  window.addEventListener("eip6963:announceProvider", announce);
  window.addEventListener("focus", refresh);
  refresh();
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => { window.removeEventListener("eip6963:announceProvider", announce); window.removeEventListener("focus", refresh); };
}

function timed<T>(promise: Promise<T>, ms = 20_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The wallet did not respond. Open your wallet, dismiss any pending request, and try again.")), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
const checkedAddress = (network: WalletNetwork, address: unknown): string => {
  if (typeof address !== "string" || address.length > 120 || !validWallet(network, address)) throw new Error(`The wallet did not return a valid ${network} mainnet address.`);
  return address;
};
function hexUnits(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(value)) throw new Error("Balance unavailable");
  return BigInt(value).toString();
}
async function ethMainnet(provider: EthereumProvider) {
  if (await timed(provider.request({ method: "eth_chainId" })) !== "0x1") throw new Error("Switch your wallet to Ethereum mainnet, then reconnect. Other networks are not supported here.");
}
async function bitcoinMainnet(provider: BitcoinProvider) {
  if ((await timed(provider.getChain())).enum !== "BITCOIN_MAINNET") throw new Error("Switch UniSat to Bitcoin mainnet, then reconnect. Testnet and Fractal are not supported.");
}
export async function connectWallet(choice: WalletChoice): Promise<WalletSession> {
  let address: string;
  if (choice.ethereum) {
    const accounts = await timed(choice.ethereum.request({ method: "eth_requestAccounts" }), 120_000);
    address = checkedAddress("Ethereum", Array.isArray(accounts) ? accounts[0] : null);
    await ethMainnet(choice.ethereum);
  } else if (choice.solana) {
    const result = await timed(choice.solana.connect(), 120_000);
    address = checkedAddress("Solana", result.publicKey?.toString());
  } else if (choice.bitcoin) {
    address = checkedAddress("Bitcoin", (await timed(choice.bitcoin.requestAccounts(), 120_000))[0]);
    await bitcoinMainnet(choice.bitcoin);
  } else throw new Error("This wallet is not available in your browser.");
  return { choice, address, balances: [], observedAt: Date.now(), networkVerified: choice.network !== "Solana" };
}

export async function readWallet(session: WalletSession): Promise<WalletSession> {
  const { choice, address } = session;
  let balances: WalletBalance[] = [], verified = session.networkVerified;
  if (choice.ethereum) {
    const provider = choice.ethereum;
    const verify = async () => {
      await ethMainnet(provider);
      const accounts = await timed(provider.request({ method: "eth_accounts" }));
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || accounts[0].toLowerCase() !== address.toLowerCase()) throw new Error("The wallet account changed. Reconnect to review the new address.");
    };
    await verify();
    const specs = [{ symbol: "ETH", decimals: 18, address: null }, ...ETHEREUM_TOKENS];
    balances = await Promise.all(specs.map(async spec => {
      try {
        const raw = await timed(provider.request(spec.address ? { method: "eth_call", params: [{ to: spec.address, data: `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"] } : { method: "eth_getBalance", params: [address, "latest"] }));
        return { asset: spec.symbol, quantity: displayUnits(hexUnits(raw), spec.decimals) };
      } catch { return { asset: spec.symbol, quantity: null, note: "The wallet could not read this balance." }; }
    }));
    await verify();
  } else if (choice.bitcoin) {
    const verify = async () => {
      await bitcoinMainnet(choice.bitcoin!);
      if ((await timed(choice.bitcoin!.getAccounts()))[0] !== address) throw new Error("The Bitcoin account changed. Reconnect your wallet.");
    };
    await verify();
    try {
      const data = await timed(choice.bitcoin.getBalance());
      if (!Number.isSafeInteger(data.confirmed) || data.confirmed < 0) throw new Error("Invalid balance");
      balances = [{ asset: "BTC", quantity: displayUnits(String(data.confirmed), 8), note: "Confirmed balance reported by your wallet. Pending funds excluded." }];
    } catch { balances = [{ asset: "BTC", quantity: null, note: "Bitcoin balance unavailable." }]; }
    await verify();
  } else if (choice.solana) {
    const verify = () => { if (choice.solana!.publicKey?.toString() !== address) throw new Error("The Solana account changed. Reconnect your wallet."); };
    verify();
    try {
      const data = await apiPost<{ units: string | null; reason: string | null; status: string }>("/api/me/crypto/wallet-balance", { network: "Solana", address });
      verified = data.status === "available" && data.units !== null;
      balances = [{ asset: "SOL", quantity: data.units === null ? null : displayUnits(data.units, 9), note: data.reason ?? "Finalized balance on Solana mainnet. Other tokens are not indexed." }];
    } catch { balances = [{ asset: "SOL", quantity: null, note: "Solana balance reader is unavailable." }]; verified = false; }
    verify();
  }
  return { ...session, balances, observedAt: Date.now(), networkVerified: verified };
}

/** Invalidate, never silently reuse an address after wallet/network changes. */
export function watchWallet(choice: WalletChoice, invalidate: () => void): () => void {
  const provider = choice.ethereum ?? choice.solana ?? choice.bitcoin;
  const events = choice.ethereum ? ["accountsChanged", "chainChanged", "disconnect"] : choice.solana ? ["accountChanged", "disconnect"] : ["accountsChanged", "networkChanged", "chainChanged"];
  const listener: Listener = () => invalidate();
  for (const event of events) provider?.on?.(event, listener);
  return () => { for (const event of events) { if (provider?.removeListener) provider.removeListener(event, listener); else provider?.off?.(event, listener); } };
}
export async function disconnectWallet(session: WalletSession) {
  // Ethereum/UniSat permission revocation is controlled in the wallet itself.
  // Removing Veyra's connection does not claim to revoke the wallet's permissions.
  if (session.choice.solana?.disconnect) await timed(session.choice.solana.disconnect()).catch(() => undefined);
}
