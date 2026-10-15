/**
 * The project frame reducer. Pure: (frame, governed interpretation, context) -> new frame + what changed.
 *
 * Product rules enforced here:
 *  - Depth is not confirmation: a clearly stated fact is KNOWN at once (no confirm button). The only things that need the client's
 *    word again are contradictions with Discovery / an earlier statement, ambiguity, and material inference (implied things stay
 *    `proposed` and never count for sufficiency).
 *  - Discovery is the starting hypothesis: its values enter as `discovery` provenance, are used (never re-asked) and are superseded
 *    only by a correction or after the client resolves the contradiction.
 *  - Nothing the client did not say is recorded as said: every item carries the client's quote (verified by the governor).
 *  - Priority is the client's: unprioritized is not "low", and execution dependencies are a different thing.
 */
import { conceptById } from "./concepts";
import { captureCrossCutting } from "./cross-cutting";
import { cleanDisplay } from "./governor";
import type { Interpretation, Observation } from "./interpreter";
import { probeByKey } from "./probes";
import type { CountryEntry, Frame, FrameItem, ImpliedItem, ItemStatus, Loc, NeedItem, Phase, PriorityGroup, Provenance } from "./types";

export interface ApplyContext {
  now: string;
  turnKey?: string;
  source: "client" | "discovery";
  /** Probe key of the question just asked (a bare answer binds to it). */
  asked: string | null;
  sourcePinId?: string;
  sourceItemRef?: string;
  /** The text the interpretation came from (used as the quote for status-only answers). */
  text: string;
}

export interface Change { kind: "item" | "country" | "phase" | "need" | "concept" | "rationale" | "priority" | "implied" | "note"; key: string; display?: string; updated?: boolean }
export interface Conflict { key: string; previous: FrameItem; incoming: Observation }
export interface Applied { frame: Frame; changes: Change[]; conflicts: Conflict[] }

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------ value merging
function mergeValues(key: string, prev: unknown, next: unknown): unknown {
  const p = prev as Record<string, unknown> | null;
  const n = next as Record<string, unknown> | null;
  const probe = probeByKey(key);
  if (probe?.merge) return probe.merge(prev, next);
  const union = (a: unknown, b: unknown): string[] => [...new Set([...(Array.isArray(a) ? (a as string[]) : []), ...(Array.isArray(b) ? (b as string[]) : [])])];
  switch (key) {
    case "entity.funding": return { ...(p ?? {}), ...(n ?? {}), sources: union(p?.sources, n?.sources).filter((s) => s !== "other" || union(p?.sources, n?.sources).length === 1) };
    case "tax.intercompany": {
      const kinds = union(p?.kinds, n?.kinds);
      const concrete = kinds.filter((k) => k !== "unspecified");
      return { kinds: concrete.length > 0 ? concrete : kinds, unspecified: concrete.length === 0 && kinds.length > 0 };
    }
    case "workforce.benefits": {
      const items = union(p?.items, n?.items);
      return { mode: items.length > 0 ? "above_minimum" : (n?.mode ?? p?.mode), items };
    }
    default: return next;
  }
}

