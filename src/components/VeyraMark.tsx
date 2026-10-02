import type { SVGProps } from "react";

/** Original Veyra mark: two account streams joining into one secure balance path. */
export function VeyraMark({ className, title, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  const labelled = Boolean(title);
  return (
    <svg
      className={className}
      viewBox="0 0 36 36"
      fill="none"
      role={labelled ? "img" : undefined}
      aria-label={title}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      {...props}
    >
      <path d="M6.5 8.5h4.2a7.3 7.3 0 0 1 7.3 7.3v12" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M29.5 8.5h-4.2a7.3 7.3 0 0 0-7.3 7.3" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.2 23.2H18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" opacity=".68" />
      <circle cx="18" cy="29" r="1.7" fill="currentColor" />
    </svg>
  );
}