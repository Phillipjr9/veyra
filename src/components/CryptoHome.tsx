import { assetIcon } from "../lib/holdings";
import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion, useInView, useScroll } from "motion/react";
import { ArrowDown, ArrowRight, ArrowUpRight, Bitcoin, Check, ChevronDown, Fingerprint, Globe2, KeyRound, Landmark, Layers3, LockKeyhole, Pause, Play, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth";
import { VeyraMark } from "./VeyraMark";
import { HomeMotionProvider, PageMotionControl, useHomeMotion } from "./home/HomeMotion";
import { OrbitalField } from "./home/OrbitalField";
import { SecurityOrbit } from "./home/SecurityOrbit";
import "../styles/crypto-home.css";
import "../styles/home-motion.css";

function Entrance({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const { reduced, enabled } = useHomeMotion();
  const element = useRef<HTMLDivElement>(null);
  const inView = useInView(element, { amount: .08 });
  return <motion.div ref={element} className={className} data-live={enabled && inView ? "true" : "false"}
    initial={false} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.01 }}
    transition={{ duration: enabled && !reduced ? .7 : 0, delay: enabled && !reduced ? delay : 0, ease: [.22, 1, .36, 1] }}>{children}</motion.div>;
}

function VaultVisual() {
  const stage = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const inView = useInView(stage, { amount: .1 });
  const { reduced, enabled, paused, toggle } = useHomeMotion();
  const moving = enabled && inView;
  return <div className={`vh-vault ${moving ? "is-moving" : "is-still"}`} ref={stage}
    onPointerMove={event => {
      if (!moving || event.pointerType !== "mouse") return;
      const rect = event.currentTarget.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - .5;
      const y = (event.clientY - rect.top) / rect.height - .5;
      pointer.current = { x: x * 2, y: y * 2 };
      event.currentTarget.style.setProperty("--vault-x", `${x * 13}deg`);
      event.currentTarget.style.setProperty("--vault-y", `${y * -10}deg`);
      event.currentTarget.style.setProperty("--light-x", `${(x + .5) * 100}%`);
      event.currentTarget.style.setProperty("--light-y", `${(y + .5) * 100}%`);
    }}
    onPointerLeave={event => {
      pointer.current = { x: 0, y: 0 };
      event.currentTarget.style.setProperty("--vault-x", "0deg"); event.currentTarget.style.setProperty("--vault-y", "0deg");
      event.currentTarget.style.setProperty("--light-x", "50%"); event.currentTarget.style.setProperty("--light-y", "45%");
    }}>
    <div className="vh-vault-grid" aria-hidden="true" />
    <div className="vh-vault-aura" aria-hidden="true" />
    <div className="vh-vault-coordinate" aria-hidden="true">V / 01 <span>DIGITAL ASSET PROTECTION</span></div>
    <div className="vh-vault-perspective"><div className="vh-vault-float">
      <img src="/images/veyra-digital-vault.webp" width="1254" height="1254" alt="Sculpted titanium and lavender-glass Veyra shield surrounded by Bitcoin and Ethereum" fetchPriority="high" />
      <div className="vh-vault-glint" aria-hidden="true" />
    </div></div>
    <OrbitalField active={moving} pointer={pointer} />
    <div className="vh-vault-label vh-vault-label-top"><span className="vh-status-dot" /> Built around security <ShieldCheck size={14} /></div>
    <div className="vh-vault-label vh-vault-label-bottom"><span className="vh-mini-lock"><LockKeyhole size={17} /></span><div>Your assets. Your control.<small>Protection at every layer.</small></div></div>
    <div className="vh-vault-caption"><span><i /> THE VEYRA SECURITY STANDARD</span><button type="button" onClick={toggle} aria-label={reduced ? "Security animation disabled for reduced motion" : paused ? "Play security animation" : "Pause security animation"} aria-pressed={paused} disabled={reduced}>{paused || reduced ? <Play size={12} /> : <Pause size={12} />}</button></div>
    <span className="vh-explore-hint" aria-hidden="true"><span /> MOVE TO EXPLORE</span>
  </div>;
}

