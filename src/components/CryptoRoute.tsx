import { useId, type ReactNode } from "react";
import { ArrowDown, ChevronDown, Landmark } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { assetIcon } from "../../shared/assetIcons";
import { ASSETS } from "../../shared/catalog";
import "../styles/crypto-route.css";

type Endpoint = {
  asset: string; quantity?: string; accountLast4?: string;
  choices?: { asset: string; name: string }[];
  onChange?: (asset: string) => void;
};
/** One aligned route, shared by selection, review and order preparation. */
export function CryptoRoute({ from, to, editable = false, busy = false, processing = false, transitIcon }: {
  from: Endpoint; to: Endpoint; editable?: boolean; busy?: boolean; processing?: boolean; transitIcon?: ReactNode;
}) {
  const id = useId(), reduce = useReducedMotion() !== false;
  const row = (endpoint: Endpoint, side: "From" | "To") => {
    const cash = endpoint.asset === "USD";
    const name = cash ? "Veyra checking" : ASSETS.find(asset => asset.code === endpoint.asset)?.name ?? endpoint.asset;
    const controlId = `${id}-${side}`;
    const icon = <span className={`cw-route-mark ${cash ? "is-cash" : ""}`} aria-hidden="true">{cash ? <Landmark size={21} /> : <img src={assetIcon(endpoint.asset)} width={36} height={36} alt="" />}</span>;
    if (editable) return <label className="cw-route-field" htmlFor={controlId}>
      {icon}<span className="cw-route-copy"><span className="cw-route-label">{side}</span>
        <span className="cw-route-control">{endpoint.choices ? <>
          <select id={controlId} aria-label={side} value={endpoint.asset} disabled={busy} onChange={event => endpoint.onChange?.(event.target.value)}>
            {endpoint.choices.map(asset => <option key={asset.asset} value={asset.asset}>{asset.name} · {asset.asset}</option>)}
          </select><ChevronDown size={16} aria-hidden="true" />
        </> : <input id={controlId} aria-label={side} readOnly value={name} />}</span>
        <span className="cw-route-caption">{cash ? `USD${endpoint.accountLast4 ? ` · •••• ${endpoint.accountLast4}` : " · Checking account"}` : `${endpoint.asset} · Veyra crypto`}</span>
      </span>
    </label>;
    return <div className="cw-route-field">
      {icon}<div className="cw-route-copy"><span className="cw-route-label">{side} · {name}</span>
        <strong className="cw-route-quantity">{endpoint.quantity} <span>{endpoint.asset}</span></strong>
        {cash && endpoint.accountLast4 && <span className="cw-route-caption">Checking •••• {endpoint.accountLast4}</span>}
      </div>
    </div>;
  };
  return <div className={`cw-route ${editable ? "is-editable" : "is-summary"} ${processing ? "is-processing" : ""}`} role="group" aria-label="From and to accounts">
    {row(from, "From")}
    <div className="cw-route-divider" aria-hidden="true"><motion.span className="cw-route-direction"
      animate={processing && !reduce ? { y: [-2, 2, -2] } : { y: 0 }} transition={processing && !reduce ? { duration: 1.6, repeat: Infinity, ease: "easeInOut" } : { duration: 0 }}>
      {processing && !reduce && transitIcon ? transitIcon : <ArrowDown size={14} />}
    </motion.span></div>
    {row(to, "To")}
  </div>;
}
