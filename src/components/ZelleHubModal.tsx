import { useState } from "react";
import {
  Check, Copy, Share2, X, Smartphone,
  Mail, ShieldCheck
} from "lucide-react";
import { useAcct } from "../lib/store";
import { useAuth } from "../lib/auth";
import { useToast } from "./Toast";
import { ZelleLogo } from "./MoneyFlow";

export function ZelleHubModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { account } = useAcct();
  const { user } = useAuth();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  if (!open || !account || !user) return null;

  const zelleIdentifier = user.phone || user.email;

  const handleCopyTag = async () => {
    try {
      await navigator.clipboard.writeText(zelleIdentifier);
      setCopied(true);
      toast({
        tone: "success",
        title: "Zelle® Identifier Copied",
        description: `${zelleIdentifier} ready to share with sender.`,
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ tone: "info", title: "Zelle tag: " + zelleIdentifier });
    }
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal zelle-hub-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="zelle-hub-title">
            <ZelleLogo size={28} />
            <div>
              <h3>Zelle® Receive Hub & QR Code</h3>
              <p>Instant fee-free transfers from over 2,000 US banks and credit unions</p>
            </div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="zelle-qr-card">
          {/* Custom SVG QR Code with Zelle Emblem in Center */}
          <div className="zelle-qr-box">
            <svg viewBox="0 0 200 200" width="160" height="160" className="zelle-qr-svg">
              {/* Outer boundary */}
              <rect width="200" height="200" fill="#ffffff" rx="16" />
              
              {/* Corner position squares */}
              <rect x="16" y="16" width="44" height="44" rx="8" fill="#7414CA" />
              <rect x="24" y="24" width="28" height="28" rx="4" fill="#ffffff" />
              <rect x="30" y="30" width="16" height="16" rx="2" fill="#7414CA" />

              <rect x="140" y="16" width="44" height="44" rx="8" fill="#7414CA" />
              <rect x="148" y="24" width="28" height="28" rx="4" fill="#ffffff" />
              <rect x="154" y="30" width="16" height="16" rx="2" fill="#7414CA" />

              <rect x="16" y="140" width="44" height="44" rx="8" fill="#7414CA" />
              <rect x="24" y="148" width="28" height="28" rx="4" fill="#ffffff" />
              <rect x="30" y="154" width="16" height="16" rx="2" fill="#7414CA" />

              {/* Data modules pattern */}
              <rect x="74" y="18" width="12" height="12" fill="#20192E" />
              <rect x="94" y="18" width="12" height="12" fill="#20192E" />
              <rect x="114" y="18" width="12" height="12" fill="#20192E" />

              <rect x="74" y="38" width="12" height="12" fill="#20192E" />
              <rect x="114" y="38" width="12" height="12" fill="#20192E" />

              <rect x="18" y="74" width="12" height="12" fill="#20192E" />
              <rect x="38" y="74" width="12" height="12" fill="#20192E" />
              <rect x="58" y="74" width="12" height="12" fill="#20192E" />

              <rect x="134" y="74" width="12" height="12" fill="#20192E" />
              <rect x="154" y="74" width="12" height="12" fill="#20192E" />
              <rect x="174" y="74" width="12" height="12" fill="#20192E" />

              <rect x="18" y="114" width="12" height="12" fill="#20192E" />
              <rect x="38" y="114" width="12" height="12" fill="#20192E" />

              <rect x="74" y="134" width="12" height="12" fill="#20192E" />
              <rect x="94" y="134" width="12" height="12" fill="#20192E" />
              <rect x="114" y="134" width="12" height="12" fill="#20192E" />

              <rect x="134" y="134" width="12" height="12" fill="#20192E" />
              <rect x="174" y="134" width="12" height="12" fill="#20192E" />

              <rect x="134" y="154" width="12" height="12" fill="#20192E" />
              <rect x="154" y="174" width="12" height="12" fill="#20192E" />

              {/* Center Logo Shield */}
              <circle cx="100" cy="100" r="24" fill="#ffffff" stroke="#7414CA" strokeWidth="3" />
              <rect x="88" y="88" width="24" height="24" rx="6" fill="#7414CA" />
              <path d="M93 92H107L97 108H111" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>

          <div className="zelle-user-tag-row">
            <strong>{user.name}</strong>
            <code>{zelleIdentifier}</code>
          </div>

          <button
            type="button"
            className="solid-btn sm"
            onClick={handleCopyTag}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied to Clipboard" : "Copy Zelle® Tag / Identifier"}
          </button>
        </div>

        <div className="zelle-details-list">
          <div className="zelle-detail-row">
            <Smartphone size={16} className="text-violet" />
            <div>
              <strong>Enrolled Mobile Number</strong>
              <small>{user.phone || "Add in Account Settings for SMS transfers"}</small>
            </div>
            <span className="status-pill active"><Check size={10} /> Active</span>
          </div>

          <div className="zelle-detail-row">
            <Mail size={16} className="text-violet" />
            <div>
              <strong>Enrolled Email Identifier</strong>
              <small>{user.email}</small>
            </div>
            <span className="status-pill active"><Check size={10} /> Active</span>
          </div>

          <div className="zelle-detail-row">
            <ShieldCheck size={16} className="text-green" />
            <div>
              <strong>Settlement Account</strong>
              <small>Checking •••• {account.bankDetails.accountNumber.slice(-4)} (Evolve / Northfield Bank)</small>
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" className="ghost-btn" onClick={onClose}>
            Close
          </button>
          <button type="button" className="solid-btn" onClick={handleCopyTag}>
            <Share2 size={15} /> Share Zelle® QR
          </button>
        </div>
      </div>
    </div>
  );
}
