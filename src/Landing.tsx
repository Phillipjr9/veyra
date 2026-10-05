import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useInView, useScroll, useTransform } from "motion/react";
import {
  ArrowRight, BadgeCheck, BarChart3, Bot, Check, ChevronDown, CircleDollarSign,
  Cloud, CreditCard, Headphones, Landmark, ReceiptText, Send, ShieldCheck,
  Sparkles, TrendingUp, WalletCards, Zap, LockKeyhole
} from "lucide-react";
import { AnimatedMoney, Btn, Logo, Reveal, ease } from "./components/common";
import { useAuth } from "./lib/auth";

const txns = [
  { icon: "F", name: "Fable Cloud", meta: "Software", amount: "-$218.00", reward: "+$17.44" },
  { icon: "N", name: "Northstar Ads", meta: "Advertising", amount: "-$1,240.50", reward: "+$49.62" },
  { icon: "O", name: "Orbit Mobile", meta: "Utilities", amount: "-$92.00", reward: "+$3.68" },
];

function MiniChart() {
  return (
    <svg className="mini-chart" viewBox="0 0 280 90" preserveAspectRatio="none" aria-label="Balance growth chart">
      <defs><linearGradient id="chartfill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#9d86ff" stopOpacity=".45" /><stop offset="1" stopColor="#9d86ff" stopOpacity="0" /></linearGradient></defs>
      <path d="M0 75C23 72 30 55 50 59S79 66 96 48s29-4 45-15 31 12 51-4 32-3 45-16 28-2 43-11V90H0Z" fill="url(#chartfill)" />
      <motion.path d="M0 75C23 72 30 55 50 59S79 66 96 48s29-4 45-15 31 12 51-4 32-3 45-16 28-2 43-11" fill="none" stroke="#7b61e8" strokeWidth="2.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.8, delay: .8, ease }} />
    </svg>
  );
}

function HeroFinancialUI() {
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, .25], [0, 65]);
  return (
    <motion.div className="hero-ui" initial={{ opacity: 0, y: 55, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 1, delay: .35, ease }}>
      <motion.div className="hero-ui-inner" style={{ y }}>
      <div className="dashboard-shell">
        <aside className="dash-side">
          <Logo compact to={null} />
          <div className="side-icons"><span className="active"><BarChart3 /></span><span><WalletCards /></span><span><ReceiptText /></span><span><Send /></span></div>
          <span className="avatar">RK</span>
        </aside>
        <div className="dash-main">
          <div className="dash-head"><div><span>Good morning, Rae</span><h3>Overview</h3></div><button aria-label="Notifications"><Sparkles size={18} /></button></div>
          <div className="balance-grid">
            <div className="balance-block"><span>Total balance</span><strong>$96,412.08</strong><small><TrendingUp size={13} /> 8.4% this month</small><MiniChart /></div>
            <div className="reward-block"><span>Rewards earned</span><strong>$4,628.20</strong><div className="reward-orb"><Sparkles /></div><small>+$174.50 today</small></div>
          </div>
          <div className="transactions">
            <div className="table-title"><strong>Recent activity</strong><span>View all</span></div>
            {txns.map((t, i) => (
              <motion.div className="transaction" key={t.name} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .9 + i * .12 }}>
                <span className="merchant-icon">{t.icon}</span>
                <span className="merchant"><strong>{t.name}</strong><small>{t.meta}</small></span>
                <span className="txn-amount"><strong>{t.amount}</strong><small>{t.reward} saved</small></span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
      <motion.div className="savings-toast" animate={{ y: [0, 7, 0] }} transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}>
        <span><BadgeCheck /></span><div><small>Scout found savings</small><strong>+$174.50 at Northstar Ads</strong></div>
      </motion.div>
      </motion.div>
    </motion.div>
  );
}

const RATES: Record<string, number> = { Advertising: .055, Software: .05, Travel: .04, "General business": .03 };

