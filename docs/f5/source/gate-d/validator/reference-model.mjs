// Reference model of the deterministic engine rules, executable as a specification (NOT the F5 implementation).
// evaluateReadiness: MB3 §10 (+ D1 multi-country, + D12 ASSUMED). completionGate: D12. materiality: D11. classifier: D10 / §13.19.
import * as AST from "./ast-e1.mjs";

const STATE_ASKED = (s) => s !== undefined && s !== "NOT_ASKED";
const itemState = (v) => (v && typeof v === "object" && !Array.isArray(v) && "answer_state" in v ? { state: v.answer_state, value: v.value } : v === undefined || v === null || v === "" ? { state: "NOT_ASKED", value: undefined } : { state: "ANSWERED", value: v });

export function applicable(field, facts) {
  if (field.derived) return false; // derived facts are never asked, never gaps
  if (!field.applicability_rule) return true;
  return AST.evaluate(field.applicability_rule, facts);
}
function resolvedScalar(field, fact) {
  const st = fact?.answerState ?? "NOT_ASKED";
  if (["ANSWERED", "ZERO", "ASSUMED"].includes(st)) return true; // ASSUMED counts as resolved for readiness (D12)
  if (st === "EXPLICIT_NO") return field.type === "boolean";
  return false; // NOT_ASKED, UNKNOWN, WITHHELD = gaps (MB3 §7)
}
// returns {gaps:[{field_key, level, state, item?, detail}], pending:[…], notAsked:[…]}
function groupAnalysis(field, fact) {
  const items = Array.isArray(fact?.value) ? fact.value : [];
  const out = { itemGaps: [], itemPending: [], itemNotAsked: [], completeItems: 0 };
  items.forEach((it, idx) => {
    let complete = true;
    for (const sub of field.group_item_schema) {
      const { state, value } = itemState(it?.[sub.field_key]);
      if (sub.requirement_level !== "required") continue;
      if (state === "NOT_ASKED") { complete = false; out.itemGaps.push({ field_key: field.field_key, item: idx, sub: sub.field_key, state }); out.itemNotAsked.push({ field_key: field.field_key, item: idx, sub: sub.field_key }); }
      else if (["UNKNOWN", "WITHHELD"].includes(state)) { complete = false; out.itemGaps.push({ field_key: field.field_key, item: idx, sub: sub.field_key, state }); out.itemPending.push({ field_key: field.field_key, item: idx, sub: sub.field_key, state, execution_dependency: !!sub.execution_dependency }); }
      else if (state === "ASSUMED") out.itemPending.push({ field_key: field.field_key, item: idx, sub: sub.field_key, state, execution_dependency: !!sub.execution_dependency });
    }
    if (complete) out.completeItems++;
  });
  return out;
}

export function evaluateReadiness(manifest, facts, countries = []) {
  const fields = AST.effectiveFieldsMulti(manifest, countries);
  const res = { ready: false, blocking_gaps: [], required_gaps: [], conditional_gaps: [], supporting_gaps: [], informational_gaps: [], gaps: [], not_applicable: [] };
  const push = (level, gap) => { res[`${level}_gaps`]?.push(gap); };
  for (const f of fields) {
    if (!applicable(f, facts)) { res.not_applicable.push(f.field_key); continue; }
    const fact = facts[f.field_key];
    const level = f.requirement_level === "conditional" ? "conditional" : f.requirement_level;
    if (f.type === "repeatable_group") {
      const g = groupAnalysis(f, fact);
      const min = f.min_items ?? 1;
      if (g.completeItems < min) push(level, { field_key: f.field_key, kind: "min_items", have: g.completeItems, need: min });
      for (const ig of g.itemGaps) push(level, { ...ig, kind: "item" });
      continue;
    }
    if (!resolvedScalar(f, fact)) push(level, { field_key: f.field_key, kind: "field", state: fact?.answerState ?? "NOT_ASKED" });
  }
  for (const d of manifest.critical_decisions || []) {
    if (d.gates === "blocking" && !AST.evaluate(d.resolution_rule, facts)) res.blocking_gaps.push({ field_key: d.decision_key, kind: "decision", decision_kind: d.kind });
  }
  res.gaps = [...res.blocking_gaps, ...res.required_gaps, ...res.conditional_gaps, ...res.supporting_gaps, ...res.informational_gaps];
  res.ready = res.blocking_gaps.length === 0 && res.required_gaps.length === 0 && res.conditional_gaps.length === 0;
  return res;
}