const assets = [
  { code: "BTC", name: "Bitcoin", type: "The original digital asset", text: "A new perspective on your money.", description: "Explore Bitcoin alongside your everyday balance. Follow the market, keep track of your holdings, and buy or sell when trading is available for your account.", icon: assetIcon("BTC"), color: "#f7931a", symbol: "₿", fact: "A decentralized network. A finite supply.", tags: ["Bitcoin network", "21M maximum supply"] },
  { code: "ETH", name: "Ethereum", type: "A programmable digital economy", text: "More possibilities. One familiar place.", description: "Discover the asset behind Ethereum’s smart-contract network. Track ETH prices and manage your holdings from the same place you manage your money.", icon: assetIcon("ETH"), color: "#7a78b8", symbol: "Ξ", fact: "The asset powering the Ethereum network.", tags: ["Ethereum network", "Proof of stake"] },
  { code: "SOL", name: "Solana", type: "Built for a connected world", text: "Meet a faster-moving digital world.", description: "Get to know Solana and follow its market. View your SOL holdings alongside your other digital assets, with a clear view of your portfolio.", icon: assetIcon("SOL"), color: "#5e9b89", symbol: "≋", fact: "A network designed for high-throughput applications.", tags: ["Solana network", "Proof of stake"] },
  { code: "USDC", name: "USD Coin", type: "A dollar-referenced stablecoin", text: "Digital assets. A familiar reference.", description: "Explore USDC, a stablecoin designed to track the US dollar. See your USDC holdings in Veyra. Stablecoins carry issuer and depegging risks and are not bank deposits.", icon: assetIcon("USDC"), color: "#347dcc", symbol: "$", fact: "Designed to reference USD. Not a bank deposit.", tags: ["USD-referenced", "Stablecoin"] },
];

function DigitalAssets() {
  const [selected, setSelected] = useState(0);
  const { user } = useAuth();
  const asset = assets[selected];
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % assets.length;
    else if (event.key === "ArrowLeft") next = (index + assets.length - 1) % assets.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = assets.length - 1;
    else return;
    event.preventDefault(); setSelected(next);
    document.getElementById(`vh-asset-tab-${next}`)?.focus();
  }
  return <section id="digital-assets" className="vh-assets vh-container" aria-labelledby="vh-assets-title">
    <Entrance className="vh-section-heading"><div><span className="vh-eyebrow"><span /> A NEW WORLD OF ASSETS</span><h2 id="vh-assets-title">Go beyond the<br />everyday balance.</h2></div><p>Bitcoin is just the beginning. Discover digital assets with the clarity and confidence you expect from Veyra.</p></Entrance>
    <div className="vh-asset-tabs" role="tablist" aria-label="Explore supported digital assets">
      {assets.map((item, index) => <button key={item.code} id={`vh-asset-tab-${index}`} role="tab" type="button" aria-selected={selected === index} aria-controls="vh-asset-panel" tabIndex={selected === index ? 0 : -1} onKeyDown={event => onTabKey(event, index)} onClick={() => setSelected(index)}><span className="vh-token" aria-hidden="true" style={{ background: item.color }}>{item.code === "BTC" ? <Bitcoin size={21} strokeWidth={2} /> : item.symbol}</span><span>{item.name}<small>{item.code}</small></span><ArrowUpRight size={18} /></button>)}
    </div>
    <div id="vh-asset-panel" className="vh-asset-panel" role="tabpanel" aria-labelledby={`vh-asset-tab-${selected}`} tabIndex={0}>
      <div className="vh-asset-copy" key={asset.code}><span className="vh-overline">{asset.type}</span><h3>{asset.text}</h3><p>{asset.description}</p><Link className="vh-link" to={user ? `/app/markets?asset=${asset.code}` : "/signup"}>{user ? `Explore ${asset.name} markets` : "Start your Veyra journey"}<ArrowRight size={17} /></Link><div className="vh-asset-tags">{asset.tags.map(tag => <span key={tag}>{tag}</span>)}</div></div>
      <Entrance className="vh-coin-display"><div className="vh-coin-atmosphere" aria-hidden="true" /><div className="vh-coin-orbit" aria-hidden="true"><i /></div><div className="vh-coin-orbit vh-coin-orbit-two" aria-hidden="true"><i /></div><span className="vh-coin-code" aria-hidden="true">{asset.code}</span><div className="vh-coin-float" aria-hidden="true"><img key={asset.code} src={asset.icon} alt="" loading="lazy" width="320" height="320" /></div><span className="vh-coin-footnote">{asset.fact}</span></Entrance>
    </div>
    <p className="vh-disclosure">Digital-asset trading is subject to account eligibility, regional availability, and service activation. Crypto is not FDIC insured and can lose value.</p>
  </section>;
}