function displayFor(key: string, merged: unknown, fallback: string, loc: Loc): string {
  const m = merged as Record<string, unknown> | null;
  if (key === "entity.funding" && Array.isArray(m?.sources) && (m!.sources as string[]).length > 1) {
    const label = (s: string): string => ({ parent: loc === "es" ? "la casa matriz" : "the parent company", local_credit: loc === "es" ? "crédito local" : "local credit", project_revenue: loc === "es" ? "ingresos del proyecto" : "project revenue", own_funds: loc === "es" ? "recursos propios" : "own funds" })[s] ?? s;
    return (m!.sources as string[]).filter((s) => s !== "other").map(label).join(", ") || fallback;
  }
  if (key === "tax.intercompany" && Array.isArray(m?.kinds)) return (m!.kinds as string[]).filter((k) => k !== "unspecified").join(", ") || fallback;
  if (key === "workforce.benefits" && Array.isArray(m?.items) && (m!.items as string[]).length > 0) return (m!.items as string[]).join(", ");
  if (key === "workforce.split" && m) {
    const parts: string[] = [];
    if (typeof m.direct === "number") parts.push(loc === "es" ? `${m.direct} directas` : `${m.direct} direct`);
    if (typeof m.outsourced === "number") parts.push(loc === "es" ? `${m.outsourced} subcontratadas` : `${m.outsourced} outsourced`);
    if (typeof m.directPct === "number") parts.push(loc === "es" ? `${m.directPct}% directas` : `${m.directPct}% direct`);
    if (typeof m.outsourcedPct === "number") parts.push(loc === "es" ? `${m.outsourcedPct}% subcontratadas` : `${m.outsourcedPct}% outsourced`);
    if (m.half) parts.push(loc === "es" ? "mitad y mitad" : "half and half");
    return parts.join(", ") || fallback;
  }
  return fallback;
}

const STRENGTH: Record<Provenance, number> = { ai_understood: 1, discovery: 2, client_stated: 3, client_confirmed: 4, client_corrected: 5 };

