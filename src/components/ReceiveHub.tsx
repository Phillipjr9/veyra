import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowUpRight, Check, ChevronDown, Copy, Download, Link2, Mail, QrCode, Share2, ShieldCheck, Smartphone } from 'lucide-react';
import { useDemoPayments } from '../lib/demoPayments';
import { DemoModeNotice } from './DemoPayments';

/** An actual QR for our payment link, never an imitation of a bank-network QR. */
export function ReceiveHub() {
  const { data, error, refresh } = useDemoPayments();
  const [alias, setAlias] = useState<'email' | 'phone'>('email');
  const [image, setImage] = useState({ url: '', data: '' });
  const [qrError, setQrError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackError, setFeedbackError] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const selected = alias === 'phone' && data?.member.phoneUsable ? 'phone' : 'email';
  const contact = data?.member[selected] ?? '';
  const available = !!data?.enabled && !error && !!contact;
  const url = `${window.location.origin}${window.location.pathname}#/app/transfers?to=${encodeURIComponent(contact)}`;
  // Never display/download the previous alias's QR while the new one is rendering.
  const qr = available && image.url === url ? image.data : '';
  const name = data?.member.name || 'Your account';
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  useEffect(() => { void refresh().catch(() => {}); }, [refresh]);
  useEffect(() => {
    let active = true;
    setQrError('');
    if (available) {
      void QRCode.toDataURL(url, {
        width: 768, margin: 4, errorCorrectionLevel: 'M',
        color: { dark: '#291440', light: '#ffffff' },
      }).then(value => { if (active) setImage({ url, data: value }); })
        .catch(() => { if (active) setQrError('QR unavailable. You can still copy or share your payment link.'); });
    }
    return () => { active = false; };
  }, [available, url]);

  function choose(next: 'email' | 'phone') {
    setAlias(next); setFeedback(''); setFeedbackError(false);
  }
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback(`${label} copied.`); setFeedbackError(false);
    } catch {
      setShowLink(true); setFeedbackError(true);
      setFeedback('Copy is unavailable in this browser. Select and copy your contact or payment link below.');
    }
  }
  async function share() {
    if (!navigator.share) return copy(url, 'Payment link');
    try {
      await navigator.share({ title: `Pay ${name} · Veyra`, text: 'Open the Veyra payment link and confirm the recipient after signing in.', url });
      setFeedback('Share sheet opened.'); setFeedbackError(false);
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) {
        setShowLink(true); setFeedbackError(true);
        setFeedback('Sharing is unavailable. Copy your payment link instead.');
      }
    }
  }

  return <>
    <div className="receive-mode-notice"><DemoModeNotice /></div>
    <div className="receive-grid">
      <div className="receive-code-stage">
        <div className="receive-code-card">
          <div className="receive-card-top"><span className="receive-wordmark">veyra<span aria-hidden="true">✦</span></span><span className="receive-card-tag">RECEIVE CODE</span></div>
          <div className="receive-person"><span className="receive-avatar" aria-hidden="true">{initials}</span><strong>{name}</strong><span>Scan. Connect. Receive.</span></div>
          <div className="receive-qr-frame" aria-busy={available && !qr && !qrError}>
            {qr ? <img src={qr} width="240" height="240" alt="Scannable QR for this Veyra payment link" /> :
              <div className="receive-qr-placeholder"><QrCode size={40} strokeWidth={1.3} aria-hidden="true" /><p>{qrError || (available ? 'Preparing your code…' : 'Code unavailable')}</p></div>}
          </div>
          <div className="receive-code-identity"><span>{selected === 'email' ? <Mail size={13} /> : <Smartphone size={13} />} RECEIVING VIA {selected.toUpperCase()}</span><strong className="demo-contact">{contact || 'Loading your contact…'}</strong></div>
          <div className="receive-card-foot"><span className="receive-dot" /> Veyra payment link <span>Not an official Zelle QR</span></div>
        </div>
        <p className="receive-scan-hint"><QrCode size={14} aria-hidden="true" /> A personal code. A simpler way to connect.</p>
      </div>

      <section className="receive-controls" aria-label="Receiving details">
        <span className="receive-eyebrow">YOUR DETAILS, ALREADY HERE</span>
        <h3>Choose how you’re found.</h3>
        <p className="receive-intro">Use the email or phone saved on your signup profile. Your code updates with your selection.</p>
        <div className="receive-contacts" role="group" aria-label="Receiving identifier">
          <button type="button" className="receive-contact-option" aria-label="Email" aria-pressed={selected === 'email'} disabled={!data?.member.email} onClick={() => choose('email')}>
            <span className="receive-option-icon"><Mail size={19} /></span><span className="receive-option-content"><span>Email address <small>Signup email</small></span><strong>{data?.member.email || 'Loading…'}</strong></span><span className="receive-radio" aria-hidden="true">{selected === 'email' && <Check size={11} strokeWidth={3} />}</span>
          </button>
          <button type="button" className="receive-contact-option" aria-label="Phone" aria-pressed={selected === 'phone'} disabled={!data?.member.phoneUsable} aria-describedby={!data?.member.phoneUsable ? 'receive-phone-note' : undefined} onClick={() => choose('phone')}>
            <span className="receive-option-icon"><Smartphone size={19} /></span><span className="receive-option-content"><span>Mobile number <small>{data?.member.phoneUsable ? 'Signup phone' : 'Unavailable'}</small></span><strong>{data?.member.phone || 'No phone number saved'}</strong></span><span className="receive-radio" aria-hidden="true">{selected === 'phone' && <Check size={11} strokeWidth={3} />}</span>
          </button>
        </div>
        {data && !data.member.phoneUsable && <p id="receive-phone-note" className="receive-help">Use email if your phone is missing, shared with another account or needs a country code.</p>}
        <button type="button" className="receive-copy-contact" disabled={!contact || !!error} onClick={() => void copy(contact, selected === 'email' ? 'Email address' : 'Phone number')}><Copy size={14} /> Copy identifier</button>

        <div className="receive-share-area">
          <button type="button" className="receive-share" disabled={!available} onClick={() => void share()}><Share2 size={17} /> Share link <ArrowUpRight size={17} /></button>
          <div className="receive-secondary-actions">
            <button type="button" disabled={!available} onClick={() => void copy(url, 'Payment link')}><Link2 size={16} /> Copy payment link</button>
            {qr ? <a download="veyra-receive-qr.png" href={qr}><Download size={16} /> Save QR</a> : <button type="button" disabled><Download size={16} /> Save QR</button>}
          </div>
          <p className={`receive-feedback${feedbackError ? ' is-error' : ''}`} role="status">{feedback && <>{!feedbackError && <Check size={14} />}{feedback}</>}</p>
        </div>
        <details className="receive-link-details" open={showLink} onToggle={e => setShowLink(e.currentTarget.open)}>
          <summary>View payment link <ChevronDown size={15} /></summary>
          {available ? <label>Payment link<textarea aria-label="Payment link" readOnly rows={3} value={url} onFocus={e => e.currentTarget.select()} /></label> : <p>Your link becomes available when receiving is enabled.</p>}
        </details>
      </section>
    </div>
    <ol className="receive-how" aria-label="How receiving works">
      <li><span>01</span><div><strong>Share your code</strong><p>Send the link or QR to someone you know.</p></div></li>
      <li><span>02</span><div><strong>They sign in</strong><p>The link opens your Veyra recipient.</p></div></li>
      <li><span>03</span><div><strong>Review, then pay</strong><p>The sender confirms before any payment.</p></div></li>
    </ol>
    <footer className="receive-disclosure"><ShieldCheck size={17} aria-hidden="true" /><p><strong>For Veyra account holders.</strong> Account entries update within Veyra. External payment processing is not connected. This is not official Zelle enrollment or a Zelle network QR. Sharing a code or link shares your selected contact.</p></footer>
  </>;
}
