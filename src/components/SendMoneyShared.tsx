import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Briefcase, Code, Megaphone, Plane, Plug, Scale, Tag, Wrench, Copy, Check, type LucideIcon } from "lucide-react";
import { categories, copyText, rewardRate } from "../lib/store";
import type { CategoryOption } from "./CategoryPicker";
import "../styles/veyra-id.css";

/* Shared by both Send money pages (personal and business) so they never drift. */

const CATEGORY_META: Record<string, { Icon: LucideIcon; description: string }> = {
  Software: { Icon: Code, description: "Subscriptions and cloud tools" },
  Advertising: { Icon: Megaphone, description: "Ads, marketing and promotion" },
  Travel: { Icon: Plane, description: "Flights, lodging and transport" },
  Operations: { Icon: Briefcase, description: "Day-to-day running costs" },
  Utilities: { Icon: Plug, description: "Power, water, internet and phone" },
  Equipment: { Icon: Wrench, description: "Hardware, tools and machinery" },
  Professional: { Icon: Scale, description: "Legal, accounting and consulting" },
};

/** Category choices for an outgoing payment. Personal accounts may leave it empty. */
export function transferCategoryOptions(personal: boolean): CategoryOption[] {
  const choices: CategoryOption[] = categories.map(name => ({
    value: name,
    label: name,
    description: CATEGORY_META[name]?.description ?? "Business spending",
    Icon: CATEGORY_META[name]?.Icon ?? Tag,
    rate: rewardRate(name),
  }));
  return personal
    ? [{ value: "", label: "No category", description: "Skip this — you can still send", Icon: Tag }, ...choices]
    : choices;
}

/**
 * The member's Veyra ID as a scannable Code 128 barcode, with their email.
 * Others send money to either one; neither reveals the account number.
 */
export function VeyraIdCard({ veyraId, email }: { veyraId?: string; email?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const [copied, setCopied] = useState("");
  useEffect(() => {
    if (!svg.current || !veyraId) return;
    try {
      JsBarcode(svg.current, veyraId, { format: "CODE128", displayValue: false, lineColor: "#2a1c3d", background: "#ffffff", width: 1.7, height: 54, margin: 6 });
    } catch {
      // A value the encoder cannot render leaves the ID itself visible below.
    }
  }, [veyraId]);
  const copy = async (label: string, value: string) => {
    const ok = await copyText(value);
    setCopied(ok ? label : "");
    if (ok) window.setTimeout(() => setCopied(current => (current === label ? "" : current)), 1600);
  };
  if (!veyraId) {
    return <section className="veyra-id-card is-pending" aria-label="Your Veyra ID">
      <p>Your Veyra ID is being prepared. Refresh your account in a moment.</p>
    </section>;
  }
  return <section className="veyra-id-card" aria-label="Your Veyra ID">
    <div className="veyra-id-head">
      <span className="veyra-id-kicker">Your Veyra ID</span>
      <b className="veyra-id-value">{veyraId}</b>
    </div>
    <div className="veyra-id-code">
      <svg ref={svg} role="img" aria-label={`Barcode for Veyra ID ${veyraId}`} />
    </div>
    <dl className="veyra-id-rows">
      <div><dt>Email</dt><dd>{email || "—"}</dd></div>
    </dl>
    <div className="veyra-id-actions">
      <button type="button" className="ghost-btn sm" onClick={() => void copy("Veyra ID", veyraId)}>
        {copied === "Veyra ID" ? <Check size={13} /> : <Copy size={13} />} {copied === "Veyra ID" ? "Copied" : "Copy ID"}
      </button>
      {email && <button type="button" className="ghost-btn sm" onClick={() => void copy("Email", email)}>
        {copied === "Email" ? <Check size={13} /> : <Copy size={13} />} {copied === "Email" ? "Copied" : "Copy email"}
      </button>}
    </div>
    <p className="veyra-id-note">Members send you money with this email or Veyra ID. Veyra-to-Veyra transfers arrive instantly and are free.</p>
  </section>;
}
