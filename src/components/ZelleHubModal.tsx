import { createPortal } from 'react-dom';
import { QrCode, X } from 'lucide-react';
import { ReceiveHub } from './ReceiveHub';
import { useBankingDialog } from './bankingDialog';
import '../styles/receive-hub.css';

function ReceiveDialog({ onClose }: { onClose: () => void }) {
  const ref = useBankingDialog(onClose, false);
  return createPortal(
    <div className="receive-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section ref={ref} className="receive-modal" role="dialog" aria-modal="true" aria-label="Zelle receive hub" aria-describedby="receive-subtitle" tabIndex={-1}>
        <header className="receive-header">
          <span className="receive-header-icon" aria-hidden="true"><QrCode size={23} strokeWidth={1.6} /></span>
          <div className="receive-header-title"><div><span className="receive-eyebrow">MONEY, MORE CONNECTED</span></div><h2>Zelle<sup>®</sup> Receive Hub</h2><p id="receive-subtitle">Your details. Your code. Ready to share.</p></div>
          <button type="button" className="receive-close" aria-label="Close receive hub" onClick={onClose}><X size={19} /></button>
        </header>
        <ReceiveHub />
      </section>
    </div>, document.body,
  );
}
export function ZelleHubModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <ReceiveDialog onClose={onClose} /> : null;
}