// D12: closure gate = "addressed". Blocks: applicable blocking/required/conditional field NOT_ASKED; unacknowledged contradiction (consistency decision) or unconfirmed confirmation decision.
export function completionGate(manifest, facts, countries = []) {
  const fields = AST.effectiveFieldsMulti(manifest, countries);
  const notAsked = [], pending = [], pendingDecisions = [];
  for (const f of fields) {
    if (!applicable(f, facts)) continue;
    if (!["blocking", "required", "conditional"].includes(f.requirement_level)) {
      // supporting/informational never block; still listed when pending/assumed
      const st = facts[f.field_key]?.answerState;
      if (["UNKNOWN", "WITHHELD", "ASSUMED"].includes(st)) pending.push({ field_key: f.field_key, state: st, execution_dependency: !!f.execution_dependency });
      continue;
    }
    const fact = facts[f.field_key];
    if (f.type === "repeatable_group") {
      const items = Array.isArray(fact?.value) ? fact.value : [];
      const g = groupAnalysis(f, fact);
      if (items.length < (f.min_items ?? 1)) notAsked.push({ field_key: f.field_key, kind: "min_items" });
      for (const x of g.itemNotAsked) notAsked.push({ ...x, kind: "item" });
      for (const p of g.itemPending) pending.push(p);
      continue;
    }
    const st = fact?.answerState ?? "NOT_ASKED";
    if (st === "NOT_ASKED") notAsked.push({ field_key: f.field_key, kind: "field" });
    else if (["UNKNOWN", "WITHHELD", "ASSUMED"].includes(st)) pending.push({ field_key: f.field_key, state: st, execution_dependency: !!f.execution_dependency });
  }
  const unacknowledged = [];
  for (const d of manifest.critical_decisions || []) {
    const ok = AST.evaluate(d.resolution_rule, facts);
    if (ok) continue;
    if (d.kind === "path") pendingDecisions.push({ decision_key: d.decision_key });
    else unacknowledged.push({ decision_key: d.decision_key, kind: d.kind });
  }
  const canComplete = notAsked.length === 0 && unacknowledged.length === 0;
  const finalReview = pending.length > 0 || pendingDecisions.length > 0;
  return { canComplete, notAsked, unacknowledged, pending, pendingDecisions, final_pending_review: canComplete && finalReview, completed_with_pending: canComplete && finalReview,
           ready_for_provider_claims: false /* the CRP never asserts quality, validation or provider-readiness */ };
}

export function crpPendingSection(gate) {
  const label = (p) => ({ UNKNOWN: "Pending", WITHHELD: "Pending", ASSUMED: "Assumed" }[p.state] || "Confirmed");
  return gate.pending.map((p) => ({ ...p, label: label(p), execution_dependency_mark: !!p.execution_dependency }));
}

// ---------- D11 materiality ----------
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const num = (v) => (typeof v === "number" ? v : v && typeof v === "object" && typeof v.value === "number" ? v.value : v && typeof v === "object" && typeof v.amount === "number" ? v.amount : null);
function monthsBetween(a, b) { const [ya, ma] = String(a).split("-").map(Number); const [yb, mb] = String(b).split("-").map(Number); return Math.abs((yb - ya) * 12 + ((mb || 1) - (ma || 1))); }
export function isMaterialFieldChange(field, before, after, isStructural = false) {
  if (isStructural) return { material: true, reason: "structural event" };
  if (deepEq(before, after)) return { material: false, reason: "unchanged" };
  const pol = field.change_policy;
  if (pol === "operational") return { material: false, reason: "operational field" };
  if (pol === "any") return { material: true, reason: "change_policy any" };
  const t = field.change_threshold;
  if (field.type === "date" && t?.period_shift_months) { const m = monthsBetween(before, after); return { material: m >= t.period_shift_months, reason: `date shifted ${m} month(s), threshold ${t.period_shift_months}` }; }
  const nb = num(before), na = num(after);
  if (nb !== null && na !== null && t?.relative_pct) { const pct = nb === 0 ? (na === 0 ? 0 : 100) : (Math.abs(na - nb) / Math.abs(nb)) * 100; return { material: pct >= t.relative_pct, reason: `relative change ${pct.toFixed(1)}%, threshold ${t.relative_pct}%` }; }
  return { material: true, reason: "threshold not computable: conservative" };
}
export function materialChanges(manifest, beforeFacts, afterFacts) {
  const out = [];
  for (const f of manifest.fields) {
    if (f.derived) continue;
    const b = beforeFacts[f.field_key]?.value, a = afterFacts[f.field_key]?.value;
    if (f.type === "repeatable_group") {
      const bl = Array.isArray(b) ? b : [], al = Array.isArray(a) ? a : [];
      if (al.length !== bl.length && (f.field_key === "sa_studies" || f.field_key === "ed_engagements")) { out.push({ field_key: f.field_key, material: true, reason: "new/removed SA-ED need (structural)" }); continue; }
      if (al.length !== bl.length) { const r = isMaterialFieldChange(f, bl.length, al.length); out.push({ field_key: f.field_key, ...(f.change_policy === "operational" ? { material: false, reason: "operational field" } : { material: true, reason: "item added/removed on a non-operational group" }) }); continue; }
      al.forEach((it, i) => { for (const sub of f.group_item_schema) { const r = isMaterialFieldChange(sub, itemState(bl[i]?.[sub.field_key]).value, itemState(it?.[sub.field_key]).value); if (r.reason !== "unchanged") out.push({ field_key: f.field_key, item: i, sub: sub.field_key, ...r }); } });
      continue;
    }
    const r = isMaterialFieldChange(f, b, a);
    if (r.reason !== "unchanged") out.push({ field_key: f.field_key, ...r });
  }
  return out;
}
export const isMaterial = (changes) => changes.some((c) => c.material);