function HeroCalculator() {
  const [spend, setSpend] = useState(12500);
  const [category, setCategory] = useState("Advertising");
  const annual = spend * RATES[category] * 12;
  return (
    <motion.div className="hero-calc" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .8, delay: .4, ease }}>
      <div className="hero-calc-form">
        <label htmlFor="hero-cat">Top spend category</label>
        <div className="select-wrap"><select id="hero-cat" value={category} onChange={e => setCategory(e.target.value)}>{Object.keys(RATES).map(x => <option key={x}>{x}</option>)}</select><ChevronDown /></div>
        <label htmlFor="hero-spend">Monthly business spend <output>${spend.toLocaleString()}</output></label>
        <input id="hero-spend" type="range" min="1000" max="100000" step="500" value={spend} onChange={e => setSpend(Number(e.target.value))} style={{ "--range": `${(spend - 1000) / 990}%` } as React.CSSProperties} />
      </div>
      <div className="hero-calc-result"><div className="calc-glow" /><span>Earn up to</span><div><AnimatedMoney value={annual} /><small>/ year</small></div></div>
    </motion.div>
  );
}

export function Hero() {
  const { user } = useAuth();
  return (
    <section id="top" className="hero">
      <div className="hero-glow" />
      <div className="hero-editorial" aria-hidden="true">
        <img src="/images/veyra-hero-editorial.jpg" alt="" fetchPriority="high" />
      </div>
      <div className="hero-copy">
        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7 }}>
          <Logo compact to={null} /><span className="eyebrow">AI-powered operating cash</span>
        </motion.div>
        <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .8, delay: .08, ease }}>Turn every payment<br /><em>into a smarter move.</em></motion.h1>
        <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7, delay: .18 }}>Veyra brings your accounts, rewards, and spending intelligence together so you can move cash faster and save more without the busywork.</motion.p>
        <motion.div className="hero-actions" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .28 }}>
          <Btn to={user ? "/app" : "/signup"}>{user ? "Go to dashboard" : "Build my account"}</Btn>
          <Link to="/platform" className="text-link">See the platform <ArrowRight size={15} /></Link>
        </motion.div>
        <HeroCalculator />
      </div>
      <HeroFinancialUI />
    </section>
  );
}

const saves = [
  { who: "Maya", amount: "$21.50", merchant: "Fable Cloud", hue: "#c9b8ff", avatar: "https://images.pexels.com/photos/33369429/pexels-photo-33369429.jpeg?auto=compress&cs=tinysrgb&w=120&h=120&fit=crop" },
  { who: "Jonah", amount: "$52", merchant: "Pixelforge", hue: "#ffd3b4", avatar: "https://images.pexels.com/photos/31422830/pexels-photo-31422830.png?auto=compress&cs=tinysrgb&w=120&h=120&fit=crop" },
  { who: "Priya", amount: "$473", merchant: "Northstar Ads", hue: "#b8e6cf", avatar: "https://images.pexels.com/photos/19537356/pexels-photo-19537356.jpeg?auto=compress&cs=tinysrgb&w=120&h=120&fit=crop" },
  { who: "Leo", amount: "65% off", merchant: "Helpdesk Pro", hue: "#ffc9d9", avatar: "https://images.pexels.com/photos/36434829/pexels-photo-36434829.jpeg?auto=compress&cs=tinysrgb&w=120&h=120&fit=crop" },
  { who: "Sam", amount: "$200", merchant: "Searchlight Ads", hue: "#cfe3ff", avatar: "https://images.pexels.com/photos/27412592/pexels-photo-27412592.jpeg?auto=compress&cs=tinysrgb&w=120&h=120&fit=crop" },
  { who: "Owen", amount: "$150.40", merchant: "Canvas Studio", hue: "#f3e2a8", avatar: "https://images.pexels.com/photos/7620622/pexels-photo-7620622.jpeg?auto=compress&cs=tinysrgb&w=120&h=120&fit=crop" },
];

