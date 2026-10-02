import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "motion/react";
import {
  ArrowDownLeft, ArrowRight, BarChart3, Bot, Check, CreditCard, Fingerprint, Headphones,
  Landmark, LockKeyhole, Mail, MessageSquare, PiggyBank, Plug, ReceiptText, ShieldCheck, ShoppingBag, Smartphone, Sparkles, Zap
} from "lucide-react";
import { Btn, Reveal, VirtualCard } from "../components/common";
import { AISavingsSection, FeatureOverview, RewardsCalculator, ScoutSteps, SecuritySection, BusinessTools, FinalCTA } from "../Landing";

function PageHead({ kicker, title, sub }: { kicker: string; title: string; sub?: string }) {
  return (
    <div className="page-head">
      <div className="page-head-glow" />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7 }}>
        <span className="kicker">{kicker}</span>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </motion.div>
    </div>
  );
}

export function PlatformPage() {
  return (
    <>
      <PageHead kicker="The platform" title="Every money tool your business needs." sub="Accounts, cards, rewards, payments and AI analysis working as one system." />
      <FeatureOverview />
      <BusinessTools />
      <RewardsCalculator />
      <FinalCTA />
    </>
  );
}

export function PersonalBankingPage() {
  const features = [
    { icon: <CreditCard />, title: "One card for everyday life", text: "Use a physical debit card in stores and create virtual cards for subscriptions or online shopping." },
    { icon: <ArrowDownLeft />, title: "Paychecks arrive clearly", text: "Share your routing details for direct deposit and see available and pending money separately." },
    { icon: <PiggyBank />, title: "Save without thinking about it", text: "See where money goes, keep spending under control and move extra cash toward your goals." },
    { icon: <Smartphone />, title: "Controls in your pocket", text: "Freeze a card, change a PIN, control ATM or international use and manage mobile-wallet access." },
  ];
  return (
    <>
      <PageHead kicker="Personal banking" title="A daily account that feels easy." sub="Checking, debit cards, transfers, rewards and useful controls for life outside work." />
      <section className="section personal-banking-page">
        <Reveal className="personal-account-showcase">
          <div className="personal-balance"><span>Available today</span><strong>$6,824.65</strong><small><Check /> Paycheck received</small></div>
          <div className="personal-card-demo"><VirtualCard label="Everyday debit" holder="Alex Morgan" last4="1842" type="physical" /></div>
          <div className="personal-activity"><p><i><ShoppingBag /></i><span>Green Basket Market<small>Groceries · today</small></span><b>−$86.42</b></p><p><i><ArrowDownLeft /></i><span>Direct deposit<small>Available now</small></span><b className="personal-in">+$3,250</b></p></div>
        </Reveal>
        <div className="personal-feature-grid">
          {features.map((feature, index) => <Reveal key={feature.title} className="personal-feature" delay={index * .05}><span>{feature.icon}</span><h2>{feature.title}</h2><p>{feature.text}</p></Reveal>)}
        </div>
        <Reveal className="personal-plan-callout"><div><span className="kicker">Everyday plan</span><h2>$0 monthly fee.</h2><p>Open personal checking without entering a company name.</p></div><Btn to="/signup?type=personal">Open a personal account</Btn></Reveal>
      </section>
      <FinalCTA mode="personal" />
    </>
  );
}

export function ScoutPage() {
  return (
    <>
      <PageHead kicker="Veyra Scout" title="AI that hunts for savings on every charge." sub="Scout reviews each transaction, negotiates better pricing and returns the difference to your balance." />
      <AISavingsSection />
      <ScoutSteps />
      <FinalCTA />
    </>
  );
}

const PLANS = [
  { name: "Starter", price: "$0", cadence: "/mo", blurb: "Core business banking to get moving.", features: ["Business checking account", "2 virtual cards", "Free domestic ACH", "1% rewards on card spend", "Email support"], cta: "Start free" },
  { name: "Pro", price: "$99", cadence: "/mo", blurb: "Full rewards and Scout AI savings.", features: ["Everything in Starter", "Up to 25 virtual cards", "Unlimited 2% rewards", "Scout AI negotiation", "Invoicing & payments", "24/7 chat support"], cta: "Choose Pro", featured: true },
  { name: "Scale", price: "Custom", cadence: "", blurb: "For teams with complex finance needs.", features: ["Everything in Pro", "Unlimited cards & users", "Custom approval workflows", "Dedicated account partner", "API access", "Concierge service"], cta: "Talk to sales" },
];

