import { useState, useRef, useEffect } from "react";
import {
  MessageSquare, Send, Phone,
  Clock, Shield, User
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { useToast } from "../components/Toast";

type TicketMessage = {
  id: string;
  sender: "customer" | "specialist" | "system";
  senderName: string;
  text: string;
  timestamp: number;
};

type SupportTicket = {
  id: string;
  subject: string;
  category: "Cards & ATMs" | "Transfers & Zelle" | "Dispute / Fraud" | "Account KYC" | "Rewards";
  status: "open" | "in_progress" | "resolved";
  createdAt: number;
  messages: TicketMessage[];
};

export function SupportCenterPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [tickets, setTickets] = useState<SupportTicket[]>(() => {
    return [
      {
        id: "TKT-8902",
        subject: "Zelle® Transfer limits for verified account",
        category: "Transfers & Zelle",
        status: "in_progress",
        createdAt: Date.now() - 3600000 * 5,
        messages: [
          {
            id: "m1",
            sender: "customer",
            senderName: user?.name || "Customer",
            text: "Hello! I am trying to send a payment via Zelle® to my supplier, what is the maximum per-transaction limit?",
            timestamp: Date.now() - 3600000 * 5,
          },
          {
            id: "m2",
            sender: "specialist",
            senderName: "David M. (Veyra Banking Specialist)",
            text: "Hi! Standard verified business & personal profiles can send up to $2,500.00 per single Zelle® transfer with zero fees. If you need higher daily velocity, you can also use our Same-Day Wire feature.",
            timestamp: Date.now() - 3600000 * 4,
          }
        ]
      },
      {
        id: "TKT-8841",
        subject: "Physical Metal Card Delivery Tracking",
        category: "Cards & ATMs",
        status: "resolved",
        createdAt: Date.now() - 86400000 * 3,
        messages: [
          {
            id: "m10",
            sender: "customer",
            senderName: user?.name || "Customer",
            text: "When will my physical card arrive?",
            timestamp: Date.now() - 86400000 * 3,
          },
          {
            id: "m11",
            sender: "specialist",
            senderName: "Elena R. (Card Operations)",
            text: "Your card was minted and delivered via ParcelPost Express. You can view the tracking directly in your Cards tab.",
            timestamp: Date.now() - 86400000 * 2,
          }
        ]
      }
    ];
  });

  const [selectedTicketId, setSelectedTicketId] = useState<string>(tickets[0].id);
  const [replyText, setReplyText] = useState("");
  const [newTicketModal, setNewTicketModal] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newCategory, setNewCategory] = useState<SupportTicket["category"]>("Transfers & Zelle");
  const [newFirstMsg, setNewFirstMsg] = useState("");

  const activeTicket = tickets.find(t => t.id === selectedTicketId) || tickets[0];
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeTicket?.messages]);

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || !activeTicket) return;

    const userMsg: TicketMessage = {
      id: `msg-${Date.now()}`,
      sender: "customer",
      senderName: user?.name || "You",
      text: replyText.trim(),
      timestamp: Date.now(),
    };

    const updated = tickets.map(t => {
      if (t.id === activeTicket.id) {
        return {
          ...t,
          status: "in_progress" as const,
          messages: [...t.messages, userMsg]
        };
      }
      return t;
    });

    setTickets(updated);
    setReplyText("");

    // Simulate real specialist reply after 1.5s
    setTimeout(() => {
      const specialistMsg: TicketMessage = {
        id: `spec-${Date.now()}`,
        sender: "specialist",
        senderName: "David M. (Veyra Banking Specialist)",
        text: "Thank you for the update! I have received your message and our tier-2 compliance desk is reviewing your request now. We'll update this channel shortly.",
        timestamp: Date.now(),
      };

      setTickets(prev => prev.map(t => {
        if (t.id === activeTicket.id) {
          return {
            ...t,
            messages: [...t.messages, specialistMsg]
          };
        }
        return t;
      }));

      toast({
        tone: "info",
        title: "New Support Message",
        description: `David M. replied on ${activeTicket.id}`,
      });
    }, 1400);
  };

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubject.trim() || !newFirstMsg.trim()) return;

    const newTkt: SupportTicket = {
      id: `TKT-${Math.floor(1000 + Math.random() * 9000)}`,
      subject: newSubject.trim(),
      category: newCategory,
      status: "open",
      createdAt: Date.now(),
      messages: [
        {
          id: `init-${Date.now()}`,
          sender: "customer",
          senderName: user?.name || "Customer",
          text: newFirstMsg.trim(),
          timestamp: Date.now(),
        }
      ]
    };

    setTickets([newTkt, ...tickets]);
    setSelectedTicketId(newTkt.id);
    setNewTicketModal(false);
    setNewSubject("");
    setNewFirstMsg("");

    toast({
      tone: "success",
      title: "Support Ticket Dispatched",
      description: `Ticket #${newTkt.id} created with 24/7 specialist on standby.`,
    });
  };

  return (
    <div className="app-page support-center-page">
      <header className="app-head">
        <div>
          <span className="app-eyebrow">24/7/365 Dedicated Human & AI Communications</span>
          <h1>Live Support & Communications</h1>
          <p className="panel-sub">
            Speak directly with FDIC banking operations, card dispute arbitrators, and compliance specialists.
          </p>
        </div>
        <div className="app-head-actions">
          <button
            type="button"
            className="solid-btn"
            onClick={() => setNewTicketModal(true)}
          >
            <MessageSquare size={15} /> Open New Support Case
          </button>
        </div>
      </header>

      {/* 24/7 Direct Channels info */}
      <div className="support-channels-strip">
        <div className="support-chan-box">
          <Clock size={16} className="violet-text" />
          <div>
            <strong>Median Response: 1.8 mins</strong>
            <small>Live chat desk active 24/7</small>
          </div>
        </div>
        <div className="support-chan-box">
          <Phone size={16} className="violet-text" />
          <div>
            <strong>Priority Concierge Hotline</strong>
            <small>1-800-555-0198 (Toll Free)</small>
          </div>
        </div>
        <div className="support-chan-box">
          <Shield size={16} className="violet-text" />
          <div>
            <strong>Bank Secrecy & FDIC Protected</strong>
            <small>Encrypted case communications</small>
          </div>
        </div>
      </div>

      {/* Ticket Split Pane */}
      <div className="support-split-pane">
        {/* Left: Ticket List */}
        <div className="support-ticket-list-panel">
          <div className="ticket-list-header">
            <strong>Active Inquiries ({tickets.length})</strong>
          </div>
          <div className="tickets-scroll">
            {tickets.map(t => (
              <button
                key={t.id}
                type="button"
                className={`ticket-summary-item ${t.id === selectedTicketId ? "on" : ""}`}
                onClick={() => setSelectedTicketId(t.id)}
              >
                <div className="ticket-summary-top">
                  <span className="ticket-id-tag">{t.id}</span>
                  <span className={`status-pill ${t.status === "resolved" ? "cleared" : "open"}`}>
                    {t.status === "in_progress" ? "In Progress" : t.status === "resolved" ? "Resolved" : "Open"}
                  </span>
                </div>
                <strong className="ticket-sub">{t.subject}</strong>
                <div className="ticket-summary-foot">
                  <span className="chip">{t.category}</span>
                  <small>{t.messages.length} messages</small>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Active Chat Conversation */}
        <div className="support-conversation-panel">
          {activeTicket ? (
            <>
              <div className="conversation-header">
                <div>
                  <div className="convo-id-row">
                    <span className="ticket-id-tag">{activeTicket.id}</span>
                    <span className="chip chip-violet">{activeTicket.category}</span>
                    <span className={`status-pill ${activeTicket.status === "resolved" ? "cleared" : "open"}`}>
                      {activeTicket.status === "resolved" ? "Resolved" : "Active Case"}
                    </span>
                  </div>
                  <h3>{activeTicket.subject}</h3>
                </div>
              </div>

              <div className="conversation-messages">
                {activeTicket.messages.map(m => (
                  <div
                    key={m.id}
                    className={`support-msg-bubble-wrap ${m.sender}`}
                  >
                    <div className="support-msg-avatar">
                      {m.sender === "specialist" ? (
                        <Shield size={14} />
                      ) : (
                        <User size={14} />
                      )}
                    </div>
                    <div className="support-msg-bubble">
                      <div className="msg-sender-name">{m.senderName}</div>
                      <p>{m.text}</p>
                      <small className="msg-time">
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </small>
                    </div>
                  </div>
                ))}
                <div ref={chatEnd} />
              </div>

              <form className="conversation-composer" onSubmit={handleSendReply}>
                <input
                  placeholder="Type your message to the banking specialist team…"
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                />
                <button type="submit" className="solid-btn" disabled={!replyText.trim()}>
                  <Send size={15} />
                </button>
              </form>
            </>
          ) : (
            <div className="empty-state">
              <MessageSquare size={24} />
              <strong>Select a ticket to view communications</strong>
            </div>
          )}
        </div>
      </div>

      {/* New Ticket Modal */}
      {newTicketModal && (
        <div className="modal-scrim" onClick={() => setNewTicketModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Open Formal Support Inquiry</h3>
            </div>
            <form onSubmit={handleCreateTicket} className="dash-form">
              <label htmlFor="tkt-sub">Subject / Issue Summary</label>
              <input
                id="tkt-sub"
                required
                placeholder="e.g. Question regarding Zelle® velocity or Card PIN reset"
                value={newSubject}
                onChange={e => setNewSubject(e.target.value)}
              />

              <label htmlFor="tkt-cat">Department / Category</label>
              <select
                id="tkt-cat"
                value={newCategory}
                onChange={e => setNewCategory(e.target.value as any)}
              >
                <option value="Transfers & Zelle">Transfers & Zelle® Payments</option>
                <option value="Cards & ATMs">Cards & ATM Network</option>
                <option value="Dispute / Fraud">Dispute / Fraud Arbitration</option>
                <option value="Account KYC">Account Verification & KYC</option>
                <option value="Rewards">2% Cash Back & Rewards</option>
              </select>

              <label htmlFor="tkt-msg">Detailed Message</label>
              <textarea
                id="tkt-msg"
                required
                rows={4}
                placeholder="Please describe your question or issue in detail. A specialist will be assigned immediately."
                value={newFirstMsg}
                onChange={e => setNewFirstMsg(e.target.value)}
              />

              <div className="modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setNewTicketModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="solid-btn">
                  Submit Case
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