const protections = [
  { icon: Fingerprint, title: "A stronger way to sign in", text: "Use passkeys and two-factor authentication to add protection beyond a password. Review your active sessions and stay in control of account access.", label: "IDENTITY VERIFIED", to: "/security" },
  { icon: KeyRound, title: "Control where it matters", text: "Manage account access with role-based permissions. Give your team the access they need, without giving everyone control over everything.", label: "ACCESS CONTROLLED", to: "/security" },
  { icon: Layers3, title: "Clarity at every step", text: "Follow your transaction history and account activity in one place. Built-in audit trails make important actions traceable and easier to review.", label: "ACTIVITY RECORDED", to: "/security" },
];
function SecurityShowcase() {
  const [active, setActive] = useState(0);
  const Icon = protections[active].icon;
  return <section className="vh-security" aria-labelledby="vh-security-title"><div className="vh-container vh-security-grid">
    <Entrance className={`vh-security-art vh-protection-${active}`}><SecurityOrbit /><span className="vh-security-cross vh-security-cross-one">+</span><span className="vh-security-cross vh-security-cross-two">+</span>
      <div className="vh-shield-stack" aria-hidden="true"><div className="vh-shield-layer vh-shield-back" /><div className="vh-shield-layer vh-shield-mid" /><div className="vh-shield-layer vh-shield-front"><span className="vh-shield-icon" key={active}><Icon size={61} strokeWidth={1} /></span><span>VEYRA</span></div></div>
      <div className="vh-security-status"><span className="vh-status-dot" />{protections[active].label}</div><span className="vh-security-art-label">SECURITY ISN’T A FEATURE. IT’S THE FOUNDATION.</span>
    </Entrance>
    <Entrance className="vh-security-copy"><span className="vh-eyebrow"><span /> CONFIDENCE, BUILT IN</span><h2 id="vh-security-title">Forward-thinking.<br />Security-first.</h2><p>Your next move deserves a strong foundation. We bring thoughtful safeguards to your everyday finances and digital-asset experience.</p>
      <div className="vh-security-controls">{protections.map((item, index) => <div className={`vh-security-control ${active === index ? "is-active" : ""}`} key={item.title}><button type="button" aria-expanded={active === index} aria-controls={`vh-protection-${index}`} onClick={() => setActive(index)}><span>0{index + 1}</span>{item.title}<ChevronDown size={18} /></button><div id={`vh-protection-${index}`} hidden={active !== index}><p>{item.text}</p></div></div>)}</div>
      <Link className="vh-link" to="/security">Inside Veyra security<ArrowRight size={17} /></Link>
    </Entrance>
  </div></section>;
}

const faqs = [
  ["Can I manage Bitcoin with Veyra?", "Veyra’s digital-asset experience supports Bitcoin (BTC), Ethereum (ETH), Solana (SOL), and USD Coin (USDC). You can view holdings and follow markets. Buying and selling depend on account eligibility, your region, and whether trading has been activated. Opening an account does not guarantee access to trading."],
  ["How do banking and crypto work together?", "Veyra brings your everyday accounts, payments, and digital-asset holdings into one interface. Cash balances and crypto holdings remain distinct. Crypto is not a bank deposit, and it does not receive the same protections as eligible bank deposits."],
  ["How does Veyra help protect my account?", "Veyra supports passkeys, two-factor authentication, session management, role-based access, and account activity records. These controls help protect access, but no system eliminates all risks. Visit our Security page to learn more."],
  ["Are cryptocurrency holdings FDIC insured?", "No. Bitcoin and other digital assets, including stablecoins, are not FDIC insured, are not guaranteed by a bank or government, and can lose value. Stablecoins also carry issuer and depegging risks. Consider your financial circumstances and the risks before buying."],
];

