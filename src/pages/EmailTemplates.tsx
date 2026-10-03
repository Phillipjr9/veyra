import { useMemo, useState } from "react";
import { Monitor, Smartphone, Copy, ExternalLink, Info } from "lucide-react";
import { emailTemplates, emailCategories, type EmailCategory } from "../emails/templates";
import { useToast } from "../components/Toast";
import "../styles/emails.css";

const CATEGORY_COLORS: Record<EmailCategory, string> = {
  security: "#9d4040",
  transfers: "#2f7a4c",
  cards: "#7558dc",
  invoices: "#8a6420",
  scout: "#aa95ed",
  account: "#443173",
};

const CATEGORY_ORDER: EmailCategory[] = ["security", "transfers", "cards", "invoices", "scout", "account"];

/**
 * Public gallery of the transactional email templates defined in src/emails.
 * Mirrors the app's design tokens (Manrope / DM Sans, paper + violet palette)
 * so product, design and engineering can review notifications side by side.
 */
export function EmailTemplatesPage() {
  const [filter, setFilter] = useState<EmailCategory | "all">("all");
  const [activeId, setActiveId] = useState(emailTemplates[0].id);
  const [mobile, setMobile] = useState(false);
  const toast = useToast();

  const filtered = useMemo(
    () => emailTemplates.filter(t => filter === "all" || t.category === filter),
    [filter],
  );
  const grouped = useMemo(
    () =>
      CATEGORY_ORDER.map(cat => ({ cat, items: filtered.filter(t => t.category === cat) }))
        .filter(g => g.items.length > 0),
    [filtered],
  );

  const active = emailTemplates.find(t => t.id === activeId) ?? emailTemplates[0];

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(active.html);
      toast({ tone: "success", title: "HTML copied", description: `Markup for “${active.name}” is on your clipboard.` });
    } catch {
      toast({ tone: "error", title: "Copy blocked", description: "Your browser denied clipboard access — use “Open” instead." });
    }
  };

  const openStandalone = () => {
    const blob = new Blob([active.html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank", "noopener");
  };

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Design system</span>
          <h1>Email notifications</h1>
          <p>
            Every transactional email Veyra sends — {emailTemplates.length} templates across security, transfers,
            cards, invoicing, Scout and account lifecycle — built on the same tokens as the app.
          </p>
        </div>
      </header>

      <section className="section email-studio" style={{ paddingTop: 0 }}>
        <div className="email-toolbar">
          <div className="email-filter-row">
            {emailCategories.map(c => (
              <button
                key={c.id}
                type="button"
                className={`email-chip ${filter === c.id ? "on" : ""}`}
                onClick={() => setFilter(c.id)}
              >
                {c.label}
                <i>{c.id === "all" ? emailTemplates.length : emailTemplates.filter(t => t.category === c.id).length}</i>
              </button>
            ))}
          </div>
          <div className="email-view-toggle" role="group" aria-label="Preview width">
            <button type="button" className={!mobile ? "on" : ""} onClick={() => setMobile(false)}>
              <Monitor size={14} /> Desktop
            </button>
            <button type="button" className={mobile ? "on" : ""} onClick={() => setMobile(true)}>
              <Smartphone size={14} /> Mobile
            </button>
          </div>
        </div>

        <div className="email-grid">
          <nav className="email-list" aria-label="Email templates">
            {grouped.map(({ cat, items }) => (
              <div key={cat}>
                <div className="email-group-label">
                  <span className="email-dot" style={{ background: CATEGORY_COLORS[cat] }} />
                  {cat}
                </div>
                {items.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`email-item ${t.id === active.id ? "on" : ""}`}
                    onClick={() => setActiveId(t.id)}
                  >
                    <strong>{t.name}</strong>
                    <span>{t.subject}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="email-preview">
            <div className="email-preview-head">
              <div className="email-preview-meta">
                <span className="cat">
                  <span className="email-dot" style={{ background: CATEGORY_COLORS[active.category] }} />
                  {active.category} &#183; {active.id}
                </span>
                <span className="subj">{active.subject}</span>
                <span className="pre">{active.preheader}</span>
              </div>
              <div className="email-actions">
                <button type="button" className="email-mini-btn" onClick={copyHtml}>
                  <Copy size={13} /> Copy HTML
                </button>
                <button type="button" className="email-mini-btn primary" onClick={openStandalone}>
                  <ExternalLink size={13} /> Open
                </button>
              </div>
            </div>
            <div className="email-frame-wrap">
              <iframe
                key={active.id + (mobile ? "-m" : "-d")}
                title={`${active.name} email preview`}
                className={`email-frame ${mobile ? "mobile" : ""}`}
                srcDoc={active.html}
                sandbox=""
              />
            </div>
          </div>
        </div>

        <div className="email-footnote">
          <Info size={16} />
          <span>
            Templates live in <code>src/emails/</code> (design tokens in <code>design.ts</code>, templates in{" "}
            <code>templates.ts</code>) and render with the product palette — Manrope for headings, DM Sans for body,
            violet <code>#7558dc</code> accents on paper <code>#f5f2eb</code>. Fonts are web-linked with system
            fallbacks for email clients that block web fonts; exported HTML files sit in <code>emails/</code> for
            hand-off to your sending provider.
          </span>
        </div>
      </section>
    </>
  );
}
