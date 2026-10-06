import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, BookOpen, Printer } from "lucide-react";
import { LEGAL_DOCUMENTS, LEGAL_REVISION, LEGAL_REVISION_LABEL, type LegalDocumentId } from "../content/legal";
import "../styles/legal.css";

export function LegalPage({ doc }: { doc: LegalDocumentId }) {
  const page = LEGAL_DOCUMENTS[doc];
  const { hash, key } = useLocation();
  const mobileContents = useRef<HTMLDetailsElement>(null);
  const words = page.sections.flatMap(section => section.paragraphs).join(" ").split(/\s+/).length;

  useEffect(() => {
    // Anchor navigation must move keyboard focus as well as the scroll position.
    if (!hash) return;
    document.getElementById(hash.slice(1))?.focus({ preventScroll: true });
  }, [doc, hash, key]);

  const contents = (
    <ol>
      {page.sections.map((section, index) => <li key={section.id}>
        <Link to={`/legal/${doc}#${section.id}`} onClick={() => { if (mobileContents.current) mobileContents.current.open = false; }}>
          <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>{section.title}
        </Link>
      </li>)}
    </ol>
  );

  return (
    <main className="legal-document">
      <header className="page-head legal-hero">
        <div>
          <span className="kicker">Veyra · Legal & transparency</span>
          <h1 id="legal-title">{page.title}</h1>
          <p>{page.summary}</p>
          <div className="legal-meta">
            <span>Revised <time dateTime={LEGAL_REVISION}>{LEGAL_REVISION_LABEL}</time></span>
            <span>{page.sections.length} sections · {Math.ceil(words / 220)} min read</span>
          </div>
        </div>
      </header>
      <div className="legal-reader">
        <aside className="legal-sidebar">
          <nav className="legal-contents" aria-label="On this page">
            <h2><BookOpen size={17} aria-hidden="true" /> On this page</h2>
            {contents}
          </nav>
        </aside>
        <article className="legal-article" aria-labelledby="legal-title">
          <nav className="legal-document-tabs" aria-label="Legal documents">
            {(Object.keys(LEGAL_DOCUMENTS) as LegalDocumentId[]).map(key => <Link key={key} to={`/legal/${key}`} aria-current={doc === key ? "page" : undefined}>{LEGAL_DOCUMENTS[key].title}</Link>)}
          </nav>
          <section className="legal-review-notice" aria-labelledby="review-status">
            <span className="legal-status">Review draft · Current preview</span>
            <h2 id="review-status">Important before you rely on these documents</h2>
            <p>These expanded documents describe the current product. They are not confirmation of regulatory approval, live banking partnerships or readiness to handle real funds. The contracting entity, launch jurisdiction, privacy contact and retention rules still require confirmation and qualified legal review before adoption as binding public policies.</p>
            <p>The revision date records this update; it does not establish renewed user consent. Use synthetic information in environments without connected providers.</p>
          </section>
          <div className="legal-update-summary">
            <h2>What this revision covers</h2>
            <p>Scout estimates without new savings credits; authenticated teammate spending limits and historical attribution gaps; server-confirmed internal payments; clearer balance and reporting explanations; and the data practices behind these features.</p>
            <button type="button" className="legal-print" onClick={() => window.print()}><Printer size={16} aria-hidden="true" /> Print or save a copy</button>
          </div>
          <details className="legal-mobile-contents" ref={mobileContents}>
            <summary><BookOpen size={17} aria-hidden="true" /> On this page <span>{page.sections.length} sections</span></summary>
            <nav className="legal-contents" aria-label="On this page">{contents}</nav>
          </details>
          <div className="legal-sections">
            {page.sections.map((section, index) => <section className="legal-section" key={section.id} aria-labelledby={section.id}>
              <h2 id={section.id} tabIndex={-1}><span>{String(index + 1).padStart(2, "0")}</span>{section.title}</h2>
              {section.paragraphs.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
              {section.id === "address-suggestions" && <p><a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noopener noreferrer">Google Maps Terms</a>{" · "}<a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google Privacy Policy</a></p>}
            </section>)}
          </div>
          <section className="legal-contact" aria-labelledby="legal-contact-title">
            <h2 id="legal-contact-title">Questions about this document?</h2>
            <p>Use the support form and name the document and section involved. For a privacy request, choose “Something else” and begin your message with “Privacy request.” Never include passwords, authentication codes or full government identifiers.</p>
            <Link to="/support#support-form" className="text-link">Contact support <ArrowRight size={16} aria-hidden="true" /></Link>
          </section>
          <nav className="legal-links" aria-label="Related legal documents">
            {(Object.keys(LEGAL_DOCUMENTS) as LegalDocumentId[]).filter(key => key !== doc).map(key => <Link key={key} to={`/legal/${key}`} className="text-link">{LEGAL_DOCUMENTS[key].title}<ArrowRight size={14} aria-hidden="true" /></Link>)}
          </nav>
        </article>
      </div>
    </main>
  );
}
