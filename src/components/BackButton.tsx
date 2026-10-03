import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

/**
 * True when this tab has somewhere to go back to. Opening a link in a fresh tab
 * (or landing on a deep link) leaves index 0, where "back" would close the app
 * instead of navigating it.
 */
export function canGoBack(): boolean {
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === "number" && state.idx > 0;
}

type BackButtonProps = {
  /** Where to go when there is nothing to go back to. */
  fallback?: string;
  label?: string;
  className?: string;
};

/**
 * Returns to the previous page. Rendered by every app shell and by the site
 * header, so there is always a way back without reaching for the browser.
 */
export function BackButton({ fallback = "/app", label = "Back", className = "" }: BackButtonProps) {
  const navigate = useNavigate();
  const goBack = () => {
    if (canGoBack()) navigate(-1);
    else navigate(fallback, { replace: true });
  };
  return (
    <button type="button" className={`back-btn ${className}`.trim()} onClick={goBack} aria-label={label} title={label}>
      <ArrowLeft size={15} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
