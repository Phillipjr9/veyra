import { useState, type FormEvent } from "react";
import { ArrowLeft, Layers3, ShieldCheck, X } from "lucide-react";
import { apiPost } from "../lib/api";
import { useBankingDialog } from "./bankingDialog";
import "../styles/banking-controls.css";
import "../styles/admin-members.css";

type Patch = Partial<{bankName:string;routingNumber:string;bankAccountType:string}>;
type Candidate = {id:string;name:string;email:string};
type Preview = {previewId:string;count:number;changedCount:number;expiresAt:number;reason:string;scope:string;patch:Patch;rows:Array<Pick<Candidate,'name'|'email'> & {userId:string;accountLast4:string;bankName:string;routingNumber:string;bankAccountType:string}>};
const labels = {bankName:'Bank name',routingNumber:'Routing number',bankAccountType:'Bank account type'};

export function BulkAccountEditor({candidates,close,saved}:{candidates:Candidate[];close:()=>void;saved:()=>void}) {
  const [scope,setScope]=useState<'selected'|'all'>('selected'),[selected,setSelected]=useState<string[]>([]),[search,setSearch]=useState('');
  const [fields,setFields]=useState({bankName:false,routingNumber:false,bankAccountType:false});
  const [values,setValues]=useState({bankName:'',routingNumber:'',bankAccountType:'Checking'}),[reason,setReason]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null),[confirmation,setConfirmation]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [result,setResult]=useState<{count:number;changedCount:number}|null>(null);
  const dialog=useBankingDialog(close,busy);
  const filtered=candidates.filter(c=>`${c.name} ${c.email}`.toLowerCase().includes(search.toLowerCase()));
  async function review(e:FormEvent){
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try{
      const patch=Object.fromEntries(Object.keys(fields).filter(k=>fields[k as keyof Patch]).map(k=>[k,values[k as keyof Patch]]));
      setPreview(await apiPost<Preview>("/api/admin/accounts/bulk-preview",{scope,...(scope==='selected'?{userIds:selected}:{}),patch,reason}));setConfirmation('');dialog.current?.scrollTo({top:0});
    }catch(e){setError(e instanceof Error?e.message:'Could not prepare this review.');}finally{setBusy(false);}
  }
  async function apply(e:FormEvent){
    e.preventDefault();if(busy||!preview)return;setBusy(true);setError('');
    try{const r=await apiPost<{count:number;changedCount:number}>("/api/admin/accounts/bulk-apply",{previewId:preview.previewId,confirmation});setResult(r);saved();dialog.current?.scrollTo({top:0});}
    catch(e){setError(e instanceof Error?e.message:'Could not apply this review. Retry the same review to check its result safely.');}finally{setBusy(false);}
  }
  return <div className="banking-scrim"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Bulk account details" className="banking-panel banking-wide bulk-editor">
    <header className="member-dialog-header"><div><span className="member-eyebrow">SHARED BANK DETAILS</span><h2>Update accounts together</h2></div><button type="button" className="member-icon-button" aria-label="Close" onClick={close} disabled={busy}><X size={20}/></button></header>
    {error&&<p role="alert" className="banking-error">{error}</p>}
    {result?<div className="bulk-complete" role="status"><ShieldCheck size={34}/><h3>Account details updated</h3><p>{result.changedCount} of {result.count} reviewed accounts changed. Unique account numbers and balances were preserved. Each changed account has an audit entry.</p><button type="button" className="solid-btn" onClick={close}>Done</button></div>:preview?<form className="dash-form" onSubmit={apply}><fieldset disabled={busy}>
      <button type="button" className="ghost-btn sm" onClick={()=>{setPreview(null);setError('');}}><ArrowLeft size={14}/> Back to changes</button>
      <h3>Review {preview.count} accounts</h3><p>{preview.changedCount} accounts need changes. Account numbers, Personal/Business designation, balances, and funding instructions will not change.</p>
      <p className="member-safety-note">This review expires at {new Date(preview.expiresAt).toLocaleTimeString()}. Only the users listed here will be updated; accounts created later are not included. If reviewed account details change, the entire batch is refused.</p>
      <p><strong>Audit reason:</strong> {preview.reason}</p>
      <div className="bulk-review-list" aria-label="Account changes to review">{preview.rows.map((row,i)=><details key={row.userId} open={i===0}><summary><strong>{row.name}</strong><span>{row.email} · •••• {row.accountLast4}</span></summary><dl>{(Object.keys(preview.patch) as Array<keyof Patch>).map(key=><div key={key}><dt>{labels[key]}</dt><dd><span>Before: {row[key]}</span><strong>After: {preview.patch[key]}</strong></dd></div>)}</dl></details>)}</div>
      <label>Type UPDATE {preview.count} to confirm<input required autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder={`UPDATE ${preview.count}`}/></label>
      <button className="solid-btn" disabled={confirmation!==`UPDATE ${preview.count}`}>{busy?'Applying…':`Apply to ${preview.count} accounts`}</button>
    </fieldset></form>:<form className="dash-form" onSubmit={review}><fieldset disabled={busy}>
      <p>Apply only the fields you choose. Every user keeps their own account number. These changes update Veyra’s records; they do not connect or change an external bank account.</p>
      <label>Target accounts<select aria-label="Target accounts" value={scope} onChange={e=>setScope(e.target.value as 'selected'|'all')}><option value="selected">Selected account owners</option><option value="all">All current account owners</option></select></label>
      {scope==='selected'?<div className="bulk-selection"><label>Find account owners<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name or email"/></label>
        <div className="member-actions"><button type="button" className="ghost-btn sm" onClick={()=>setSelected(ids=>[...new Set([...ids,...filtered.map(c=>c.id)])])}>Select visible</button><button type="button" className="ghost-btn sm" onClick={()=>setSelected([])}>Clear selection</button><span>{selected.length} selected</span></div>
        <div className="bulk-candidates">{filtered.map(c=><label className="banking-check" key={c.id}><input type="checkbox" aria-label={`Select ${c.email}`} checked={selected.includes(c.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,c.id]:ids.filter(id=>id!==c.id))}/><span><strong>{c.name}</strong><small>{c.email}</small></span></label>)}{!filtered.length&&<p>No matching account owners.</p>}</div>
      </div>:<p className="member-safety-note">All account owners present at review time will be included, regardless of the directory filter. Staff and teammate logins are excluded. You will see the exact count before saving.</p>}
      <h3>Choose fields to change</h3>
      {(Object.keys(fields) as Array<keyof Patch>).map(key=><div className="bulk-field" key={key}><label className="banking-check"><input type="checkbox" checked={fields[key]} onChange={e=>setFields(v=>({...v,[key]:e.target.checked}))}/>Apply {labels[key].toLowerCase()}</label>{fields[key]&&<label>New {labels[key].toLowerCase()}{key==='bankAccountType'?<select aria-label="New bank account type" value={values[key]} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}><option>Checking</option><option>Savings</option></select>:<input required maxLength={key==='routingNumber'?9:120} inputMode={key==='routingNumber'?'numeric':'text'} value={values[key]} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/>}</label>}</div>)}
      <label>Reason for bulk change<textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <button className="solid-btn" disabled={!Object.values(fields).some(Boolean)||(scope==='selected'&&!selected.length)}><Layers3 size={16}/>{busy?'Preparing…':'Review changes'}</button>
    </fieldset></form>}
  </section></div>;
}
