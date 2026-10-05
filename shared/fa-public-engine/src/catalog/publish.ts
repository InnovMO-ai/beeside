import type { Capability, Catalog, PublicationStatus } from '../domain/types';

/** Validation rules when publishing (CATALOG_MODEL §5). Returns human-readable errors; empty = publishable. */
export function validateCapabilityForPublish(cap: Capability, catalog: Catalog): string[] {
  const errs: string[] = [];
  const frontKeys = new Set(catalog.fronts.map((f) => f.key));
  if (!cap.fronts.length) errs.push('capability needs at least one existing front');
  for (const f of cap.fronts) if (!frontKeys.has(f.front)) errs.push(`front ${f.front} does not exist in the Front Catalog (new fronts are a product change, D-104)`);
  if (!cap.nameEs?.trim() || !cap.nameEn?.trim()) errs.push('ES and EN names are required');
  if (!cap.capabilityStatus) errs.push('capability_status is required');
  if (!cap.coverageBasis) errs.push('coverage_basis is required');
  if (cap.fronts.some((f) => f.match === 'SPECIFIC') && !cap.triggerRule && (!cap.triggerTermsEs.length || !cap.triggerTermsEn.length))
    errs.push('SPECIFIC capabilities need trigger_terms in ES and EN');
  if (cap.capabilityStatus === 'SOURCEABLE' && !cap.sourcingPolicy?.trim()) errs.push('SOURCEABLE needs an explicit sourcing policy in the change reason');
  if (cap.dependsOn !== undefined && cap.dependsOn !== 'own_entity') errs.push('dependsOn must be a known dependency');
  const service = catalog.services.find((s) => s.serviceId === cap.serviceId);
  if (!service) errs.push(`service ${cap.serviceId} does not exist`);
  return errs;
}

/** A trigger term already used by another capability of the same front yields a warning (rule 5). */
export function triggerTermWarnings(cap: Capability, catalog: Catalog): string[] {
  const warns: string[] = [];
  const terms = new Set([...cap.triggerTermsEs, ...cap.triggerTermsEn].map((t) => t.toLowerCase()));
  for (const other of catalog.capabilities) {
    if (other.capabilityId === cap.capabilityId || other.publicationStatus !== 'PUBLISHED') continue;
    if (!other.fronts.some((f) => cap.fronts.some((g) => g.front === f.front))) continue;
    for (const t of [...other.triggerTermsEs, ...other.triggerTermsEn]) if (terms.has(t.toLowerCase())) warns.push(`trigger term "${t}" is already used by ${other.capabilityId}`);
  }
  return warns;
}

/** Only PUBLISHED records affect customer-facing results; ACTIVE shows only with CONFIRMED coverage (rule 4 enforced in the resolver). */
export function publishedOnly(catalog: Catalog): Catalog {
  const ok = (s: PublicationStatus) => s === 'PUBLISHED';
  const caps = catalog.capabilities.filter((c) => ok(c.publicationStatus));
  const services = catalog.services.filter((s) => ok(s.publicationStatus) && caps.some((c) => c.serviceId === s.serviceId)); // a service receives needs only with ≥1 PUBLISHED capability
  const categories = catalog.categories.filter((c) => ok(c.publicationStatus));
  return { ...catalog, capabilities: caps.filter((c) => services.some((s) => s.serviceId === c.serviceId)), services, categories };
}