export function PricingPage() {
  const [annual, setAnnual] = useState(false);
  const navigate = useNavigate();
  return (
    <>
      <PageHead kicker="Pricing" title="Pricing that pays for itself." sub="Pick a plan, keep the rewards. If Scout doesn't earn Pro members at least $100 a month, that month is on us." />
      <section className="section pricing-page">
        <div className="billing-toggle">
          <button className={!annual ? "on" : ""} onClick={() => setAnnual(false)}>Monthly</button>
          <button className={annual ? "on" : ""} onClick={() => setAnnual(true)}>Annual <small>−2 months</small></button>
        </div>
        <div className="plans">
          {PLANS.map((p, i) => (
            <Reveal key={p.name} delay={i * .08}>
              <div className={`plan ${p.featured ? "featured" : ""}`}>
                {p.featured && <span className="plan-tag">Most popular</span>}
                <h3>{p.name}</h3>
                <div className="plan-price">
                  <strong>{p.price === "Custom" ? "Custom" : annual && p.price !== "$0" ? `$${Math.round(parseInt(p.price.slice(1)) * 10 / 12)}` : p.price}</strong>
                  <span>{p.cadence}</span>
                </div>
                <p className="plan-blurb">{p.blurb}</p>
                <ul>{p.features.map(f => <li key={f}><Check /> {f}</li>)}</ul>
                <button className={`plan-cta ${p.featured ? "primary" : ""}`}
                  onClick={() => (p.name === "Scale" ? navigate("/contact") : navigate(`/signup?plan=${p.name === "Pro" ? "Pro" : "Starter"}`))}>
                  {p.cta} <ArrowRight size={15} />
                </button>
              </div>
            </Reveal>
          ))}
        </div>
        <div className="faq">
          <h2>Common questions</h2>
          {[
            ["Are there hidden transfer fees?", "No. Domestic ACH and wires are included on every plan, with no per-transfer charge from Veyra."],
            ["How are rewards paid out?", "Rewards accrue on every eligible purchase and can be redeemed to your balance at any time from the dashboard."],
            ["What does Scout actually do?", "Scout reviews each transaction, looks for better pricing, promotional offers and retention rates, then credits recovered savings back to you."],
            ["Can I change plans later?", "Yes — switch plans whenever you like from account settings. Changes apply to your next billing cycle."],
          ].map(([q, a]) => (
            <details key={q}><summary>{q}<span /></summary><p>{a}</p></details>
          ))}
        </div>
      </section>
      <FinalCTA />
    </>
  );
}

export function SecurityPage() {
  const items = [
    { icon: <LockKeyhole />, title: "Encryption everywhere", text: "Data is encrypted in transit and at rest, with strict internal access controls." },
    { icon: <Fingerprint />, title: "Strong authentication", text: "Credentials are stored as one-way digests, never as readable passwords." },
    { icon: <CreditCard />, title: "Instant card controls", text: "Freeze a card, change a limit or lock it to one merchant in a single tap." },
    { icon: <ShieldCheck />, title: "Continuous monitoring", text: "Transactions are screened in real time with alerts the moment something looks wrong." },
    { icon: <Landmark />, title: "Partner bank protection", text: "Deposits are held at partner banks with FDIC insurance eligibility." },
    { icon: <BarChart3 />, title: "Full audit trail", text: "Every action is logged so your team always knows who did what." },
  ];
  return (
    <>
      <PageHead kicker="Security" title="Your money, carefully guarded." sub="Security is built into every layer of Veyra, not bolted on afterwards." />
      <section className="section security-grid-section">
        <div className="security-grid">
          {items.map((i, idx) => (
            <Reveal key={i.title} delay={idx * .05}>
              <div className="sec-card"><span>{i.icon}</span><h3>{i.title}</h3><p>{i.text}</p></div>
            </Reveal>
          ))}
        </div>
      </section>
      <SecuritySection />
      <FinalCTA />
    </>
  );
}

