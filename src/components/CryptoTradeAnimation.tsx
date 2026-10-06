import { CryptoRoute } from "./CryptoRoute";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Landmark } from "lucide-react";
import { MotionConfig, useReducedMotion } from "motion/react";
import { FlowProcessing } from "./MoneyFlow";
import { assetIcon } from "../lib/holdings";
import type { CryptoQuote } from "../../shared/cryptoWorkspace";
import "../styles/crypto-trade-animation.css";

const copy = {
  buy: { title: "Buying crypto…", steps: ["Preparing your checking debit", "Displaying your purchase quote", "Preparing your crypto balance update", "Preparing your purchase receipt"], Icon: ArrowUpRight },
  sell: { title: "Selling crypto…", steps: ["Preparing your crypto sale", "Displaying your sale quote", "Preparing your checking credit", "Preparing your sale receipt"], Icon: ArrowDownLeft },
  swap: { title: "Swapping crypto…", steps: ["Preparing the source asset", "Displaying your exchange quote", "Preparing the destination asset", "Preparing your swap receipt"], Icon: ArrowLeftRight },
};
export function CryptoTradeAnimation({ quote, onPresented }: { quote: CryptoQuote; onPresented: () => void }) {
  const reduce = useReducedMotion() !== false;
  const { title, steps, Icon } = copy[quote.action];
  const mark = (asset: string) => asset === "USD" ? <Landmark size={23} /> : <img className="trade-asset-mark" src={assetIcon(asset)} alt="" />;
  const travelling = quote.action === "swap" ? <span className="trade-swap-pair">{mark(quote.fromAsset)}{mark(quote.toAsset)}</span>
    : quote.action === "sell" ? <span className="trade-cash-mark">$</span> : mark(quote.toAsset);
  return <MotionConfig reducedMotion={reduce ? "always" : "never"}>
    <section className={`crypto-trade-animation trade-${quote.action}`} data-motion={reduce ? "reduced" : "full"} aria-label={`${quote.action} progress`}>
      <FlowProcessing title={title} amount={`${quote.fromQuantity} ${quote.fromAsset}`} steps={steps} onDone={onPresented}
        minimumStepMs={600} awaitingConfirmation showProgressRing centerIcon={<Icon size={24} />}
        waitingTitle="Waiting for account confirmation…" movingIcon={travelling}
        track={{ from: { label: quote.fromAsset === "USD" ? "Veyra checking" : quote.fromAsset, sub: `${quote.fromQuantity} ${quote.fromAsset}`, icon: mark(quote.fromAsset) },
          to: { label: quote.toAsset === "USD" ? "Veyra checking" : quote.toAsset, sub: `${quote.toQuantity} ${quote.toAsset}`, icon: mark(quote.toAsset) } }}
        renderTrack={() => <CryptoRoute processing transitIcon={travelling} from={{ asset: quote.fromAsset, quantity: quote.fromQuantity }} to={{ asset: quote.toAsset, quantity: quote.toQuantity }} />}
        note={quote.action === "swap" ? "Crypto to crypto. Your checking balance stays unchanged. No blockchain broadcast." : "Account update only. No external trade or blockchain broadcast."} />
    </section>
  </MotionConfig>;
}
