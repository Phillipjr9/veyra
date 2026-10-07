import { CryptoRoute } from "./CryptoRoute";
import { useMemo, type ReactNode } from "react";
import { Landmark } from "lucide-react";
import { motion, MotionConfig, useReducedMotion } from "motion/react";
import { FlowProcessing } from "./MoneyFlow";
import { assetIcon } from "../lib/holdings";
import type { CryptoQuote } from "../../shared/cryptoWorkspace";
import "../styles/crypto-trade-animation.css";

const copy = {
  buy: { title: "Buying crypto…", steps: ["Preparing your checking debit", "Displaying your purchase quote", "Preparing your crypto balance update", "Preparing your purchase receipt"] },
  sell: { title: "Selling crypto…", steps: ["Preparing your crypto sale", "Displaying your sale quote", "Preparing your checking credit", "Preparing your sale receipt"] },
  swap: { title: "Swapping crypto…", steps: ["Preparing the source asset", "Displaying your exchange quote", "Preparing the destination asset", "Preparing your swap receipt"] },
};

/**
 * The conversion hero: a two-sided coin showing what leaves on the front and
 * what arrives on the back. Step progress turns it over; when the presentation
 * finishes it lands on the destination side with a soft ring pulse. An account
 * conversion only — nothing here implies a blockchain broadcast.
 */
function TradeFlipCoin({ front, back, progress, finished, reduce }: {
  front: ReactNode; back: ReactNode; progress: number; finished: boolean; reduce: boolean;
}) {
  if (reduce) return <span className="trade-flip is-final">{back}</span>;
  return (
    <span className="trade-flip" aria-hidden="true">
      <motion.span
        className="trade-flip-inner"
        initial={false}
        animate={{ rotateY: finished ? 180 : progress * 180, scale: finished ? [1, 1.16, 1] : 1 }}
        transition={{ rotateY: { duration: 0.6, ease: "easeInOut" }, scale: { duration: 0.6, ease: "easeOut" } }}
      >
        <span className="trade-face trade-front">{front}</span>
        <span className="trade-face trade-back">{back}</span>
      </motion.span>
      {finished && (
        <motion.span
          className="trade-land-ring"
          initial={{ scale: 0.55, opacity: 0.9 }}
          animate={{ scale: 2, opacity: 0 }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      )}
    </span>
  );
}

function TradeSparkles() {
  const sparks = useMemo(
    () => Array.from({ length: 9 }, (_, i) => ({
      left: `${6 + ((i * 83) % 88)}%`,
      delay: `${((i * 0.37) % 1.8).toFixed(2)}s`,
      duration: `${(1.7 + (i % 3) * 0.45).toFixed(2)}s`,
      size: 3 + (i % 3) * 2,
    })),
    [],
  );
  return (
    <span className="trade-sparkles" aria-hidden="true">
      {sparks.map((s, i) => (
        <i key={i} style={{ left: s.left, animationDelay: s.delay, animationDuration: s.duration, width: s.size, height: s.size }} />
      ))}
    </span>
  );
}

export function CryptoTradeAnimation({ quote, onPresented }: { quote: CryptoQuote; onPresented: () => void }) {
  const reduce = useReducedMotion() !== false;
  const { title, steps } = copy[quote.action];
  const mark = (asset: string) => asset === "USD" ? <Landmark size={23} /> : <img className="trade-asset-mark" src={assetIcon(asset)} alt="" />;
  const cash = <span className="trade-cash-mark">$</span>;
  const coin = (asset: string) => asset === "USD"
    ? <span className="trade-cash-mark trade-hero-cash">$</span>
    : <img className="trade-hero-mark" src={assetIcon(asset)} alt="" />;
  const travelling = quote.action === "swap" ? <span className="trade-swap-pair">{mark(quote.fromAsset)}{mark(quote.toAsset)}</span>
    : quote.action === "sell" ? cash : mark(quote.toAsset);
  return <MotionConfig reducedMotion={reduce ? "always" : "never"}>
    <motion.section
      className={`crypto-trade-animation trade-${quote.action}`}
      data-motion={reduce ? "reduced" : "full"}
      aria-label={`${quote.action} progress`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <FlowProcessing title={title} amount={`${quote.fromQuantity} ${quote.fromAsset}`} steps={steps} onDone={onPresented}
        minimumStepMs={600} awaitingConfirmation showProgressRing
        waitingTitle="Waiting for account confirmation…" movingIcon={travelling}
        renderCenterIcon={(progress, finished) => <>
          <TradeFlipCoin front={coin(quote.fromAsset)} back={coin(quote.toAsset)} progress={progress} finished={finished} reduce={reduce} />
          {!reduce && <TradeSparkles />}
        </>}
        track={{ from: { label: quote.fromAsset === "USD" ? "Veyra checking" : quote.fromAsset, sub: `${quote.fromQuantity} ${quote.fromAsset}`, icon: mark(quote.fromAsset) },
          to: { label: quote.toAsset === "USD" ? "Veyra checking" : quote.toAsset, sub: `${quote.toQuantity} ${quote.toAsset}`, icon: mark(quote.toAsset) } }}
        renderTrack={(progress, finished) => <CryptoRoute processing transitIcon={travelling} progress={progress} arrived={finished}
          from={{ asset: quote.fromAsset, quantity: quote.fromQuantity }} to={{ asset: quote.toAsset, quantity: quote.toQuantity }} />}
        note={quote.action === "swap" ? "Crypto to crypto. Your checking balance stays unchanged. No blockchain broadcast." : "Account update only. No external trade or blockchain broadcast."} />
    </motion.section>
  </MotionConfig>;
}
