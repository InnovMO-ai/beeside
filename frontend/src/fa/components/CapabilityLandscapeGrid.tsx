import { NeedsMapStatus, RenderedNeedsLandscapeItem } from "../types";

/**
 * CapabilityLandscapeGrid (Design Specification, build-order item ~13; Level 2 MVP §3.5 "Capability
 * Landscape"). Reusable across the Virtual Snapshot and the PDF Snapshot.
 *
 * Every declared need with its coverage status — never a provider name, and coverage is never framed
 * as a purchase decision or an offer. `status` is a stable key used only to pick an icon and a tone;
 * `statusLabel` is the only wording ever shown, so nothing here depends on color alone. This uses its
 * own five-state visual scale (distinct from the three-tone well_defined/needs_attention/resolve_early
 * palette used for Snapshot findings and from the Expansion Profile's definition-tier scale) because
 * coverage status is a different kind of fact from either of those.
 */

function StatusIcon({ status }: { status: NeedsMapStatus }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  switch (status) {
    case "covered_internally":
    case "covered_by_provider":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "in_progress":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M12 7v5.5l3.6 2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "needs_resolution":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d="M12 6.5v7" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
          <circle cx="12" cy="17" r="1.4" fill="#fff" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
  }
}

type NeedsLandscape = { title: string; intro: string; items: RenderedNeedsLandscapeItem[] };

export function CapabilityLandscapeGrid({ landscape }: { landscape: NeedsLandscape }) {
  if (landscape.items.length === 0) return null;

  return (
    <section className="capability-landscape" aria-labelledby="capability-landscape-title">
      <h2 className="section-title" id="capability-landscape-title">
        {landscape.title}
      </h2>
      <p className="helper">{landscape.intro}</p>

      <ul className="capability-landscape-grid">
        {landscape.items.map((item) => (
          <li key={item.key} className={`capability-landscape-item needs-status-${item.status}`}>
            <span className="capability-landscape-label">{item.label}</span>
            <span className="status-chip">
              <StatusIcon status={item.status} />
              <span>{item.statusLabel}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
