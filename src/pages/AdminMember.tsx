import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Building2, Landmark, Mail, RefreshCw, ShieldCheck, UserRound, Wallet } from "lucide-react";
import { useAuth } from "../lib/auth";
import { isStaff, type Permission } from "../lib/permissions";
import { apiGet, apiPost } from "../lib/api";
import { money } from "../lib/store";
import { AccountEditor, FundingManager } from "../components/BankingControls";
import { useBankingDialog } from "../components/bankingDialog";
import "../styles/admin-members.css";

type ApiMoney = {cents:number;amount:string};
const ledgerMoney = (value?:ApiMoney) => value && Number.isSafeInteger(value.cents) ? money(value.cents/100) : "Unavailable";

type MemberData = {
  member: {id:string;name:string;email:string;phone:string;business:string;accountType:string;plan:string;status:string;createdAt:number;balance?:ApiMoney;pending?:ApiMoney;accountNumber?:string;routingNumber?:string;bankName?:string;bankAccountType?:string;statusReason:string;teamOwnerId:string|null};
  transactions: Array<{id:string;merchant:string;amount:ApiMoney;reference:string;date:number;method:string;status:string}>;
  kyc: {review_state?:string;status?:string}|null;
  permissions: Permission[]; emailDeliveryConfigured: boolean;
};

