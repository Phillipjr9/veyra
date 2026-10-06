import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiPost } from "../lib/api";
import { authConfig } from "../lib/authConfig";
import "../styles/address-field.css";

export type SelectedAddress = { street: string; unit: string; city: string; state: string; postalCode: string; country: string };
type Suggestion = { placeId: string; label: string };
type Attribution = { name: string; url?: string };

export function AddressField({ id, value, onChange, onSelect, revision, country, nextFieldId, placeholder }: {
  id: string; value: string; onChange: (value: string) => void; onSelect: (address: SelectedAddress) => void;
  /** Changes to any related field invalidate an in-flight detail lookup. */
  revision: string; country: string; nextFieldId: string; placeholder: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [manual, setManual] = useState(false);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [attributions, setAttributions] = useState<Attribution[]>([]);
  const searchSequence = useRef(0), detailSequence = useRef(0);
  const searchController = useRef<AbortController | null>(null), detailController = useRef<AbortController | null>(null);
  const session = useRef({ token: "", created: 0 });
  const latestRevision = useRef(revision);
  latestRevision.current = revision;
  const supported = /^(united states(?: of america)?|us|usa)$/i.test(country.trim());
  const canSuggest = enabled && !manual && supported;
  const expanded = focused && suggestions.length > 0 && canSuggest;
  const listId = `${id}-suggestions`, helpId = `${id}-help`;

  useEffect(() => {
    let mounted = true;
    void authConfig().then(config => { if (mounted) setEnabled(config.addresses.enabled); });
    return () => { mounted = false; searchSequence.current++; detailSequence.current++; searchController.current?.abort(); detailController.current?.abort(); };
  }, []);
  function cancel() {
    searchSequence.current++; detailSequence.current++;
    searchController.current?.abort(); detailController.current?.abort();
    setSuggestions([]); setActive(-1); setBusy(false);
  }
  useEffect(() => {
    const version = ++searchSequence.current;
    const controller = new AbortController();
    searchController.current = controller;
    setSuggestions([]); setActive(-1);
    if (!canSuggest || !focused || value.trim().length < 3) return;
    const timer = window.setTimeout(async () => {
      setBusy(true); setMessage("");
      try {
        if (!session.current.token || Date.now() - session.current.created > 120_000) session.current = { token: crypto.randomUUID(), created: Date.now() };
        const response = await apiPost<{ suggestions: Suggestion[] }>("/api/address/autocomplete", { input: value, sessionToken: session.current.token }, { signal: controller.signal, handleUnauthorized: false });
        if (version !== searchSequence.current || controller.signal.aborted) return;
        setSuggestions(response.suggestions);
        setMessage(response.suggestions.length ? `${response.suggestions.length} suggestions. Use the arrow keys and Enter to select.` : "No matching suggestions. You can enter the address manually.");
      } catch {
        if (version === searchSequence.current && !controller.signal.aborted) setMessage("Suggestions are unavailable. Continue with manual entry.");
      } finally { if (version === searchSequence.current) setBusy(false); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); searchSequence.current++; };
  }, [value, canSuggest, focused]);

  async function choose(suggestion: Suggestion) {
    const token = session.current.token;
    cancel(); setFocused(false); setBusy(true); setMessage("Filling the selected address…");
    const version = ++detailSequence.current, snapshot = latestRevision.current;
    const controller = new AbortController(); detailController.current = controller;
    session.current = { token: "", created: 0 }; // Selection ends this Google session, including failures.
    try {
      const response = await apiPost<{ address: SelectedAddress; attributions: Attribution[] }>("/api/address/details", { placeId: suggestion.placeId, sessionToken: token }, { signal: controller.signal, handleUnauthorized: false });
      if (version !== detailSequence.current || controller.signal.aborted) return;
      if (snapshot !== latestRevision.current) { setMessage("Your address changed during lookup. Your edits were kept."); return; }
      onSelect(response.address); setAttributions(response.attributions);
      setMessage("Address filled. Check the city, state and ZIP, and add your apartment or suite if needed.");
      document.getElementById(nextFieldId)?.focus();
    } catch {
      if (version === detailSequence.current && !controller.signal.aborted) setMessage("That address could not be filled. Enter it manually or search again.");
    } finally { if (version === detailSequence.current) setBusy(false); }
  }
  return <div className="address-field">
    <input id={id} required role={canSuggest ? "combobox" : undefined} aria-autocomplete={canSuggest ? "list" : undefined} aria-expanded={canSuggest ? expanded : undefined}
      aria-controls={expanded ? listId : undefined} aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
      aria-describedby={helpId} autoComplete={canSuggest ? "off" : "address-line1"} maxLength={160}
      value={value} placeholder={placeholder} onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); cancel(); }}
      onChange={event => { cancel(); setFocused(true); setAttributions([]); setMessage(""); onChange(event.target.value); }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); cancel(); setFocused(false); setMessage(""); }
        if (expanded && ["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault(); const next = event.key === "ArrowDown" ? (active + 1) % suggestions.length : (active <= 0 ? suggestions.length : active) - 1;
          setActive(next); document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: "nearest" });
        }
        if (expanded && event.key === "Enter") { event.preventDefault(); if (active >= 0) void choose(suggestions[active]); }
      }} />
    {expanded && <div className="address-results">
      <ul id={listId} role="listbox" aria-label="Address suggestions">
        {suggestions.map((suggestion, index) => <li key={suggestion.placeId} id={`${id}-option-${index}`} role="option" aria-selected={active === index}
          onMouseDown={event => event.preventDefault()} onClick={() => void choose(suggestion)}>{suggestion.label}</li>)}
      </ul>
      <div className="address-attribution"><span translate="no">Google Maps</span></div>
    </div>}
    <div className="address-help" id={helpId}>
      {enabled ? <>
        <p>{manual ? "Manual entry selected. No address searches are sent to Google." : supported ? "Optional US address suggestions by Google. As you type, address text is sent to Google through Veyra; no SSN or other form fields are sent." : "Suggestions support US addresses only. Enter the address manually."}</p>
        <button type="button" className="address-mode" onClick={() => { cancel(); setManual(current => !current); session.current = { token: "", created: 0 }; setMessage(""); }}>{manual ? "Use Google suggestions" : "Enter address manually"}</button>
        <p><Link to="/legal/privacy#address-suggestions" target="_blank" rel="noopener noreferrer">Address privacy</Link> · <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a></p>
      </> : <p>Enter your full street address. Google suggestions are not enabled in this environment.</p>}
    </div>
    <p className="address-status" role="status">{busy ? "Looking up address…" : message}</p>
    {attributions.length > 0 && <div className="address-providers">Address data: {attributions.map((a, index) => a.url ? <a key={index} href={a.url} target="_blank" rel="noopener noreferrer">{a.name}</a> : <span key={index}>{a.name}</span>)}</div>}
  </div>;
}
