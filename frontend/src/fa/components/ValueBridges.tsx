import { RenderedValueBridge } from "../types";

/**
 * ValueBridges — "beeside can help" (Macroblock 7, Snapshot Runtime Convergence), wiring the approved
 * library (`snapshot-etapa2-value-bridges-ronda-final.md`, Product Owner decision 2026-09-24) into the
 * live Snapshot for the first time. Reusable across the Virtual Snapshot and the PDF Snapshot.
 *
 * Deliberately NOT the frozen mockup's fixed, always-shown "beeside-value" block (all institutional
 * pillars + a provider-comparison table + the Premium CTA) — that block duplicates content already
 * owned by PrecisionTransition/HowBeesideWorks and the Premium activation flow, and showing every
 * pillar unconditionally is exactly what the approved Etapa 2 rule forbids ("at most 2–3 relevant
 * bridges, never one per section, never the same institutional component repeated"). What renders
 * here is the selective, evidence-triggered set `compose.ts`/`value-bridges.ts` already computed —
 * at most 3, each tied to something real in this project's own declared answers, never a purchase CTA.
 */
export function ValueBridges({ bridges }: { bridges: RenderedValueBridge[] }) {
  if (bridges.length === 0) return null;
  return (
    <section className="snapshot-section value-bridges" aria-labelledby="value-bridges-title">
      <h2 className="section-title" id="value-bridges-title">
        {bridges[0].eyebrow}
      </h2>
      <div className="value-bridge-grid">
        {bridges.map((bridge) => (
          <div className="value-bridge-card" key={bridge.key}>
            <h3 className="value-bridge-heading">{bridge.heading}</h3>
            <p className="value-bridge-body">{bridge.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