function CryptoHomeContent() {
  const { user } = useAuth();
  const { enabled, reduced } = useHomeMotion();
  const { scrollYProgress } = useScroll();
  return <main className="veyra-home" id="main-content" tabIndex={-1} data-motion={enabled ? "running" : "paused"} data-reduced={reduced ? "true" : "false"}>
    <motion.div className="vh-reading-progress" aria-hidden="true" style={{ scaleX: scrollYProgress }} />
    <section className="vh-hero vh-container" aria-labelledby="vh-hero-title">
      <Entrance className="vh-hero-copy"><Link to="/#digital-assets" className="vh-announcement"><span className="vh-status-dot" /> YOUR NEXT CHAPTER IN FINANCE <ArrowUpRight size={13} /></Link><h1 id="vh-hero-title">Your money.<br />Your Bitcoin.<br /><span className="vh-title-luster">One secure home.</span></h1><p>Everyday banking meets the world of crypto.<br className="vh-desktop-break" /> Bring your cash, Bitcoin, and digital assets together—with security at the heart of it all.</p><div className="vh-hero-actions"><Link className="vh-button" to={user ? "/app" : "/signup"}>{user ? "Go to dashboard" : "Open an account"}<ArrowUpRight size={18} /></Link><Link className="vh-secondary" to="/#digital-assets">Explore crypto <ArrowRight size={17} /></Link></div><div className="vh-hero-note"><ShieldCheck size={15} /><span>A smarter home for traditional & digital finance.</span></div></Entrance>
      <Entrance className="vh-hero-art" delay={.15}><VaultVisual /></Entrance>
      <div className="vh-hero-bottom"><span>BANKING, REIMAGINED FOR WHAT’S NEXT.</span><Link to="/#possibilities">A world of possibilities <ArrowDown size={14} /></Link></div>
    </section>
    <div className="vh-trust-strip"><div className="vh-container"><span><Landmark /> Everyday banking</span><span><Bitcoin /> Bitcoin & digital assets</span><span><ShieldCheck /> Security-first by design</span><span><Globe2 /> Built for your next move</span></div></div>
    <section id="possibilities" className="vh-possibilities vh-container" aria-labelledby="vh-possibilities-title">
      <Entrance className="vh-section-heading"><div><span className="vh-eyebrow"><span /> ONE PLATFORM. MORE POSSIBILITY.</span><h2 id="vh-possibilities-title">A familiar foundation.<br />An entirely new perspective.</h2></div><p>Not a choice between traditional and digital.<br />A better way to bring them together.</p></Entrance>
      <div className="vh-product-grid">
        <Entrance className="vh-product-card vh-banking-card"><div className="vh-card-topline"><span>01 / EVERYDAY</span><Landmark size={20} /></div><div className="vh-product-visual vh-bank-visual" aria-hidden="true"><div className="vh-bank-card"><div><VeyraMark /><span>veyra</span><span className="vh-card-contactless">)))</span></div><div className="vh-chip" /><span className="vh-card-number">••••  2048</span><small>YOUR EVERYDAY. ELEVATED.</small></div><div className="vh-payment-pill"><span><Check size={13} /></span>Made for your everyday.</div></div><h3>Bank on your terms.</h3><p>Personal and business accounts, intuitive payments, and cards that keep up with you.</p><Link className="vh-link" to="/personal">Discover banking <ArrowUpRight size={17} /></Link></Entrance>
        <Entrance className="vh-product-card vh-crypto-card" delay={.08}><div className="vh-card-topline"><span>02 / DIGITAL ASSETS</span><Bitcoin size={20} /></div><div className="vh-product-visual vh-token-visual" aria-hidden="true"><span className="vh-token-ring" /><img className="vh-product-bitcoin" src={assetIcon("BTC")} alt="" loading="lazy" width="175" height="175" /><img className="vh-product-ethereum" src={assetIcon("ETH")} alt="" loading="lazy" width="125" height="125" /><span className="vh-token-spark">+</span></div><h3>Make room for crypto.</h3><p>Bitcoin, Ethereum, and beyond. A clear view of your digital assets, right beside your cash.</p><Link className="vh-link" to="/#digital-assets">Explore digital assets <ArrowUpRight size={17} /></Link></Entrance>
        <Entrance className="vh-product-card vh-business-card" delay={.16}><div className="vh-card-topline"><span>03 / INTELLIGENCE</span><Sparkles size={20} /></div><div className="vh-product-visual vh-scout-visual" aria-hidden="true"><div className="vh-scout-orb"><Sparkles size={47} strokeWidth={1} /></div><div className="vh-scout-line"><span /><span /><span /><span /><span /><span /><span /></div><span className="vh-scout-badge">Meet Scout AI <Sparkles size={12} /></span></div><h3>Stay one move ahead.</h3><p>Less busywork. More perspective. Meet the financial intelligence built into your day.</p><Link className="vh-link" to="/scout">Meet your advantage <ArrowUpRight size={17} /></Link></Entrance>
      </div>
    </section>
    <DigitalAssets />
    <SecurityShowcase />
    <section className="vh-faq vh-container" aria-labelledby="vh-faq-title"><Entrance><span className="vh-eyebrow"><span /> A LITTLE MORE CLARITY</span><h2 id="vh-faq-title">Good questions.<br />Clear answers.</h2><p>A new world shouldn’t feel unfamiliar.</p><Link className="vh-link" to="/support">Talk to our team <ArrowUpRight size={17} /></Link></Entrance><div className="vh-faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{answer}</p></details>)}</div></section>
    <section className="vh-final-cta"><div className="vh-container"><Entrance className="vh-cta-mark"><VeyraMark /></Entrance><Entrance><span className="vh-eyebrow">YOUR MONEY. MORE POSSIBILITIES.</span><h2>Your next chapter<br />starts here.</h2><p>Everyday banking. Digital assets. A clearer way forward.</p><Link className="vh-button" to={user ? "/app" : "/signup"}>{user ? "Go to dashboard" : "Make your move"}<ArrowUpRight size={18} /></Link></Entrance><span className="vh-cta-fineprint">Veyra is a financial technology company, not a bank.<br />Digital-asset services are subject to availability. Capital at risk.</span></div></section>
    <PageMotionControl />
  </main>;
}

export default function CryptoHome() {
  return <HomeMotionProvider><CryptoHomeContent /></HomeMotionProvider>;
}
