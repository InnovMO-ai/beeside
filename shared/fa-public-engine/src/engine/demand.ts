import type { Answers } from '../domain/answers';
import { OPEN_DEST } from '../domain/answers';
import type { Catalog, CapabilityStatus, CoverageState, FrontKey } from '../domain/types';
import type { Resolution, ResolvedCapability } from './resolve';

/**
 * Internal Demand Signals (CATALOG_MODEL §9, D-106/D-114). NEVER exposed to the customer.
 * One per project × destination × capability (or normalized need), deduplicated.
 */
export type DemandReason = 'SOURCEABLE' | 'REVIEW' | 'DEVELOPING' | 'NO_ACTIVE_COVERAGE' | 'UNMAPPED_NEED' | 'NOT_OFFERED';
export type DemandClass = 'ACTIONABLE' | 'INFORMATIONAL';
export type SourcingStatus = 'OPEN' | 'RESEARCHING' | 'SHORTLISTED' | 'BUSINESS_CHECK' | 'COVERED' | 'DISMISSED';
export type TriageStatus = 'PENDING' | 'INVESTIGATE' | 'NO_ACTION';

export interface DemandSignal {
  signalId: string;
  projectId: string;
  destination: string;
  basisValue: string | null;
  front: FrontKey | null;
  categoryId: string | null; serviceId: string | null; capabilityId: string | null;
  originalText: string | null;
  normalizedNeed: string;
  reason: DemandReason;
  class: DemandClass;
  capabilityStatus: CapabilityStatus | null;
  coverageState: CoverageState | 'UNAVAILABLE' | null;
  premiumState: 'NONE' | 'OFFERED' | 'ACTIVE';
  targetDate: string | null;
  createdAt: string;
  sourcingStatus: SourcingStatus | null;
  triageStatus: TriageStatus | null;
  owner: string | null;
  catalogVersion: string;
}

export function deriveDemandSignals(projectId: string, a: Answers, res: Resolution, catalog: Catalog, now = new Date()): DemandSignal[] {
  const out = new Map<string, DemandSignal>();
  const created = now.toISOString();
  const target = a.externalDate.has ? a.externalDate.date ?? null : null;

  const add = (s: Omit<DemandSignal, 'signalId' | 'projectId' | 'createdAt' | 'premiumState' | 'owner' | 'catalogVersion' | 'targetDate'>) => {
    const key = `${projectId}|${s.destination}|${s.capabilityId ?? `${s.front}:${s.normalizedNeed}`}|${s.reason}`;
    if (out.has(key)) return;
    out.set(key, { ...s, signalId: `ds_${out.size + 1}_${hash(key)}`, projectId, createdAt: created, premiumState: res.premiumShown ? 'OFFERED' : 'NONE', owner: null, catalogVersion: res.catalogVersion, targetDate: target });
  };
  const svcOf = (capId: string) => catalog.services.find((s) => s.serviceId === catalog.capabilities.find((c) => c.capabilityId === capId)?.serviceId);
  const mk = (dest: string, front: FrontKey | null, c: ResolvedCapability | null, reason: DemandReason, cls: DemandClass, text: string | null) => {
    const svc = c ? svcOf(c.capabilityId) : undefined;
    add({
      destination: dest, basisValue: c?.basisValue ?? null, front,
      categoryId: svc?.categoryId ?? null, serviceId: svc?.serviceId ?? null, capabilityId: c?.capabilityId ?? null,
      originalText: text, normalizedNeed: c?.capabilityId ?? front ?? 'UNMAPPED',
      reason, class: cls, capabilityStatus: c?.state ?? null, coverageState: c?.coverage ?? null,
      sourcingStatus: cls === 'ACTIONABLE' ? 'OPEN' : null, triageStatus: reason === 'UNMAPPED_NEED' ? 'PENDING' : null,
    });
  };

  for (const d of res.destinations) {
    if (d.destination === OPEN_DEST) continue;           // no signals while the destination is undefined (D-098)
    for (const n of d.needs) {
      if (n.state === 'DEPENDENT') continue;             // unresolved decision: nothing to source yet
      const text = n.declaredTexts.join(' / ') || null;
      if (d.countryMessage === 'DEVELOPING' || d.countryMessage === 'NO_ACTIVE_COVERAGE') {
        const first = n.capabilities[0] ?? null;
        mk(d.destination, n.front, first, d.countryMessage, 'ACTIONABLE', text);
        continue;
      }
      if (n.state === 'NOT_OFFERED') { mk(d.destination, n.front, n.capabilities[0] ?? null, 'NOT_OFFERED', 'INFORMATIONAL', text); continue; }
      for (const c of n.capabilities) {
        if (c.conditionalOn) continue;
        if (c.state === 'SOURCEABLE') mk(d.destination, n.front, c, 'SOURCEABLE', 'ACTIONABLE', text);
        else if (c.state === 'REVIEW' && c.kind === 'HIVE') mk(d.destination, n.front, c, 'REVIEW', 'ACTIONABLE', text);
        else if (c.state === 'NOT_OFFERED') mk(d.destination, n.front, c, 'NOT_OFFERED', 'INFORMATIONAL', text);
      }
    }
    for (const u of d.unmapped) {
      if (d.countryMessage) mk(d.destination, null, null, d.countryMessage as DemandReason, 'ACTIONABLE', u.text);
      else mk(d.destination, null, null, 'UNMAPPED_NEED', 'INFORMATIONAL', u.text);
    }
  }
  return [...out.values()];
}

function hash(s: string): string {
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---------- least-privilege access before Premium (D-109, D-113) ----------
export type InternalRole =
  | 'normalization' | 'catalog_maintenance' | 'coverage_planning' | 'product_ops_review'
  | 'sales_general' | 'provider' | 'sherpa_premium';
const RAW_ALLOWED: ReadonlySet<InternalRole> = new Set(['normalization', 'catalog_maintenance', 'coverage_planning', 'product_ops_review']);

export function canReadRawDemand(role: InternalRole, signal: Pick<DemandSignal, 'premiumState'>): boolean {
  if (signal.premiumState === 'ACTIVE') return role === 'sherpa_premium' || RAW_ALLOWED.has(role);   // need-to-know after Premium (D-051)
  return RAW_ALLOWED.has(role);
}

/** What providers (and general sales) may see before Premium: aggregated / generalized only — no project, text or identity. */
export interface AggregatedDemand { destination: string; capabilityId: string | null; categoryId: string | null; projects: number; class: DemandClass }
export function aggregateDemand(signals: DemandSignal[]): AggregatedDemand[] {
  const m = new Map<string, AggregatedDemand & { ids: Set<string> }>();
  for (const s of signals) {
    const k = `${s.destination}|${s.capabilityId ?? s.normalizedNeed}|${s.class}`;
    const e = m.get(k) ?? { destination: s.destination, capabilityId: s.capabilityId, categoryId: s.categoryId, projects: 0, class: s.class, ids: new Set<string>() };
    e.ids.add(s.projectId); e.projects = e.ids.size; m.set(k, e);
  }
  return [...m.values()].map(({ ids: _ids, ...rest }) => rest);
}