// ------------------------------------------------------------------ apply
export function applyInterpretation(prev: Frame, interp: Interpretation, ctx: ApplyContext): Applied {
  const frame = clone(prev);
  const changes: Change[] = [];
  const conflicts: Conflict[] = [];
  const fromDiscovery = ctx.source === "discovery";
  const prov: Provenance = fromDiscovery ? "discovery" : "client_stated";
  const loc = frame.locale;

  // ---- concepts
  for (const c of interp.concepts) {
    if (!frame.concepts[c.id]) {
      frame.concepts[c.id] = { first: c.quote, origin: fromDiscovery ? "discovery" : "client" };
      changes.push({ kind: "concept", key: c.id });
    }
  }

  // ---- countries
  for (const c of interp.countries) {
    const existing = frame.countries.find((x) => x.code === c.code && x.role === c.role);
    if (existing) {
      if (c.phase !== undefined && existing.phase === undefined) existing.phase = c.phase;
      continue;
    }
    const entry: CountryEntry = { code: c.code, role: c.role, provenance: prov, quote: c.quote, at: ctx.now };
    if (c.phase !== undefined) entry.phase = c.phase;
    if (ctx.sourceItemRef) entry.sourceItemRef = ctx.sourceItemRef;
    // A country previously recorded with a vaguer role is upgraded rather than duplicated.
    const vague = frame.countries.findIndex((x) => x.code === c.code && x.role === "unspecified");
    if (vague >= 0) frame.countries.splice(vague, 1);
    frame.countries.push(entry);
    changes.push({ kind: "country", key: `${c.code}:${c.role}` });
  }

  // ---- phases (a richer reading replaces a poorer one)
  if (interp.phases.length >= 2 && interp.phases.length >= frame.phases.length) {
    const phases: Phase[] = interp.phases.map((p, i) => ({ id: `p${i + 1}`, order: i + 1, label: p.label, countries: p.countries, provenance: prov, quote: p.quote, at: ctx.now }));
    if (!same(phases.map((p) => [p.label, p.countries]), frame.phases.map((p) => [p.label, p.countries]))) {
      frame.phases = phases;
      changes.push({ kind: "phase", key: "phases", display: phases.map((p) => p.label).join(" → ") });
    }
  }

  // ---- observations
  const seenKeys = new Set<string>();
  for (const o of interp.observations) {
    seenKeys.add(o.key);
    const probe = probeByKey(o.key);
    if (!probe) continue;
    const prevItem = frame.items[o.key];
    const status: ItemStatus = o.status ?? (o.interpretive === "implicit" ? "proposed" : "known");
    const base: FrameItem = {
      key: o.key, value: o.value, display: o.display, status,
      provenance: o.interpretive === "implicit" ? "ai_understood" : prov,
      interpretive: o.interpretive, quote: o.quote, at: ctx.now,
      ...(o.why ? { why: o.why } : {}),
      ...(ctx.turnKey ? { turnKey: ctx.turnKey } : {}),
      ...(ctx.sourcePinId ? { sourcePinId: ctx.sourcePinId } : {}),
      ...(ctx.sourceItemRef ? { sourceItemRef: ctx.sourceItemRef } : {}),
      ...(o.confidence !== undefined ? { confidence: o.confidence } : {}),
    };

    if (!prevItem || prevItem.status === "unknown" || prevItem.status === "withheld" || (prevItem.status === "needs_review" && !fromDiscovery)) {
      // A real value replaces a "don't know"; a proposal never replaces knowledge.
      if (prevItem && status === "proposed" && prevItem.status === "needs_review") continue;
      frame.items[o.key] = base;
      changes.push({ kind: "item", key: o.key, display: o.display, updated: Boolean(prevItem) });
      continue;
    }

    if (status === "proposed" && (prevItem.status === "known" || prevItem.status === "undecided")) continue; // never downgrade knowledge
    if (prevItem.status === "proposed" || prevItem.status === "undecided") {
      frame.items[o.key] = { ...base, provenance: base.provenance };
      changes.push({ kind: "item", key: o.key, display: o.display, updated: true });
      continue;
    }

    // Known before.
    const mergedValue = mergeValues(o.key, prevItem.value, o.value);
    if (same(mergedValue, prevItem.value)) {
      // Same knowledge: keep the stronger provenance, refresh the time (freshness).
      prevItem.at = ctx.now;
      if (STRENGTH[base.provenance] > STRENGTH[prevItem.provenance]) prevItem.provenance = base.provenance;
      continue;
    }
    const additive = ["workforce.split", "entity.funding", "tax.intercompany", "workforce.benefits"].includes(o.key) && !interp.correction;
    if (additive) {
      frame.items[o.key] = { ...prevItem, value: mergedValue, display: cleanDisplay(displayFor(o.key, mergedValue, o.display, loc)), at: ctx.now, quote: o.quote, status: "known", provenance: prevItem.provenance === "discovery" ? "client_stated" : prevItem.provenance };
      changes.push({ kind: "item", key: o.key, display: frame.items[o.key]!.display, updated: true });
      continue;
    }
    const correcting = interp.correction || ctx.asked === o.key;
    if (prevItem.provenance === "discovery" && !correcting && !fromDiscovery) {
      // The client says something different from what Discovery established, without saying it is a correction: ask, do not overwrite.
      conflicts.push({ key: o.key, previous: prevItem, incoming: o });
      continue;
    }
    if (fromDiscovery) continue; // Discovery never overwrites what the client has said in Precision
    const wasDiscovery = prevItem.provenance === "discovery";
    frame.items[o.key] = { ...base, provenance: correcting ? "client_corrected" : "client_stated" };
    if (wasDiscovery) frame.changedSinceDiscovery.push({ key: o.key, from: prevItem.display, to: o.display, at: ctx.now });
    changes.push({ kind: "item", key: o.key, display: o.display, updated: true });
  }

  // ---- status-only answers to the question just asked ("no lo sé", "prefiero no decirlo", "aún no está decidido", a bare no)
  if (!fromDiscovery && ctx.asked && !seenKeys.has(ctx.asked)) {
    const probe = probeByKey(ctx.asked);
    let st: ItemStatus | null = null;
    let display = "";
    if (interp.answerState) {
      st = interp.answerState === "unknown" ? "unknown" : interp.answerState === "withheld" ? "withheld" : "undecided";
      display = loc === "es"
        ? ({ unknown: "Aún no lo saben", withheld: "Prefieren no compartirlo", undecided: "Todavía no está definido" })[st as "unknown" | "withheld" | "undecided"]
        : ({ unknown: "Not known yet", withheld: "Prefer not to share", undecided: "Not decided yet" })[st as "unknown" | "withheld" | "undecided"];
    } else if (interp.yesNo === "no" && probe?.onNo) {
      st = probe.onNo;
      display = loc === "es" ? "Todavía no está definido" : "Not decided yet";
    }
    if (st && probe) {
      const prevItem = frame.items[ctx.asked];
      if (!prevItem || prevItem.status === "proposed" || prevItem.status === "needs_review") {
        frame.items[ctx.asked] = { key: ctx.asked, value: null, display, status: st, provenance: "client_stated", interpretive: "observed", quote: cleanDisplay(ctx.text, 160), at: ctx.now, ...(ctx.turnKey ? { turnKey: ctx.turnKey } : {}) };
        changes.push({ kind: "item", key: ctx.asked, display });
      }
    }
  }

  // ---- cross-cutting material facts: stated by the client, owned by no single category (kept with their own words, available to all)
  if (!fromDiscovery && ctx.source === "client") {
    const fresh = captureCrossCutting(ctx.text, frame.crossCutting ?? [], ctx.now, prov);
    if (fresh.length > 0) {
      frame.crossCutting = [...(frame.crossCutting ?? []), ...fresh];
      for (const x of fresh) changes.push({ kind: "note", key: x.id, display: x.quote });
    }
  }

  // ---- needs (client words first; the catalog only enriches)
  for (const n of interp.needs) {
    if (n.covered) {
      if (!frame.notes.some((x) => x.text.includes(n.quote))) { frame.notes.push({ text: `Ya cubierto por el cliente: ${n.quote}`.slice(0, 220), at: ctx.now }); changes.push({ kind: "note", key: n.conceptIds[0] ?? "covered" }); }
      continue;
    }
    const cid = n.conceptIds[0];
    const def = cid ? conceptById(cid) : undefined;
    const id = cid ? `n:${cid}` : `n:u:${slug(n.text)}`;
    // The same need mentioned again (or already known from Discovery under another identifier) is ONE need.
    const existing = frame.needs.find((x) => x.id === id || (cid !== undefined && x.conceptIds.includes(cid)));
    if (existing) {
      if (existing.status === "removed" && !fromDiscovery && ctx.source === "client") continue; // the client removed it; a repeated mention does not resurrect it silently
      if (!existing.quote && n.quote) existing.quote = n.quote;
      continue;
    }
    const item: NeedItem = {
      id, text: n.text, conceptIds: n.conceptIds, resolution: n.resolution, categoryKey: def?.category ?? null, serviceKeys: def?.services ?? [], status: "proposed",
      origin: fromDiscovery ? "discovery" : "narrative", quote: n.quote, at: ctx.now,
    };
    frame.needs.push(item);
    changes.push({ kind: "need", key: id, display: def ? def.label[loc] : n.text });
  }

  // ---- rationale (why)
  for (const r of interp.rationale) {
    if (frame.rationale.some((x) => x.text === r.text)) continue;
    frame.rationale.push({ id: `r${frame.rationale.length + 1}`, subject: r.subject, text: r.text, quote: r.quote, at: ctx.now });
    changes.push({ kind: "rationale", key: r.subject });
  }
  const whyObs = interp.observations.find((o) => o.key === "project.why");
  if (whyObs && !frame.rationale.some((x) => x.text === String(whyObs.value))) {
    frame.rationale.push({ id: `r${frame.rationale.length + 1}`, subject: "project", text: String(whyObs.value).slice(0, 240), quote: whyObs.quote, at: ctx.now });
  }

  // ---- priorities (the client's, never the catalog's)
  if (!fromDiscovery && interp.priorities.length > 0) {
    const groups: PriorityGroup[] = frame.priority.groups.map((g) => ({ ...g, subjects: [...g.subjects] }));
    for (const p of interp.priorities) {
      for (const g of groups) g.subjects = g.subjects.filter((s) => !p.subjects.includes(s));
      let g = groups.find((x) => x.rank === p.rank && (x.reason ?? "") === (p.reason ?? ""));
      if (!g) {
        g = { rank: p.rank, subjects: [], ...(p.reason ? { reason: p.reason } : {}), ...(p.timing ? { timing: p.timing } : {}) };
        groups.push(g);
      }
      g.subjects.push(...p.subjects);
    }
    frame.priority = { status: "client_set", groups: groups.filter((g) => g.subjects.length > 0), at: ctx.now, askedCount: frame.priority.askedCount };
    changes.push({ kind: "priority", key: "priority" });
  }

  deriveContext(frame, ctx.now, changes);
  frame.version += 1;
  return { frame, changes, conflicts };
}