export function SupportPage() {
  const [sent, setSent] = useState(false);
  const [topic, setTopic] = useState("Account");
  return (
    <>
      <PageHead kicker="Support" title="We're here around the clock." sub="Reach a specialist by chat or email, any hour of any day." />
      <section className="section support-page">
        <div className="support-channels">
          {[
            { icon: <MessageSquare />, title: "Help center", text: "Browse direct answers for cards, transfers, teams and reports.", action: "Browse answers", to: "/help-center" },
            { icon: <Mail />, title: "Email support", text: "Send your question and keep the full conversation in one place.", action: "Send a message", to: "/support#support-form" },
            { icon: <Headphones />, title: "Concierge", text: "Pro and Scale members get hands-on help.", action: "Request concierge", to: "/concierge" },
          ].map(c => (
            <Reveal key={c.title}>
              <div className="channel-card"><span>{c.icon}</span><h3>{c.title}</h3><p>{c.text}</p>
                <Link className="text-link" to={c.to}>{c.action} <ArrowRight size={14} /></Link>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal className="support-form-wrap">
          <form id="support-form" className="contact-form" onSubmit={e => { e.preventDefault(); setSent(true); }}>
            <h2>Send us a message</h2>
            <div className="field-row">
              <div><label htmlFor="s-name">Name</label><input id="s-name" required placeholder="Your name" /></div>
              <div><label htmlFor="s-email">Email</label><input id="s-email" type="email" required placeholder="you@company.com" /></div>
            </div>
            <label htmlFor="s-topic">Topic</label>
            <select id="s-topic" value={topic} onChange={e => setTopic(e.target.value)}>
              {["Account", "Cards", "Rewards & Scout", "Payments", "Something else"].map(t => <option key={t}>{t}</option>)}
            </select>
            <label htmlFor="s-msg">How can we help?</label>
            <textarea id="s-msg" rows={5} required placeholder="Tell us what's going on…" />
            {sent
              ? <p className="form-success"><Check size={16} /> Thanks — our team will reply shortly.</p>
              : <button className="auth-submit" type="submit">Send message</button>}
          </form>
        </Reveal>
      </section>
    </>
  );
}

export function ContactPage() {
  const [sent, setSent] = useState(false);
  return (
    <>
      <PageHead kicker="Contact" title="Let's talk about your business." sub="Tell us what you're building and we'll point you to the right plan." />
      <section className="section contact-page">
        <Reveal className="contact-split">
          <div className="contact-info">
            <h3>Talk to sales</h3>
            <p>For teams of 10 or more, custom workflows or API access.</p>
            <ul>
              <li><Mail /> <a href="mailto:sales@veyra.example">sales@veyra.example</a></li>
              <li><MessageSquare /> <Link to="/support">Support, 24/7</Link></li>
              <li><Landmark /> 100 Market Street, Suite 400</li>
            </ul>
            <div className="contact-note"><Sparkles /> Most demos are booked within one business day.</div>
          </div>
          <form className="contact-form" onSubmit={e => { e.preventDefault(); setSent(true); }}>
            <div className="field-row">
              <div><label htmlFor="c-name">Name</label><input id="c-name" required placeholder="Your name" /></div>
              <div><label htmlFor="c-co">Company</label><input id="c-co" required placeholder="Company" /></div>
            </div>
            <label htmlFor="c-email">Work email</label>
            <input id="c-email" type="email" required placeholder="you@company.com" />
            <label htmlFor="c-size">Team size</label>
            <select id="c-size">{["1–9", "10–49", "50–199", "200+"].map(s => <option key={s}>{s}</option>)}</select>
            <label htmlFor="c-msg">Message</label>
            <textarea id="c-msg" rows={4} required placeholder="What would you like to cover?" />
            {sent
              ? <p className="form-success"><Check size={16} /> Thanks — we'll be in touch soon.</p>
              : <button className="auth-submit" type="submit">Request a demo</button>}
          </form>
        </Reveal>
      </section>
    </>
  );
}

export function AboutPage() {
  return (
    <>
      <PageHead kicker="About" title="Built for the businesses doing the work." sub="We think finance tools should return time and money, not consume them." />
      <section className="section about-page">
        <Reveal className="about-lead">
          <p>Veyra started with a simple frustration: business banking asks a lot and gives little back. Fees for moving your own money. Rewards with asterisks. Hours lost reconciling what should reconcile itself.</p>
          <p>So we built the opposite — an account where rewards have no ceiling, transfers are included, and an AI layer quietly recovers money you would otherwise leave behind.</p>
        </Reveal>
        <div className="about-stats">
          {[["2021", "Founded"], ["$6,000+", "Avg. member savings / yr"], ["24/7", "Human support"], ["12k+", "Businesses served"]].map(([n, l]) => (
            <Reveal key={l}><div className="about-stat"><strong>{n}</strong><span>{l}</span></div></Reveal>
          ))}
        </div>
        <Reveal className="values">
          <h2>What we hold to</h2>
          <div className="value-grid">
            {[
              { icon: <ReceiptText />, t: "Plain numbers", d: "No hidden fees, no fine print designed to confuse." },
              { icon: <Bot />, t: "Automate the tedious", d: "If software can do it, you shouldn't have to." },
              { icon: <ShieldCheck />, t: "Earn the trust", d: "We're handling money. We act like it." },
              { icon: <Zap />, t: "Move quickly", d: "Small team, short feedback loops, frequent shipping." },
            ].map(v => <div className="value-card" key={v.t}><span>{v.icon}</span><h4>{v.t}</h4><p>{v.d}</p></div>)}
          </div>
        </Reveal>
      </section>
      <FinalCTA />
    </>
  );
}

export function CareersPage() {
  const roles = [
    ["senior-product-engineer", "Senior Product Engineer", "Engineering", "Remote (US)"],
    ["risk-compliance-lead", "Risk & Compliance Lead", "Operations", "New York"],
    ["product-designer", "Product Designer", "Design", "Remote (US/EU)"],
    ["member-support-specialist", "Member Support Specialist", "Support", "Remote"],
  ];
  return (
    <>
      <PageHead kicker="Careers" title="Come build the money layer." sub="Small team, real ownership, work that shows up in people's businesses." />
      <section className="section careers-page">
        <div className="role-list">
          {roles.map(([slug, title, dept, loc], i) => (
            <Reveal key={title} delay={i * .05}>
              <Link to={`/careers/${slug}`} className="role-row">
                <div><strong>{title}</strong><small>{dept}</small></div>
                <span>{loc}</span>
                <ArrowRight size={16} />
              </Link>
            </Reveal>
          ))}
        </div>
        <Reveal className="careers-note">
          <p>Don't see your role? We always read thoughtful notes.</p>
          <Btn to="/contact">Get in touch</Btn>
        </Reveal>
      </section>
    </>
  );
}

type ProductKey = "business-account" | "cards" | "rewards" | "payments" | "invoicing" | "integrations" | "analytics" | "ai-cfo";

const PRODUCTS: Record<ProductKey, {
  kicker: string;
  title: string;
  sub: string;
  icon: React.ReactNode;
  proof: string;
  points: Array<[string, string]>;
}> = {
  "business-account": {
    kicker: "Business account",
    title: "A business account that keeps up.",
    sub: "Receive money, organize cash, send ACH and wires, and manage every card from one calm place.",
    icon: <Landmark />,
    proof: "$0 domestic transfer fees",
    points: [["Move money without friction", "Send domestic ACH and wires without a per-transfer fee from Veyra."], ["Know what is available", "See available and pending cash separately, with a complete activity trail."], ["Built for a team", "Set permissions, approval roles and individual card limits as you grow."]],
  },
  cards: {
    kicker: "Virtual & physical cards",
    title: "A card for every purpose.",
    sub: "Issue virtual cards instantly, order physical cards, and control where and how every dollar is spent.",
    icon: <CreditCard />,
    proof: "Cards issued in seconds",
    points: [["Custom limits", "Give every card a monthly ceiling and update it whenever the work changes."], ["Merchant locks", "Keep a card tied to one vendor to prevent accidental or unwanted charges."], ["Instant controls", "Freeze, unfreeze or close any card directly from the dashboard."]],
  },
  rewards: {
    kicker: "Unlimited rewards",
    title: "Every eligible purchase gives back.",
    sub: "Earn cash back automatically with no quarterly enrollment, rotating category or points catalog.",
    icon: <Sparkles />,
    proof: "Up to 4.5% by category",
    points: [["Real cash", "Redeem rewards directly to checking at a simple 1:1 value."], ["No ceilings", "Keep earning as your business grows, without a quarterly reward cap."], ["Scout stacks savings", "Merchant savings from Scout land on top of your normal card rewards."]],
  },
  payments: {
    kicker: "Payments",
    title: "Pay vendors without the busywork.",
    sub: "Send ACH, same-day domestic wires and vendor bills with clear status tracking and useful memos.",
    icon: <Zap />,
    proof: "ACH and wires included",
    points: [["Three ways to pay", "Choose ACH, wire or vendor bill based on speed and context."], ["Clean records", "Add categories, invoice references and memos before a payment is authorized."], ["A complete receipt", "Download a reference and see the payment timeline after every transfer."]],
  },
  invoicing: {
    kicker: "Invoicing",
    title: "Send the invoice. See the money arrive.",
    sub: "Create professional invoices, monitor open balances and settle paid invoices into checking.",
    icon: <ReceiptText />,
    proof: "Card and ACH checkout",
    points: [["Fast creation", "Add the client, amount, description and due date in one concise workflow."], ["Gentle follow-up", "Send reminders when a payment is overdue without rebuilding the email."], ["Live receivables", "See outstanding, paid and overdue totals alongside every invoice."]],
  },
  integrations: {
    kicker: "Integrations",
    title: "Your finance tools, connected.",
    sub: "Keep accounting, payroll, commerce and reporting systems aligned with your Veyra activity.",
    icon: <Plug />,
    proof: "Accounting-ready exports",
    points: [["Books stay current", "Export categorized transaction data for the tools your accountant already uses."], ["Payouts stay visible", "Recognize commerce and processor settlements in the same transaction ledger."], ["Less duplicate entry", "Carry references, categories and notes into your reconciliation workflow."]],
  },
  analytics: {
    kicker: "Financial analytics",
    title: "Make decisions from clean numbers.",
    sub: "Understand cash flow, spend categories, card utilization and receivables without rebuilding a spreadsheet.",
    icon: <BarChart3 />,
    proof: "Live cash-flow visibility",
    points: [["Cash in and out", "Follow weekly inflows and outflows from the account overview."], ["Category context", "See which operating categories account for the greatest share of spend."], ["Export when needed", "Download a complete ledger or a single monthly statement as CSV."]],
  },
  "ai-cfo": {
    kicker: "AI CFO",
    title: "A clearer view of what comes next.",
    sub: "Turn categorized activity into useful summaries, runway context and practical next-step prompts.",
    icon: <Bot />,
    proof: "18-month projected runway",
    points: [["Automatic categorization", "Build reporting from the activity already flowing through the account."], ["Runway context", "Understand current operating pace against cash available."], ["Questions answered faster", "Move from raw transactions to a useful financial summary without manual cleanup."]],
  },
};

export function ProductDetailPage({ product }: { product: ProductKey }) {
  const data = PRODUCTS[product];
  return (
    <>
      <PageHead kicker={data.kicker} title={data.title} sub={data.sub} />
      <section className="section product-detail-page">
        <Reveal className="product-proof">
          <span className="product-proof-icon">{data.icon}</span>
          <div><small>Designed to save time</small><strong>{data.proof}</strong></div>
          <Btn to="/signup">Open an account</Btn>
        </Reveal>
        <div className="product-detail-list">
          {data.points.map(([title, text], index) => (
            <Reveal className="product-detail-row" key={title} delay={index * .06}>
              <span>0{index + 1}</span><h2>{title}</h2><p>{text}</p>
            </Reveal>
          ))}
        </div>
        <Reveal className="product-link-grid">
          {Object.entries(PRODUCTS).filter(([key]) => key !== product).slice(0, 4).map(([key, item]) => (
            <Link key={key} to={`/${key}`}><span>{item.icon}</span><strong>{item.kicker}</strong><ArrowRight /></Link>
          ))}
        </Reveal>
      </section>
      <FinalCTA />
    </>
  );
}

export function PerksMarketingPage() {
  const perks = [["Stratus Compute", "$5,000 in cloud credits"], ["Notebook Pro", "6 months free"], ["Paywell Checkout", "$20k fee-free processing"], ["Trackline", "$1,000 product credit"], ["Wayfare Travel", "20% off hotels"], ["Ledgerly Advisors", "First month free"]];
  return (
    <>
      <PageHead kicker="Member perks" title="More value for the work ahead." sub="Useful partner offers for software, infrastructure, payments, travel and finance." />
      <section className="section public-perks">
        {perks.map(([name, value], i) => <Reveal key={name} className="public-perk-row" delay={i * .04}><span>{String(i + 1).padStart(2, "0")}</span><strong>{name}</strong><p>{value}</p></Reveal>)}
        <Reveal className="center-action"><Btn to="/signup">Unlock member perks</Btn></Reveal>
      </section>
      <FinalCTA />
    </>
  );
}

export function ConciergePage() {
  return (
    <>
      <PageHead kicker="Business concierge" title="A real person for the details." sub="Get hands-on help with account questions, vendor payments, card controls and time-sensitive requests." />
      <section className="section concierge-page">
        <Reveal className="concierge-lead"><Headphones /><div><h2>Available around the clock</h2><p>Pro and Scale members can ask for help whenever the work cannot wait.</p></div></Reveal>
        <div className="product-detail-list">
          {[["Account support", "Resolve access, verification and transfer questions with one continuous conversation."], ["Payment assistance", "Get help tracing a transfer, understanding a status or preparing vendor details."], ["Travel and reservations", "Request practical support for eligible business travel and reservation needs."]].map(([title, text], i) => <Reveal className="product-detail-row" key={title} delay={i * .06}><span>0{i + 1}</span><h2>{title}</h2><p>{text}</p></Reveal>)}
        </div>
        <Reveal className="center-action"><Btn to="/contact">Contact concierge</Btn></Reveal>
      </section>
    </>
  );
}

export function HelpCenterPage() {
  const questions = [["How do I add funds?", "Open the dashboard and choose Add funds. Select a source, review the amount and confirm the transfer."], ["Can I freeze a card?", "Yes. Open Cards, select Freeze on the card, and unfreeze it from the same control whenever needed."], ["Where are transfer receipts?", "Open a transaction from the ledger and choose Receipt. Statements can also be exported by month."], ["How do I invite my bookkeeper?", "Open Team, invite a member and choose the Bookkeeper role for read-only access."], ["How does Scout apply savings?", "Scout reviews eligible purchases, applies available rates and records recovered cash in the Scout report."]];
  return (
    <>
      <PageHead kicker="Help center" title="Answers without the runaround." sub="Browse common account, card, payment and team questions." />
      <section className="section help-page">
        <div className="faq help-faq">
          {questions.map(([q, a]) => <details key={q}><summary>{q}<span /></summary><p>{a}</p></details>)}
        </div>
        <Reveal className="center-action"><Btn to="/support">Contact support</Btn></Reveal>
      </section>
    </>
  );
}

const JOBS: Record<string, { title: string; dept: string; location: string; intro: string }> = {
  "senior-product-engineer": { title: "Senior Product Engineer", dept: "Engineering", location: "Remote (US)", intro: "Build polished financial workflows across our React product and service integrations." },
  "risk-compliance-lead": { title: "Risk & Compliance Lead", dept: "Operations", location: "New York", intro: "Turn regulatory requirements into clear, durable operating systems." },
  "product-designer": { title: "Product Designer", dept: "Design", location: "Remote (US/EU)", intro: "Shape calm, precise experiences for complex business-finance decisions." },
  "member-support-specialist": { title: "Member Support Specialist", dept: "Support", location: "Remote", intro: "Help business owners solve high-stakes questions with speed and care." },
};

export function JobPage() {
  const { slug = "" } = useParams();
  const job = JOBS[slug];
  if (!job) return <NotFoundPage />;
  return (
    <>
      <PageHead kicker={`${job.dept} · ${job.location}`} title={job.title} sub={job.intro} />
      <section className="section job-page">
        <Reveal><h2>What you'll do</h2><ul><li><Check /> Own meaningful work from problem framing through launch.</li><li><Check /> Partner closely with product, operations and member-facing teams.</li><li><Check /> Improve the systems and standards behind every release.</li></ul></Reveal>
        <Reveal><h2>What you bring</h2><ul><li><Check /> Strong judgment, clear communication and care for details.</li><li><Check /> Experience delivering work in a fast-moving product environment.</li><li><Check /> A practical bias toward simple, maintainable solutions.</li></ul></Reveal>
        <Reveal className="job-apply"><h2>Interested?</h2><p>Tell us about the work you are proud of and why Veyra interests you.</p><Btn to={`/contact?role=${encodeURIComponent(job.title)}`}>Apply for this role</Btn></Reveal>
      </section>
    </>
  );
}

const LEGAL: Record<string, { title: string; body: string[] }> = {
  privacy: {
    title: "Privacy Policy",
    body: [
      "This is a demonstration application built to showcase product design. It does not provide real financial services.",
      "Any details you enter — name, business, email and password — are stored only in your own browser's local storage. Nothing is transmitted to a server, and no analytics or tracking tools collect your information.",
      "Passwords are converted to a one-way digest before being saved, so the original text is never retained.",
      "You can remove all stored data at any time by clearing site data in your browser, or by using the reset control in account settings.",
    ],
  },
  terms: {
    title: "Terms of Service",
    body: [
      "By using this demonstration you acknowledge that it is a design prototype and not a regulated financial product.",
      "No real accounts are opened, no money moves, and all balances, transactions, rewards and savings figures shown are illustrative examples generated locally in your browser.",
      "The software is provided as-is, without warranty of any kind. Do not enter genuine banking credentials or sensitive personal information.",
      "Brand names, product names and imagery in this project are original to this demonstration.",
    ],
  },
  disclosures: {
    title: "Disclosures",
    body: [
      "Veyra is presented here as a fictional financial technology brand created for demonstration purposes. It is not a bank.",
      "In a real deployment, banking services would be provided by partner financial institutions, Members FDIC, and card products would be issued under license from a card network.",
      "Reward rates, savings estimates and annual value figures shown throughout this demonstration are illustrative and do not represent an offer.",
      "Calculator outputs are estimates based on the inputs you provide and do not constitute financial advice.",
    ],
  },
};

export function LegalPage({ doc }: { doc: keyof typeof LEGAL }) {
  const page = LEGAL[doc];
  return (
    <>
      <PageHead kicker="Legal" title={page.title} />
      <section className="section legal-page">
        <Reveal className="legal-body">
          <p className="legal-updated">Last updated January 2026</p>
          {page.body.map((p, i) => <p key={i}>{p}</p>)}
          <div className="legal-links">
            {Object.keys(LEGAL).filter(k => k !== doc).map(k => (
              <Link key={k} to={`/legal/${k}`} className="text-link">{LEGAL[k].title} <ArrowRight size={14} /></Link>
            ))}
          </div>
        </Reveal>
      </section>
    </>
  );
}

export function NotFoundPage() {
  return (
    <div className="notfound">
      <div className="notfound-inner">
        <VirtualCard small />
        <h1>404</h1>
        <p>We couldn't find that page. It may have moved or never existed.</p>
        <div className="notfound-actions"><Btn to="/">Back to home</Btn><Link to="/support" className="text-link">Contact support <ArrowRight size={15} /></Link></div>
      </div>
    </div>
  );
}
