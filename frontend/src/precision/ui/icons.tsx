import type { ReactNode } from "react";

/** One monochrome stroke icon set (currentColor). Category icons come from the DTO's iconKey; unknown keys fall back to a neutral glyph. */
const G: Record<string, ReactNode> = {
  "chevron-right": <path d="M9 5l7 7-7 7" />,
  "chevron-left": <path d="M15 5l-7 7 7 7" />,
  "chevron-down": <path d="M5 9l7 7 7-7" />,
  "arrow-right": <path d="M4 12h15M13 6l6 6-6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></>,
  alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.01" /></>,
  refresh: <path d="M20 11a8 8 0 0 0-14-4M4 5v4h4M4 13a8 8 0 0 0 14 4M20 19v-4h-4" />,
  print: <><path d="M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2" /><path d="M7 14h10v6H7z" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17v.01" /></>,
  send: <path d="M4 12l16-8-6 16-3-7z" />,
  doc: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5" />,
  // status shapes (never colour-only)
  "s-empty": <circle cx="12" cy="12" r="8" />,
  "s-half": <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" /></>,
  "s-review": <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" /></>,
  "s-done": <><circle cx="12" cy="12" r="8" fill="currentColor" stroke="none" /><path d="M8.2 12.4l2.7 2.7 5-5.4" stroke="var(--pz-chip-mark, #fff)" /></>,
  "s-sent": <><circle cx="12" cy="12" r="8" /><path d="M8.5 15.5l7-7M10 8.5h5.5V14" /></>,
  "s-assumed": <><circle cx="12" cy="12" r="8" /><path d="M8 13c1.3-2 2.7-2 4-1s2.7 1 4-1" /></>,
  "s-pending": <><circle cx="12" cy="12" r="8" strokeDasharray="2.6 2.6" /><path d="M12 8v4.2l2.6 1.6" /></>,
  "s-na": <><circle cx="12" cy="12" r="8" /><path d="M8.5 12h7" /></>,
  // categories
  truck: <><path d="M3 6h11v10H3zM14 9.5h4l3 3.5v3h-7" /><circle cx="7.5" cy="17.5" r="1.8" /><circle cx="17.5" cy="17.5" r="1.8" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></>,
  building: <><path d="M5 21V4h9v17M14 9h5v12M3 21h18M8.5 8h2M8.5 12h2M8.5 16h2" /></>,
  ledger: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8.5 8h7M8.5 12h2M13.5 12h2M8.5 16h2M13.5 16h2" /></>,
  people: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c.5-3.2 2.7-5 5.5-5s5 1.8 5.5 5M16 6.2a3 3 0 0 1 0 5.6M18 14.4c1.7.7 2.7 2.2 3 4.6" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
  nodes: <><circle cx="6" cy="7" r="2.2" /><circle cx="18" cy="7" r="2.2" /><circle cx="12" cy="18" r="2.2" /><path d="M8 7.6l8 0M7.2 8.9l3.8 7M16.8 8.9l-3.8 7" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>,
  dot: <circle cx="12" cy="12" r="3" />,
};
const ALIASES: Record<string, string> = {
  logistics: "truck", international_trade_customs: "globe", corporate_legal_admin: "building", tax_accounting_audit: "ledger",
  people_payroll_employment: "people", strategic_advisory: "compass", ecosystem_development: "nodes", to_review: "search",
};

export function Icon({ name, size = 20, className, title }: { name: string; size?: number; className?: string; title?: string }) {
  const key = G[name] ? name : ALIASES[name] && G[ALIASES[name]] ? ALIASES[name] : "dot";
  const glyph = G[key];
  return (
    <svg className={`pz-icon ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined} focusable="false">
      {title ? <title>{title}</title> : null}
      {glyph}
    </svg>
  );
}
