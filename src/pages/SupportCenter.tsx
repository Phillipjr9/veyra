import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageSquare, Send, Clock, Shield, User, Mail, Loader2, RefreshCw } from "lucide-react";
import { apiGet, apiPost } from "../lib/api";
import { useToast } from "../components/Toast";

/**
 * Support Desk — real conversations with Veyra's support team.
 *
 * Tickets live on the server as operations cases (see "customer support" in
 * server/src/app.ts). Staff answer from the Super Admin Operations queue; their
 * replies appear here, in the notification bell, and by email.
 */
type TicketMessage = { id: number; author: "customer" | "staff"; authorName: string; body: string; createdAt: number };
type TicketStatus = "open" | "in_progress" | "awaiting_you" | "resolved";
type SupportTicket = {
  id: string; reference: string; subject: string; category: string; status: TicketStatus;
  createdAt: number; updatedAt: number; messages: TicketMessage[];
};

const CATEGORIES = ["Transfers & Zelle", "Cards & ATMs", "Dispute / Fraud", "Account KYC", "Rewards", "Something else"] as const;
const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open", in_progress: "In progress", awaiting_you: "Replied", resolved: "Resolved",
};
const when = (ms: number) => new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const errorText = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");

export function SupportCenterPage() {
  const toast = useToast();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [newTicketModal, setNewTicketModal] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newCategory, setNewCategory] = useState<string>(CATEGORIES[0]);
  const [newFirstMsg, setNewFirstMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const { tickets } = await apiGet<{ tickets: SupportTicket[] }>("/api/me/support");
      setTickets(tickets);
      setSelectedId(current => (current && tickets.some(t => t.id === current) ? current : tickets[0]?.id ?? ""));
      setLoadError("");
    } catch (err) {
      setLoadError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Pick up staff replies while the page is open.
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const activeTicket = tickets.find(t => t.id === selectedId);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [activeTicket?.messages.length]);

  const replace = (ticket: SupportTicket) =>
    setTickets(prev => [ticket, ...prev.filter(t => t.id !== ticket.id)]);

  async function handleSendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim() || !activeTicket || sending) return;
    setSending(true);
    try {
      const { ticket } = await apiPost<{ ticket: SupportTicket }>(`/api/me/support/${encodeURIComponent(activeTicket.id)}/messages`, { message: replyText.trim() });
      replace(ticket);
      setReplyText("");
    } catch (err) {
      toast({ tone: "error", title: "Message not sent", description: errorText(err) });
    } finally {
      setSending(false);
    }
  }

  async function handleCreateTicket(e: React.FormEvent) {
    e.preventDefault();
    if (newSubject.trim().length < 3 || newFirstMsg.trim().length < 2 || creating) return;
    setCreating(true);
    try {
      const { ticket } = await apiPost<{ ticket: SupportTicket }>("/api/me/support", {
        subject: newSubject.trim(), category: newCategory, message: newFirstMsg.trim(),
      });
      replace(ticket);
      setSelectedId(ticket.id);
      setNewTicketModal(false);
      setNewSubject(""); setNewFirstMsg("");
      toast({ tone: "success", title: "Support case opened", description: `Reference ${ticket.reference}. We'll reply here and by email.` });
    } catch (err) {
      toast({ tone: "error", title: "Couldn't open the case", description: errorText(err) });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="app-page support-center-page">
      <header className="app-head">
        <div>
          <span className="app-eyebrow">Support desk</span>
          <h1>Support & messages</h1>
          <p className="panel-sub">
            Message Veyra's support team about cards, transfers, disputes or your account. Every conversation is kept here.
          </p>
        </div>
        <div className="app-head-actions">
          <button type="button" className="ghost-btn" onClick={() => void load()} aria-label="Refresh conversations">
            <RefreshCw size={15} />
          </button>
          <button type="button" className="solid-btn" onClick={() => setNewTicketModal(true)}>
            <MessageSquare size={15} /> New support case
          </button>
        </div>
      </header>

      <div className="support-channels-strip">
        <div className="support-chan-box">
          <Clock size={16} className="violet-text" />
          <div><strong>Replies within one business day</strong><small>Usually much sooner</small></div>
        </div>
        <div className="support-chan-box">
          <Mail size={16} className="violet-text" />
          <div><strong>Email updates</strong><small>We'll let you know when we reply</small></div>
        </div>
        <div className="support-chan-box">
          <Shield size={16} className="violet-text" />
          <div><strong>Lost card or fraud?</strong><small><Link to="/app/cards">Freeze your card</Link> right away, then open a case</small></div>
        </div>
      </div>

      <div className="support-split-pane">
        <div className="support-ticket-list-panel">
          <div className="ticket-list-header"><strong>Your conversations ({tickets.length})</strong></div>
          <div className="tickets-scroll">
            {loading && !tickets.length && <div className="empty-state"><Loader2 className="spin" size={18} /> Loading…</div>}
            {!loading && loadError && (
              <div className="empty-state"><strong>We couldn't load your conversations.</strong><small>{loadError}</small>
                <button type="button" className="ghost-btn sm" onClick={() => void load()}>Try again</button></div>
            )}
            {!loading && !loadError && !tickets.length && (
              <div className="empty-state">
                <MessageSquare size={22} />
                <strong>No conversations yet</strong>
                <small>Open a support case and our team will reply here.</small>
              </div>
            )}
            {tickets.map(t => (
              <button key={t.id} type="button" className={`ticket-summary-item ${t.id === selectedId ? "on" : ""}`} onClick={() => setSelectedId(t.id)}>
                <div className="ticket-summary-top">
                  <span className="ticket-id-tag">{t.reference}</span>
                  <span className={`status-pill ${t.status === "resolved" ? "cleared" : "open"}`}>{STATUS_LABEL[t.status]}</span>
                </div>
                <strong className="ticket-sub">{t.subject}</strong>
                <div className="ticket-summary-foot">
                  <span className="chip">{t.category}</span>
                  <small>{t.messages.length} {t.messages.length === 1 ? "message" : "messages"}</small>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="support-conversation-panel">
          {activeTicket ? (
            <>
              <div className="conversation-header">
                <div>
                  <div className="convo-id-row">
                    <span className="ticket-id-tag">{activeTicket.reference}</span>
                    <span className="chip chip-violet">{activeTicket.category}</span>
                    <span className={`status-pill ${activeTicket.status === "resolved" ? "cleared" : "open"}`}>{STATUS_LABEL[activeTicket.status]}</span>
                  </div>
                  <h3>{activeTicket.subject}</h3>
                </div>
              </div>

              <div className="conversation-messages">
                {activeTicket.messages.map(m => (
                  <div key={m.id} className={`support-msg-bubble-wrap ${m.author === "staff" ? "specialist" : "customer"}`}>
                    <div className="support-msg-avatar">{m.author === "staff" ? <Shield size={14} /> : <User size={14} />}</div>
                    <div className="support-msg-bubble">
                      <div className="msg-sender-name">{m.author === "staff" ? m.authorName : "You"}</div>
                      <p style={{ whiteSpace: "pre-wrap" }}>{m.body}</p>
                      <small className="msg-time">{when(m.createdAt)}</small>
                    </div>
                  </div>
                ))}
                {activeTicket.status !== "resolved" && activeTicket.messages[activeTicket.messages.length - 1]?.author === "customer" && (
                  <p className="panel-sub" style={{ textAlign: "center", margin: "8px 0" }}>Our team has your message and will reply here.</p>
                )}
                <div ref={chatEnd} />
              </div>

              <form className="conversation-composer" onSubmit={handleSendReply}>
                <input
                  aria-label="Reply"
                  placeholder={activeTicket.status === "resolved" ? "Reply to reopen this case…" : "Write a reply…"}
                  value={replyText}
                  maxLength={4000}
                  onChange={e => setReplyText(e.target.value)}
                />
                <button type="submit" className="solid-btn" disabled={!replyText.trim() || sending} aria-label="Send reply">
                  {sending ? <Loader2 className="spin" size={15} /> : <Send size={15} />}
                </button>
              </form>
            </>
          ) : (
            <div className="empty-state">
              <MessageSquare size={24} />
              <strong>{tickets.length ? "Select a conversation" : "Need help? Open a support case."}</strong>
            </div>
          )}
        </div>
      </div>

      {newTicketModal && (
        <div className="modal-scrim" onClick={() => setNewTicketModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-ticket-title" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><h3 id="new-ticket-title">New support case</h3></div>
            <form onSubmit={handleCreateTicket} className="dash-form">
              <label htmlFor="tkt-sub">Subject</label>
              <input id="tkt-sub" required minLength={3} maxLength={120} placeholder="e.g. Question about a Zelle® limit"
                value={newSubject} onChange={e => setNewSubject(e.target.value)} />
              <label htmlFor="tkt-cat">Category</label>
              <select id="tkt-cat" value={newCategory} onChange={e => setNewCategory(e.target.value)}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <label htmlFor="tkt-msg">Message</label>
              <textarea id="tkt-msg" required rows={4} maxLength={4000}
                placeholder="Describe your question or issue. Never include your password, full card number or one-time codes."
                value={newFirstMsg} onChange={e => setNewFirstMsg(e.target.value)} />
              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setNewTicketModal(false)}>Cancel</button>
                <button type="submit" className="solid-btn" disabled={creating}>
                  {creating ? <Loader2 className="spin" size={15} /> : null} Open case
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