const slug = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "need";

/** Concepts the facts imply (goods crossing borders) and the proposals concept implications produce. Idempotent. */
export function deriveContext(frame: Frame, now: string, changes: Change[] = []): void {
  const product = frame.items["product.what"];
  const origin = frame.countries.some((c) => c.role === "origin" || c.role === "headquarters");
  const dest = frame.countries.some((c) => c.role === "operation" || c.role === "sales");
  if (product?.status === "known" && origin && dest && !frame.concepts.goods_movement) {
    frame.concepts.goods_movement = { first: product.quote ?? "", origin: "client" };
    changes.push({ kind: "concept", key: "goods_movement" });
  }
  if (frame.items["workforce.headcount"]?.status === "known" && !frame.concepts.workforce_presence) frame.concepts.workforce_presence = { first: frame.items["workforce.headcount"]!.quote ?? "", origin: "client" };

  const needConcepts = new Set(frame.needs.filter((n) => n.status !== "removed").flatMap((n) => n.conceptIds));
  for (const id of Object.keys(frame.concepts)) {
    const def = conceptById(id);
    for (const imp of def?.implies ?? []) {
      if (needConcepts.has(imp.concept)) continue;
      const target = conceptById(imp.concept);
      if (!target) continue;
      const iid = `imp:${id}->${imp.concept}`;
      if (frame.implied.some((x) => x.id === iid)) continue;
      const item: ImpliedItem = {
        id: iid, kind: target.kind === "need" ? "implied_need" : "attribute", conceptId: imp.concept,
        text: { es: target.label.es, en: target.label.en }, reason: imp.reason, premises: [id], status: "proposed", at: now,
      };
      frame.implied.push(item);
      changes.push({ kind: "implied", key: iid });
    }
  }
}

