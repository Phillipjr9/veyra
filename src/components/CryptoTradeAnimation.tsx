import { FlowProcessing } from "./MoneyFlow";
import { VeyraMark } from "./VeyraMark";
import { assetIcon } from "../lib/holdings";
import { money } from "../lib/store";
import type { CryptoQuote } from "../../shared/cryptoWorkspace";

const copy = {
  buy: { title: "Buying crypto…", steps: ["Preparing your checking debit", "Displaying your purchase quote", "Preparing your crypto balance update", "Preparing your purchase receipt"] },
  sell: { title: "Selling crypto…", steps: ["Preparing your crypto sale", "Displaying your sale quote", "Preparing your checking credit", "Preparing your sale receipt"] },
  swap: { title: "Swapping crypto…", steps: ["Preparing the source asset", "Displaying your exchange quote", "The swap fee is debited from checking", "Preparing your swap receipt"] },
};

/** One node of the track: checking is the Veyra mark, every asset its own icon. */
const node = (asset: string, sub: string) => asset === "USD"
  ? { label: "Veyra checking", sub, icon: <VeyraMark width={20} height={20} /> }
  : { label: asset, sub, icon: <img className="trade-asset-mark" src={assetIcon(asset)} alt="" width={20} height={20} /> };

/** The from → to track for a quote, shared by review, processing and receipt. */
export function cryptoTrack(quote: CryptoQuote): { from: ReturnType<typeof node>; to: ReturnType<typeof node> } {
  const from = node(quote.fromAsset, `${quote.fromQuantity} ${quote.fromAsset}`);
  const to = node(quote.toAsset, `${quote.toQuantity} ${quote.toAsset}`);
  return { from, to };
}

/**
 * Crypto processing is the same presentation as Add funds and Send money: the
 * shared FlowProcessing with a from → to track. Only the copy differs.
 */
export function CryptoTradeAnimation({ quote, onPresented }: { quote: CryptoQuote; onPresented: () => void }) {
  const { title, steps } = copy[quote.action];
  const amount = quote.action === "buy" ? money(Number(quote.notionalUsd)) : `${quote.fromQuantity} ${quote.fromAsset}`;
  return <FlowProcessing title={title} amount={amount} steps={steps} onDone={onPresented} minimumStepMs={600}
    awaitingConfirmation waitingTitle="Waiting for account confirmation…" track={cryptoTrack(quote)} />;
}