export function Ticker() {
  return (
    <div className="ticker">
      <motion.div animate={{ x: ["0%", "-50%"] }} transition={{ duration: 30, repeat: Infinity, ease: "linear" }}>
        {[...saves, ...saves].map((s, i) => (
          <span className="save-chip" key={i}>
            <span className="save-avatar" style={{ "--avatar-bg": s.hue } as React.CSSProperties}>
              <i>{s.who[0]}</i>
              <img src={s.avatar} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = "none"; }} />
            </span>
            {s.who} saved <b>{s.amount}</b> at <b>{s.merchant}</b>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

export function FeatureOverview() {
  return (
    <section id="platform" className="section features-section">
      <Reveal className="section-heading centered">
        <span className="kicker">Built for momentum</span>
        <h2>Less financial admin.<br />More forward motion.</h2>
        <p>Banking, cards, rewards and intelligence in one considered system.</p>
      </Reveal>
      <div className="feature-grid">
        <Reveal className="feature feature-wide">
          <div className="feature-copy"><span className="feature-icon"><CircleDollarSign /></span><h3>Rewards without ceilings</h3><p>Earn on every eligible purchase with no confusing categories or quarterly limits.</p><Link to="/rewards" className="text-link">How rewards work <ArrowRight size={14} /></Link></div>
          <div className="feature-art-container">
            <img src="/images/illo-rewards-2percent.jpg" alt="2% unlimited cash back rewards illustration" className="feature-art-img" loading="lazy" />
          </div>
        </Reveal>
        <Reveal className="feature feature-card">
          <div className="feature-copy"><span className="feature-icon"><CreditCard /></span><h3>Cards with control</h3><p>Create a virtual card in seconds, set its rules, then stay in control.</p><Link to="/cards" className="text-link">Explore cards <ArrowRight size={14} /></Link></div>
          <div className="feature-art-container card-feature-art">
            <img src="/images/illo-cards-control.jpg" alt="Cards with custom controls illustration" className="feature-art-img" loading="lazy" />
          </div>
        </Reveal>
        <Reveal className="feature feature-analytics">
          <div className="feature-copy"><span className="feature-icon"><BarChart3 /></span><h3>Know where money goes</h3><p>Clean, live analytics make every decision easier.</p><Link to="/analytics" className="text-link">Explore analytics <ArrowRight size={14} /></Link></div>
          <div className="analytics-viz"><div className="donut"><span>36%</span></div><ul><li><i />Software <b>$8.2k</b></li><li><i />Advertising <b>$5.9k</b></li><li><i />Operations <b>$3.1k</b></li></ul></div>
        </Reveal>
      </div>
    </section>
  );
}

const scoutSteps = [
  {
    title: "Scout monitors every transaction", text: "Every dollar you spend is tracked to surface the best opportunities for cash back.",
    visual: <div className="scout-card"><div className="scout-card-head"><strong>Last transactions</strong><span>Subscriptions card •••• 2903</span></div>{[["Pixelforge", "-$256.00"], ["Northstar Ads", "-$480.50"], ["Streamline", "-$125.50"], ["Fable Cloud", "-$374.30"]].map(([n, a], i) => <motion.div className="scout-row" key={n} initial={{ opacity: 0, x: 14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * .12 }}><i>{n[0]}</i><span>{n}</span><b>{a}</b></motion.div>)}</div>
  },
  {
    title: "AI works behind the scenes", text: "Scout negotiates discounts, promo codes, retention offers and bulk pricing directly with merchants on every purchase.",
    visual: (
      <div className="scout-art-card-composite">
        <div className="scout-card scout-dark">
          <div className="scout-amount"><strong>-$480.56</strong><span>Northstar Ads spending</span></div>
          <div className="scout-loading"><span className="live-dot" /> Getting lower rates…</div>
          {["Available discounts…", "Special offers…", "Retention pricing…"].map((t, i) => (
            <motion.div className="scout-pill" key={t} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: .3 + i * .18 }}>
              <Sparkles /> {t}
            </motion.div>
          ))}
        </div>
        <div className="scout-scanner-art-badge">
          <img src="/images/illo-scout-scanners.jpg" alt="Scout AI autonomous merchant discount scanner" loading="lazy" />
        </div>
      </div>
    )
  },
  {
    title: "Enjoy the money back", text: "Let Scout do its work and watch cash back land in your balance automatically.",
    visual: <div className="scout-card"><div className="scout-offer"><span>NORTH0524</span><b>+$24.50</b></div><div className="scout-offer"><span>Small business offer</span><b>+$150.00</b></div><motion.div className="scout-saved" initial={{ scale: .9, opacity: 0 }} whileInView={{ scale: 1, opacity: 1 }} viewport={{ once: true }} transition={{ delay: .4, type: "spring" }}>You saved +$174.50</motion.div><div className="scout-final"><s>-$480.56</s><strong>-$306.06</strong><span>Northstar Ads spending</span></div></div>
  },
];

export function ScoutSteps() {
  return (
    <section className="section scout-steps">
      <Reveal className="section-heading centered"><span className="kicker">Automated cash back</span><h2>Put more money back<br />in your pocket with Scout.</h2></Reveal>
      {scoutSteps.map((s, i) => (
        <Reveal className={`scout-step ${i % 2 ? "reverse" : ""}`} key={s.title}>
          <div className="scout-visual">{s.visual}</div>
          <div className="scout-text"><span className="step-num">0{i + 1}</span><h3>{s.title}</h3><p>{s.text}</p></div>
        </Reveal>
      ))}
    </section>
  );
}

const aiSteps = [
  ["Transaction detected", "Northstar Ads", "-$1,240.50"],
  ["Merchant analyzed", "Ad platform renewal", "Matched"],
  ["Savings identified", "Annual commitment", "12% lower"],
  ["Offer discovered", "Growth business rate", "+$148.86"],
  ["Savings applied", "Returned to balance", "+$148.86"],
];

export function AISavingsSection() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: false, margin: "-30%" });
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!inView) return;
    setActive(0);
    const id = setInterval(() => setActive(v => (v + 1) % aiSteps.length), 1450);
    return () => clearInterval(id);
  }, [inView]);
  return (
    <section id="scout" className="ai-section section" ref={ref}>
      <Reveal className="ai-copy">
        <span className="kicker kicker-light">Veyra Scout</span>
        <h2>An extra set of eyes<br />on every transaction.</h2>
        <p>Scout analyzes purchases, discovers better rates and applies savings while you focus on your business.</p>
        <div className="ai-proof"><Bot /><span><strong>Always monitoring</strong><small>Private, secure and fully automatic</small></span></div>
        <div className="ai-cta"><Btn to="/scout" light>See how Scout works</Btn></div>
      </Reveal>
      <div className="ai-console">
        <div className="console-head"><div><span className="live-dot" /> Scout is working</div><small>Live</small></div>
        <div className="ai-flow">
          {aiSteps.map((step, i) => (
            <motion.div className={`ai-step ${i === active ? "active" : ""} ${i < active ? "complete" : ""}`} key={step[0]} animate={{ opacity: i <= active ? 1 : .36, x: i === active ? 7 : 0 }}>
              <span className="step-status">{i < active ? <Check /> : i === active ? <Sparkles /> : i + 1}</span>
              <div><small>{step[0]}</small><strong>{step[1]}</strong></div><b>{step[2]}</b>
            </motion.div>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div className="ai-total" key={active} initial={{ opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <span>Scout savings this month</span><strong>${active === 4 ? "482.30" : "333.44"}</strong>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

const CALC_RATES: Record<string, number> = { Advertising: .045, Software: .04, Travel: .035, "General business": .025 };

export function RewardsCalculator() {
  const [spend, setSpend] = useState(18000);
  const [category, setCategory] = useState("Advertising");
  const monthly = spend * CALC_RATES[category];
  return (
    <section id="rewards" className="calculator-section section">
      <Reveal className="section-heading"><span className="kicker">Rewards calculator</span><h2>See what your spend<br />could give back.</h2><p>Move the numbers. Veyra makes every payment an opportunity.</p></Reveal>
      <Reveal className="calculator">
        <div className="calc-controls">
          <label htmlFor="calc-spend">Monthly business spend <output>${spend.toLocaleString()}</output></label>
          <input id="calc-spend" type="range" min="1000" max="100000" step="500" value={spend} onChange={e => setSpend(Number(e.target.value))} style={{ "--range": `${(spend - 1000) / 990}%` } as React.CSSProperties} />
          <label htmlFor="category">Top spend category</label>
          <div className="select-wrap"><select id="category" value={category} onChange={e => setCategory(e.target.value)}>{Object.keys(CALC_RATES).map(x => <option key={x}>{x}</option>)}</select><ChevronDown /></div>
          <div className="rate-note"><BadgeCheck /> Estimated reward rate <strong>{(CALC_RATES[category] * 100).toFixed(1)}%</strong></div>
          <Btn to="/signup" className="calc-cta">Start earning this rate</Btn>
        </div>
        <div className="calc-result">
          <span>Estimated annual value</span>
          <AnimatedMoney value={monthly * 12} />
          <p><strong>${Math.round(monthly).toLocaleString()}</strong> every month, automatically returned to your account.</p>
          <div className="calc-bars">{[.52, .68, .62, .8, .74, .92, .87, 1].map((h, i) => <motion.i key={i} initial={{ scaleY: 0 }} whileInView={{ scaleY: h }} viewport={{ once: true }} transition={{ delay: i * .05 }} />)}</div>
        </div>
      </Reveal>
    </section>
  );
}

export function BusinessTools() {
  const tools = [
    {
      icon: <Landmark />,
      title: "Business account",
      text: "Send ACH and wires, organize cash and move at business speed.",
      to: "/business-account",
      visual: (
        <div className="tool-art-wrapper">
          <img src="/images/illo-business-account.jpg" alt="Veyra business account checking illustration" className="tool-art-image" loading="lazy" />
        </div>
      )
    },
    {
      icon: <ReceiptText />,
      title: "Invoices that get paid",
      text: "Create a polished invoice and track every payment from one place.",
      to: "/invoicing",
      visual: (
        <div className="tool-art-wrapper">
          <img src="/images/illo-invoicing.jpg" alt="Invoices and customer payments illustration" className="tool-art-image" loading="lazy" />
        </div>
      )
    },
    {
      icon: <Cloud />,
      title: "Your tools, connected",
      text: "Sync accounting, payroll and the systems your business already trusts.",
      to: "/integrations",
      visual: (
        <div className="tool-art-wrapper">
          <img src="/images/illo-integrations.jpg" alt="Software integrations cloud illustration" className="tool-art-image" loading="lazy" />
        </div>
      )
    },
    {
      icon: <Zap />,
      title: "Free domestic ACH and wires",
      text: "Move money without per-transfer fees eating into margin.",
      to: "/payments",
      visual: (
        <div className="tool-art-wrapper">
          <img src="/images/illo-transfers.jpg" alt="Lightning fast free ACH and domestic wire transfers" className="tool-art-image" loading="lazy" />
        </div>
      )
    },
    {
      icon: <Bot />,
      title: "AI CFO",
      text: "Accounting, categorization and cash projections generated for you.",
      to: "/ai-cfo",
      visual: (
        <div className="tool-art-wrapper cfo-art-wrapper">
          <img src="/images/illo-ai-cfo.jpg" alt="AI CFO financial intelligence assistant illustration" className="tool-art-image" loading="lazy" />
        </div>
      )
    },
  ];
  return (
    <section className="section tools-section">
      <Reveal className="section-heading"><span className="kicker">More than a card</span><h2>One calm place to<br />run your finances.</h2></Reveal>
      <div className="tools-grid">
        {tools.map((t, i) => (
          <Reveal className={`tool tool-${i}`} key={t.title}>
            <div className="tool-visual">{t.visual}</div>
            <div className="tool-copy"><span>{t.icon}</span><h3>{t.title}</h3><p>{t.text}</p><Link to={t.to} className="text-link">Learn more <ArrowRight size={14} /></Link></div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function SecuritySection() {
  return (
    <section id="security" className="security-section section">
      <Reveal className="security-visual">
        <div className="shield-orbit"><ShieldCheck /><i /><i /><i /></div>
        <div className="secure-card"><LockKeyhole /><span><strong>Payment protected</strong><small>Real-time fraud monitoring</small></span><Check /></div>
      </Reveal>
      <Reveal className="security-copy">
        <span className="kicker">Security by design</span>
        <h2>Protected at every layer.</h2>
        <p>Enterprise-grade controls, encryption and real people watching over your money around the clock.</p>
        <ul><li><Check /> Lock any card instantly</li><li><Check /> Custom roles and approvals</li><li><Check /> FDIC insurance eligibility*</li></ul>
        <Link to="/security" className="text-link">Explore security <ArrowRight size={15} /></Link>
      </Reveal>
    </section>
  );
}

export function SupportSection() {
  const items = [
    { icon: <Headphones />, title: "24/7 support", text: "Chat and email from a team that stays with the issue.", to: "/support" },
    { icon: <Sparkles />, title: "Curated benefits", text: "Useful partner offers selected for growing businesses.", to: "/perks" },
    { icon: <BadgeCheck />, title: "Business concierge", text: "Hands-on assistance for the details that slow you down.", to: "/concierge" },
  ];
  return (
    <section className="support-section section">
      <Reveal className="section-heading centered"><span className="kicker">Here when it matters</span><h2>Real help. Any time.</h2><p>Talk to a person who understands business finance, day or night.</p></Reveal>
      <div className="support-list">
        {items.map(i => (
          <Reveal key={i.title}>
            {i.icon}<h3>{i.title}</h3><p>{i.text}</p>
            <Link to={i.to} className="text-link">Learn more <ArrowRight size={14} /></Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

export function FinalCTA({ mode = "business" }: { mode?: "business" | "personal" }) {
  const [email, setEmail] = useState("");
  const navigate = useNavigate();
  const { user } = useAuth();
  return (
    <section id="apply" className="final-cta">
      <div className="cta-media" aria-hidden="true" />
      <div className="cta-ambient" aria-hidden="true" />
      <div className="cta-grid" />
      <Reveal className="cta-content">
        <Logo inverse to={null} />
        <h2>{mode === "personal" ? <>Make every day<br /><em>easier to bank.</em></> : <>Let your money<br /><em>move smarter.</em></>}</h2>
        <p>{mode === "personal" ? "Open personal checking with everyday cards, transfers and useful controls." : "Open your Veyra business account and put intelligent finance to work."}</p>
        {user ? (
          <div className="cta-signed-in"><Btn to="/app" light>Go to your dashboard</Btn></div>
        ) : (
          <form onSubmit={e => { e.preventDefault(); navigate(`/signup?type=${mode}&email=${encodeURIComponent(email)}`); }}>
            <input type="email" required placeholder="Work email address" aria-label="Work email address" value={email} onChange={e => setEmail(e.target.value)} />
            <button type="submit">Get started <ArrowRight /></button>
          </form>
        )}
        <small>No hard credit check to apply. Terms apply.</small>
        <div className="pricing-row">
          <div className="stat-card"><strong>$6,000+</strong><p>Average amount saved by Veyra members per year.</p></div>
          <div className="plan-card">
            <div className="plan-badge"><Sparkles /></div>
            <div className="plan-head"><h3>Pro</h3><span>$99<small>/mo</small></span></div>
            <ul><li><Check /> Unlimited 2% rewards</li><li><Check /> Up to 25 virtual cards</li><li><Check /> Scout AI savings</li></ul>
            <p>If Scout doesn't earn you at least $100 a month in cash back, that month's fee is on us.</p>
            <Link to="/pricing" className="text-link plan-link">Compare plans <ArrowRight size={14} /></Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

export default function Landing() {
  return (
    <>
      <Hero /><Ticker /><FeatureOverview /><ScoutSteps /><AISavingsSection />
      <RewardsCalculator /><BusinessTools /><SecuritySection /><SupportSection /><FinalCTA />
    </>
  );
}