// ------------------------------------------------------------------ client decisions on proposals / contradictions
export function resolveImplied(frame: Frame, impliedId: string, accept: boolean, now: string): Frame {
  const f = clone(frame);
  const item = f.implied.find((x) => x.id === impliedId);
  if (!item) return f;
  item.status = accept ? "accepted" : "rejected";
  if (accept) {
    const def = conceptById(item.conceptId);
    if (def?.kind === "need" && !f.needs.some((n) => n.conceptIds.includes(def.id) && n.status !== "removed")) {
      f.needs.push({ id: `n:${def.id}`, text: def.label[f.locale], conceptIds: [def.id], resolution: def.category ? "resolved" : "unresolved", categoryKey: def.category ?? null, serviceKeys: def.services ?? [], status: "proposed", origin: "implied", why: item.reason[f.locale], at: now });
    }
    if (!f.concepts[item.conceptId]) f.concepts[item.conceptId] = { first: item.reason[f.locale], origin: "client" };
  }
  f.version += 1;
  return f;
}

/** The client settles a contradiction: keep the new value or the earlier one. */
export function resolveConflict(frame: Frame, c: Conflict, choice: "new" | "previous", now: string): Frame {
  const f = clone(frame);
  if (choice === "new") {
    const o = c.incoming;
    f.changedSinceDiscovery.push({ key: c.key, from: c.previous.display, to: o.display, at: now });
    f.items[c.key] = { key: c.key, value: o.value, display: o.display, status: "known", provenance: "client_corrected", interpretive: o.interpretive, quote: o.quote, at: now };
  } else if (f.items[c.key]) {
    f.items[c.key]!.status = "known";
    f.items[c.key]!.at = now;
  }
  f.version += 1;
  return f;
}
