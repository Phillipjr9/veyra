import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, LayoutDashboard, Menu, X } from "lucide-react";
import { Btn, Logo } from "./common";
import { useAuth } from "../lib/auth";
import { lockScroll } from "../lib/scrollLock";

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
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const unlock = lockScroll();
    return unlock;
  }, [open]);

  return (
    <header className={`site-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="nav-wrap">
        <Logo />
        <nav className="desktop-nav" aria-label="Primary">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? "is-active" : "")}>{n.label}</NavLink>
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
        <button className="menu-button" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-label="Toggle menu">
          {open ? <X /> : <Menu />}
        </button>
      </div>
      <AnimatePresence>
        {open && (
          <motion.nav className="mobile-nav" initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
            {NAV.map(n => <Link key={n.to} to={n.to}>{n.label}<ArrowRight size={18} /></Link>)}
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
          <p>Intelligent everyday and business banking,<br />built for the next move.</p>
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
        <span>© 2026 Veyra Financial, Inc.</span>
        <span>Veyra is a financial technology company, not a bank. Banking services would be provided by partner institutions, Members FDIC.</span>
      </div>
    </footer>
  );
}