function MemberAction({data,action,close,saved}:{data:MemberData;action:'balance'|'status';close:()=>void;saved:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[direction,setDirection]=useState('credit'),[amount,setAmount]=useState(''),[reason,setReason]=useState(''),[review,setReview]=useState(false);
  const dialog=useBankingDialog(close,busy), member=data.member;
  const status=member.status==='restricted'?'active':'restricted';
  async function submit(e:FormEvent){
    e.preventDefault();if(busy)return;
    if(!review){setReview(true);return;}
    setBusy(true);setError('');
    try{
      if(action==='balance')await apiPost(`/api/admin/members/${member.id}/adjust`,{direction,amount,memo:reason});
      else await apiPost(`/api/admin/members/${member.id}/status`,{status,reason});
      saved();close();
    }catch(e){setError(`${e instanceof Error?e.message:'Request failed.'}${action==='balance'?' Close and refresh this account before attempting another adjustment if the outcome is unclear.':''}`);}finally{setBusy(false);}
  }
  return <div className="banking-scrim"><section ref={dialog} role="dialog" tabIndex={-1} aria-modal="true" aria-label={action==='balance'?'Adjust member balance':'Change member status'} className="banking-panel">
    <h2>{action==='balance'?'Adjust ledger balance':status==='restricted'?'Restrict account':'Restore account'}</h2><p>{member.name} · {member.email}</p>
    {error&&<p role="alert" className="banking-error">{error}</p>}
    <form className="dash-form" onSubmit={submit}><fieldset disabled={busy}>
      {review?<><h3>Confirm this account action</h3><p>{action==='balance'?`${direction==='credit'?'Credit':'Debit'} ${money(Number(amount))}. This changes the Veyra ledger only, not an external bank balance.`:status==='restricted'?'Outgoing transfers will be blocked.':'The account restriction will be lifted.'}</p><p>{reason}</p></>:<>
        {action==='balance'&&<><p>Use only for an independently verified adjustment. This is not a bank transfer or Zelle payment.</p><label>Direction<select aria-label="Direction" value={direction} onChange={e=>setDirection(e.target.value)}><option value="credit">Credit</option><option value="debit">Debit</option></select></label><label>Adjustment amount (USD)<input type="number" inputMode="decimal" required min="0.01" max="10000000" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label></>}
        {(action==='balance'||status==='restricted')&&<label>Reason for account action<textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
      </>}
      <div className="modal-actions"><button type="button" className="ghost-btn" onClick={close}>Cancel</button>{review&&<button type="button" className="ghost-btn" disabled={!!error&&action==='balance'} onClick={()=>{setReview(false);setError('');}}>Edit</button>}<button className="solid-btn" disabled={!!error&&action==='balance'}>{busy?'Saving…':review?'Confirm account action':'Review account action'}</button></div>
    </fieldset></form>
  </section></div>;
}

export function AdminMemberPage(){
  const {user}=useAuth();const {memberId}=useParams();
  return isStaff(user?.role)?<MemberWorkspace key={memberId} id={memberId??''}/>:<Navigate to="/app" replace/>;
}
function MemberWorkspace({id}:{id:string}){
  const [data,setData]=useState<MemberData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[tick,setTick]=useState(0);
  const [modal,setModal]=useState<'bank'|'funding'|'balance'|'status'|null>(null);
  const refresh=()=>setTick(n=>n+1);
  useEffect(()=>{let live=true;setLoading(true);setError('');apiGet<MemberData>(`/api/admin/members/${id}`).then(r=>{if(live)setData(r);}).catch(e=>{if(live){setError(e instanceof Error?e.message:'Could not load this customer.');setData(null);}}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[id,tick]);
  const allow=(p:Permission)=>data?.permissions.includes(p)??false;
  const member=data?.member,owner=!!member&&!member.teamOwnerId;
  return <main className="admin-member-page">
    <nav className="member-topbar"><Link to="/app/superadmin?module=customers"><ArrowLeft size={16}/> Customers</Link><span>VEYRA / CUSTOMER WORKSPACE</span><button type="button" className="ghost-btn sm" disabled={loading} onClick={refresh}><RefreshCw size={14}/> Refresh account</button></nav>
    {error&&<section className="member-panel" role="alert"><h1>Customer unavailable</h1><p>{error}</p></section>}
    {!data&&loading&&<p role="status">Loading customer account…</p>}
    {member&&data&&<>
      <header className="member-hero"><div className="member-avatar"><UserRound size={30}/></div><div><span className="member-eyebrow">{owner?'ACCOUNT OWNER':'TEAM LOGIN'}</span><h1>{member.name}</h1><p>{member.email}</p><span className="member-id">{member.id}</span></div><span className={`member-status ${member.status==='restricted'?'is-restricted':''}`}>{member.status==='restricted'?'Restricted':'Active'}</span></header>
      {!owner&&<p className="member-safety-note">This login belongs to a business team. Manage bank details on the <Link to={`/app/superadmin/customers/${member.teamOwnerId}`}>business owner’s page</Link>.</p>}
      <div className="member-actions member-primary-actions">
        {owner&&allow('accounts.view')&&allow('accounts.edit_number')&&<button type="button" className="solid-btn" onClick={()=>setModal('bank')}><Landmark size={16}/> Edit account details</button>}
        {owner&&allow('accounts.view')&&<button type="button" className="ghost-btn" onClick={()=>setModal('funding')}><Building2 size={16}/> Funding methods & requests</button>}
        {owner&&allow('customers.adjust_balance')&&<button type="button" className="ghost-btn" onClick={()=>setModal('balance')}><Wallet size={16}/> Adjust balance</button>}
        {owner&&allow('accounts.set_status')&&<button type="button" className="ghost-btn" onClick={()=>setModal('status')}><ShieldCheck size={16}/>{member.status==='restricted'?'Restore account':'Restrict account'}</button>}
      </div>
      <div className="member-summary-grid">
        {allow('accounts.view')&&owner&&<section className="member-panel member-balance"><span>Available ledger balance</span><strong>{ledgerMoney(member.balance)}</strong><small>{ledgerMoney(member.pending)} pending</small><p>Veyra ledger balance, not verification of an external bank balance.</p></section>}
        <section className="member-panel"><h2>Customer information</h2><dl className="member-details"><div><dt>Account experience</dt><dd>{member.accountType==='business'?'Business':'Personal'}</dd></div><div><dt>Business</dt><dd>{member.business||'Not provided'}</dd></div><div><dt>Phone</dt><dd>{member.phone||'Not provided'}</dd></div><div><dt>Joined</dt><dd>{new Date(member.createdAt).toLocaleDateString()}</dd></div><div><dt>Application</dt><dd>{data.kyc?.review_state?.replace(/_/g,' ')??'Not available'}</dd></div></dl></section>
        {allow('accounts.view')&&owner&&<section className="member-panel"><h2>Bank account details</h2><dl className="member-details">{[['Bank',member.bankName],['Account number',member.accountNumber],['Routing number',member.routingNumber],['Type',member.bankAccountType]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value||'Not configured'}</dd></div>)}</dl><p>Editing these details does not link or verify an external bank.</p></section>}
      </div>
      {member.statusReason&&<p className="member-safety-note"><strong>Account restriction:</strong> {member.statusReason}</p>}
      <section className="member-panel member-email-panel"><Mail size={24}/><div><h2>Zelle activity emails</h2><p>Outgoing ledger activity, incoming pending requests, staff-confirmed credits and declined requests generate Veyra notifications to the account owner’s email. They are not payment confirmations from Zelle.</p><span className={`member-status ${data.emailDeliveryConfigured?'':'is-unconfigured'}`}>{data.emailDeliveryConfigured?'Email provider configured':'Email delivery not configured'}</span>{!data.emailDeliveryConfigured&&<p>Configure MAIL_PROVIDER, MAIL_API_KEY, MAIL_FROM and APP_URL on the server before emails can leave the app.</p>}</div><Link to="/email-templates">View email designs <ArrowUpRight size={14}/></Link></section>
      {allow('transactions.view')&&<section className="member-panel"><h2>Recent transactions</h2><p>Most recent 10 ledger entries for this customer.</p><div className="member-transactions">{data.transactions.map(t=><article key={t.id}><div><strong>{t.merchant}</strong><span>{t.method} · {t.status} · {new Date(t.date).toLocaleDateString()}</span><small>{t.reference}</small></div><b>{ledgerMoney(t.amount)}</b></article>)}{!data.transactions.length&&<p>No transactions recorded.</p>}</div></section>}
      {modal&&createPortal(modal==='bank'?<AccountEditor userId={id} name={member.name} close={()=>setModal(null)} saved={refresh}/>:modal==='funding'?<FundingManager userId={id} name={member.name} canEdit={allow('accounts.edit_number')} canReview={allow('customers.adjust_balance')} close={()=>{setModal(null);refresh();}}/>:<MemberAction data={data} action={modal} close={()=>setModal(null)} saved={refresh}/>,document.body)}
    </>}
  </main>;
}
