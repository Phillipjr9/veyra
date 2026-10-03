import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  Search, CreditCard, Send, Sparkles, FileText,
  ShieldAlert, ShieldCheck, ArrowRight,
  ArrowDownLeft, Camera, LayoutDashboard,
  Settings as SettingsIcon, PiggyBank, CalendarClock,
  Building2, Users, Award
} from "lucide-react";
import { useAcct, money, shortDate } from "../lib/store";
import { ZelleLogo } from "./MoneyFlow";

type PaletteItem = {
  id: string;
  category: "Navigation" | "Quick Action" | "Transaction";
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
};

export function CommandPalette({
  open,
  onClose,
  onOpenDeposit,
  onOpenCheckDeposit,
  onOpenZelleHub,
  onOpenScout,
}: {
  open: boolean;
  onClose: () => void;
  onOpenDeposit: () => void;
  onOpenCheckDeposit: () => void;
  onOpenZelleHub: () => void;
  onOpenScout: () => void;
}) {
  const navigate = useNavigate();
  const { account, user } = useAcct();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut listener for Cmd+K / Ctrl+K
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [open]);

  const items: PaletteItem[] = useMemo(() => {
    const list: PaletteItem[] = [
      // Quick Actions
      {
        id: "act-zelle",
        category: "Quick Action",
        title: "Send or Receive with Zelle®",
        subtitle: "Instant peer-to-peer transfer",
        icon: <ZelleLogo size={16} />,
        action: () => {
          onClose();
          navigate("/app/transfers");
        },
      },
      {
        id: "act-deposit-check",
        category: "Quick Action",
        title: "Deposit a Check (Mobile Photo)",
        subtitle: "Snap front and endorsed back for instant credit",
        icon: <Camera size={16} />,
        action: () => {
          onClose();
          onOpenCheckDeposit();
        },
      },
      {
        id: "act-add-funds",
        category: "Quick Action",
        title: "Add Funds (Electronic ACH)",
        subtitle: "Pull funds from linked account or card processor",
        icon: <ArrowDownLeft size={16} />,
        action: () => {
          onClose();
          onOpenDeposit();
        },
      },
      {
        id: "act-zelle-qr",
        category: "Quick Action",
        title: "View Zelle® QR Code & Tag",
        subtitle: "Receive payments to your mobile or email",
        icon: <ZelleLogo size={16} />,
        action: () => {
          onClose();
          onOpenZelleHub();
        },
      },
      {
        id: "act-scout-copilot",
        category: "Quick Action",
        title: "Ask Scout AI Financial Copilot",
        subtitle: "Query net worth, spend trends, or vendor rates",
        icon: <Sparkles size={16} />,
        action: () => {
          onClose();
          onOpenScout();
        },
      },
      {
        id: "act-new-card",
        category: "Quick Action",
        title: "Issue Virtual or Metal Card",
        subtitle: "Instant digital debit with merchant locks",
        icon: <CreditCard size={16} />,
        action: () => {
          onClose();
          navigate("/app/cards");
        },
      },

      // Navigation
      {
        id: "nav-overview",
        category: "Navigation",
        title: "Overview Dashboard",
        subtitle: "Checking balance & cash flow analytics",
        icon: <LayoutDashboard size={16} />,
        action: () => {
          onClose();
          navigate("/app");
        },
      },
      {
        id: "nav-cards",
        category: "Navigation",
        title: "Card Fleet & Limits",
        subtitle: "Virtual cards, PINs & physical shipping",
        icon: <CreditCard size={16} />,
        action: () => {
          onClose();
          navigate("/app/cards");
        },
      },
      {
        id: "nav-transfers",
        category: "Navigation",
        title: "Transfers, Wires & Zelle®",
        subtitle: "Send next-day ACH, same-day wires, Zelle",
        icon: <Send size={16} />,
        action: () => {
          onClose();
          navigate("/app/transfers");
        },
      },
      {
        id: "nav-statements",
        category: "Navigation",
        title: "Official Bank Statements",
        subtitle: "Printable certified FDIC vector PDF & CSV",
        icon: <FileText size={16} />,
        action: () => {
          onClose();
          navigate("/app/statements");
        },
      },
      {
        id: "nav-disputes",
        category: "Navigation",
        title: "Disputes & Fraud Resolution",
        subtitle: "File a claim on any card or transfer charge",
        icon: <ShieldAlert size={16} />,
        action: () => {
          onClose();
          navigate("/app/disputes");
        },
      },
      {
        id: "nav-security",
        category: "Navigation",
        title: "Security Center",
        subtitle: "Two-factor auth, sessions & emergency card freeze",
        icon: <ShieldCheck size={16} />,
        action: () => {
          onClose();
          navigate("/app/security");
        },
      },
      {
        id: "nav-accounts",
        category: "Navigation",
        title: "Accounts & Savings Goals",
        subtitle: "Automated pockets and liquidity reserve",
        icon: <PiggyBank size={16} />,
        action: () => {
          onClose();
          navigate("/app/accounts");
        },
      },
      {
        id: "nav-bills",
        category: "Navigation",
        title: "Bills & Scheduled Payments",
        subtitle: "Autopay & recurring calendar obligations",
        icon: <CalendarClock size={16} />,
        action: () => {
          onClose();
          navigate("/app/bills");
        },
      },
      {
        id: "nav-rewards",
        category: "Navigation",
        title: "2% Cash Back Rewards",
        subtitle: "Redeem cash back 1:1 into checking",
        icon: <Award size={16} />,
        action: () => {
          onClose();
          navigate("/app/rewards");
        },
      },
      {
        id: "nav-settings",
        category: "Navigation",
        title: "Account Settings & Profile Picture",
        subtitle: "Edit name, phone, password and 3D clay avatar",
        icon: <SettingsIcon size={16} />,
        action: () => {
          onClose();
          navigate("/app/settings");
        },
      },
      {
        id: "nav-kyc",
        category: "Navigation",
        title: "Identity verification",
        subtitle: "Complete verification to lift account limits",
        icon: <ShieldCheck size={16} />,
        action: () => {
          onClose();
          navigate("/app/kyc");
        },
      },
    ];

    if (user?.accountType === "business") {
      list.push(
        {
          id: "nav-invoices",
          category: "Navigation",
          title: "Invoicing & Receivables",
          subtitle: "Generate and send client invoices",
          icon: <FileText size={16} />,
          action: () => {
            onClose();
            navigate("/app/invoices");
          },
        },
        {
          id: "nav-team",
          category: "Navigation",
          title: "Team Permissions & Cardholders",
          subtitle: "Invite team members and set spend limits",
          icon: <Users size={16} />,
          action: () => {
            onClose();
            navigate("/app/team");
          },
        }
      );
    }

    if (user?.role && user.role !== "user") {
      list.unshift({
        id: "nav-superadmin",
        category: "Quick Action",
        title: "Master Super Admin Console",
        subtitle: "Emergency rail freeze, user directory & balance overrides",
        icon: <Building2 size={16} />,
        action: () => {
          onClose();
          navigate("/app/superadmin");
        },
      });
    }

    // Append matching transactions if search query is typed
    if (account && query.trim().length >= 2) {
      const q = query.toLowerCase().trim();
      const matchingTxns = account.transactions
        .filter(t =>
          t.merchant.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          (t.note || "").toLowerCase().includes(q) ||
          (t.reference || "").toLowerCase().includes(q)
        )
        .slice(0, 5);

      matchingTxns.forEach(t => {
        list.push({
          id: `txn-${t.id}`,
          category: "Transaction",
          title: `${t.merchant} (${t.amount > 0 ? "+" : "−"}${money(Math.abs(t.amount))})`,
          subtitle: `${t.category} · ${shortDate(t.date)} · ${t.method || "Debit"}`,
          icon: <CreditCard size={15} />,
          action: () => {
            onClose();
            navigate("/app/transactions");
          },
        });
      });
    }

    return list;
  }, [user, account, query, navigate, onClose, onOpenDeposit, onOpenCheckDeposit, onOpenZelleHub, onOpenScout]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase().trim();
    return items.filter(
      i =>
        i.title.toLowerCase().includes(q) ||
        (i.subtitle && i.subtitle.toLowerCase().includes(q)) ||
        i.category.toLowerCase().includes(q)
    );
  }, [items, query]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="command-palette-scrim" onClick={onClose}>
      <motion.div
        className="command-palette-box"
        initial={{ opacity: 0, scale: 0.96, y: -16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -16 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="palette-input-bar">
          <Search size={18} className="palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command, jump to a page, or search transactions… (ESC to exit)"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <span className="palette-esc-hint">ESC</span>
        </div>

        <div className="palette-results-list">
          {filteredItems.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={item.id}
                type="button"
                className={`palette-result-item ${isSelected ? "selected" : ""}`}
                onClick={item.action}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="palette-item-icon">{item.icon}</span>
                <div className="palette-item-text">
                  <strong>{item.title}</strong>
                  {item.subtitle && <small>{item.subtitle}</small>}
                </div>
                <span className="palette-cat-badge">{item.category}</span>
                {isSelected && <ArrowRight size={14} className="palette-arrow-icon" />}
              </button>
            );
          })}

          {!filteredItems.length && (
            <div className="palette-empty">
              <Search size={22} />
              <p>No actions, accounts, or transactions found matching "{query}"</p>
            </div>
          )}
        </div>

        <div className="palette-footer">
          <span>Navigate: <b>↑</b> <b>↓</b></span>
          <span>Select: <b>↵ Enter</b></span>
          <span>Close: <b>Esc</b></span>
        </div>
      </motion.div>
    </div>
  );
}
