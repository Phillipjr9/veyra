import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, LayoutDashboard, Menu, X } from "lucide-react";
import { Btn, Logo } from "./common";
import { useAuth } from "../lib/auth";
import { lockScroll } from "../lib/scrollLock";
import { BackButton, canGoBack } from "./BackButton";

const NAV = [
  { label: "Personal", to: "/personal" },
  { label: "Business", to: "/business-account" },
  { label: "Scout AI", to: "/scout" },
  { label: "Pricing", to: "/pricing" },
  { label: "Security", to: "/security" },
  { label: "Support", to: "/support" },
];

export function Header() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { user } = useAuth();
  const { pathname, hash } = useLocation();
  const menuButton = useRef<HTMLButtonElement>(null);
  const navigation = pathname === "/" ? [
    { label: "Personal", to: "/personal" },
    { label: "Business", to: "/business-account" },
    { label: "Digital assets", to: "/#digital-assets" },
    { label: "Security", to: "/security" },
    { label: "Company", to: "/about" },
  ] : NAV;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => { setOpen(false); }, [pathname, hash]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); menuButton.current?.focus(); }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const unlock = lockScroll();
    return unlock;
  }, [open]);

  return (
    <header className={`site-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="nav-wrap">
        <Logo />
        {pathname !== "/" && canGoBack() && <BackButton fallback="/" />}
        <nav className="desktop-nav" aria-label="Primary">
          {navigation.map(n => n.to.includes("#") ? (
            <Link key={n.to} to={n.to} className={hash === "#digital-assets" ? "is-active" : ""} aria-current={hash === "#digital-assets" ? "location" : undefined}>{n.label}</Link>
          ) : (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => isActive ? "is-active" : ""}>{n.label}</NavLink>
          ))}
        </nav>
        <div className="nav-actions">
          {user ? (
            <>
              <div className="nav-user-chip">
                <img
                  src={user.avatarUrl || "/images/avatar-3d-default.svg"}
                  alt=""
                  className="nav-avatar-mini"
                />
                <span className="nav-greeting">Hi, {user.name.split(" ")[0]}</span>
              </div>
              <Btn to="/app"><LayoutDashboard size={15} /> Dashboard</Btn>
            </>
          ) : (
            <>
              <Link className="sign-in" to="/login">Sign in</Link>
              <Btn to="/signup">Open an account</Btn>
            </>
          )}
        </div>
        <button ref={menuButton} type="button" className="menu-button" aria-controls={open ? "marketing-mobile-nav" : undefined} onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label="Toggle menu">
          {open ? <X /> : <Menu />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav id="marketing-mobile-nav" aria-label="Mobile navigation" className="mobile-nav" onClick={event => { if ((event.target as HTMLElement).closest("a")) setOpen(false); }} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
            {navigation.map(n => <Link key={n.to} to={n.to}>{n.label}<ArrowRight size={18} /></Link>)}
            {user
              ? <Btn to="/app">Go to dashboard</Btn>
              : <><Link to="/login">Sign in<ArrowRight size={18} /></Link><Btn to="/signup">Open an account</Btn></>}
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}

export function Footer() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [email, setEmail] = useState("");
  const { user } = useAuth();
  const groups: Array<[string, Array<[string, string]>]> = [
    ["Product", [["Personal account", "/personal"], ["Business account", "/business-account"], ["Cards", "/cards"], ["Payments", "/payments"], ["Invoicing", "/invoicing"], ["Rewards", "/rewards"]]],
    ["Intelligence", [["Scout AI", "/scout"], ["AI CFO", "/ai-cfo"], ["Analytics", "/analytics"], ["Integrations", "/integrations"], ["Pricing", "/pricing"]]],
    ["Company", [["About", "/about"], ["Careers", "/careers"], ["Contact", "/contact"], ["Support", "/support"]]],
    ["Resources", [["Help center", "/help-center"], ["Perks", "/perks"], ["Concierge", "/concierge"], ["Security", "/security"]]],
    ["Legal", [["Privacy", "/legal/privacy"], ["Terms", "/legal/terms"], ["Disclosures", "/legal/disclosures"]]],
  ];
  return (
    <footer>
      <div className="footer-top">
        <div className="footer-brand">
          <Logo inverse />
          <p>{pathname === "/" ? <>Everyday banking. Digital possibilities.<br />Your next chapter starts here.</> : <>Intelligent everyday and business banking,<br />built for the next move.</>}</p>
          {user ? (
            <Link to="/app" className="footer-dashboard-link"><LayoutDashboard size={15} /> Go to dashboard <ArrowRight size={15} /></Link>
          ) : (
            <form className="footer-form" onSubmit={e => { e.preventDefault(); navigate(`/signup?email=${encodeURIComponent(email)}`); }}>
              <input type="email" required placeholder="Email address" aria-label="Email address" value={email} onChange={e => setEmail(e.target.value)} />
              <button type="submit" aria-label="Get started"><ArrowRight size={16} /></button>
            </form>
          )}
        </div>
        <div className="footer-links">
          {groups.map(([title, links]) => (
            <div key={title}>
              <strong>{title}</strong>
              {links.map(([label, to]) => <Link key={label + to} to={to}>{label}</Link>)}
            </div>
          ))}
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Veyra</span>
        <span>Veyra is a financial technology product, not a bank. The current preview uses internal-ledger records; live banking, payment processing, custody and deposit-insurance arrangements are not established by this release. Digital assets are not bank deposits, are not FDIC insured and can lose value.</span>
      </div>
    </footer>
  );
}