// ---------- D10 / §13.19 deterministic classifier (input = signals extracted from client text; the AI only proposes them) ----------
export function normalizeSlug(text) {
  return String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60).replace(/^([^a-z])/, "n$1");
}
export function classifyNeed(signals, pm, catalog) {
  // signals: {text, capability_ids[], service_key?, category_key?, existing_instance_keys[]}
  const text = String(signals.text || "").toLowerCase();
  const has = (arr) => (arr || []).some((t) => text.includes(String(t).toLowerCase()));
  const caps = new Set(signals.capability_ids || []);
  const existing = new Set(signals.existing_instance_keys || []);
  const oos = pm.out_of_scope_topics.find((t) => t.sources.capability_ids.some((c) => caps.has(c)) || has(t.sources.lexicon_en) || has(t.sources.lexicon_es));
  if (oos) return { scenario: "out_of_scope", topic_key: oos.topic_key, creates_workstream: false, creates_psm_version: false, notice_key: oos.notice_key };
  const cat = (k) => pm.candidate_categories.find((c) => c.category_key === k);
  const saC = cat("strategic_advisory"), edC = cat("ecosystem_development");
  const svc = signals.service_key && Object.entries(catalog).find(([, keys]) => keys.includes(signals.service_key));
  const saHit = (saC.capability_signals || []).some((c) => caps.has(c)) || has(saC.detection_signals_positive.en) || has(saC.detection_signals_positive.es);
  const edHit = (edC.capability_signals || []).some((c) => caps.has(c)) || has(edC.detection_signals_positive.en) || has(edC.detection_signals_positive.es);
  // genuine ambiguity: SA wording together with a catalog service the client already confirmed -> ask, never choose
  if (saHit && svc && !caps.size) return { scenario: "ambiguous", options: ["strategic_advisory", svc[0]], resolution: "ask_client_one_question" };
  if (saHit) return { scenario: "strategic_advisory", instance_key: "strategic_advisory", action: existing.has("strategic_advisory") ? "append_item" : "create_instance", item_array: "sa_studies" };
  if (edHit) return { scenario: "ecosystem_development", instance_key: "ecosystem_development", action: existing.has("ecosystem_development") ? "append_item" : "create_instance", item_array: "ed_engagements" };
  if (svc) return { scenario: "known_service", category_key: svc[0], service_key: signals.service_key, action: existing.has(svc[0]) ? "append_service" : "create_instance" };
  if (signals.category_key && cat(signals.category_key) && cat(signals.category_key).kind === "catalog") return { scenario: "unmapped_known_category", category_key: signals.category_key, block: "generic_unmapped_needs", internal_tag: "unmapped_known_category", action: existing.has(signals.category_key) ? "append_item" : "create_instance" };
  const known = pm.new_category_policy.known_candidates.find((k) => has([k.slug.replace(/_/g, " "), k.slug]) || (signals.capability_ids || []).includes(k.capability));
  const slug = normalizeSlug(known ? known.slug : (signals.proposed_slug || signals.text));
  if (catalog && Object.keys(catalog).includes(slug)) return { scenario: "known_category_exists", category_key: slug, note: "never create new:<slug> if the category exists" };
  const key = `new:${slug}`;
  return { scenario: "discovery", instance_key: key, manifest_category_key: "_generic", action: existing.has(key) ? "append_item" : "create_instance", crp_kind: "new_category_discovery", internal_label_visible_to_client: false };
}
export function addServiceAvailability({ paStatus, snapshotCount, projectActive }) { return paStatus === "confirmed" && snapshotCount >= 1 && projectActive === true; }
