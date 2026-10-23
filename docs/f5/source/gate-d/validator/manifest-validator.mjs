// Prototype publish-time validator for category manifests (authoring standard §2.9, extended).
// Pure data checks; no I/O except in the CLI wrapper. Each finding: {check, severity, manifest, where, message}
import * as AST from "./ast-e1.mjs";

export const TYPES = new Set(["text", "number", "number_with_unit", "money", "boolean", "date", "enum", "multi_enum", "country_list", "text_list", "language_list", "repeatable_group", "text_or_language_code_list"]);
export const LEVELS = new Set(["blocking", "required", "conditional", "supporting", "informational"]);
const FIELD_KEY = /^[a-z][a-z0-9_]{2,72}$/;
const ITEM_KEY = /^[a-z][a-z0-9_]{1,63}$/;
const CATEGORY_KEY = /^(_generic|[a-z][a-z0-9_]{1,63})$/;
const PENDING_VALUES = new Set(["unknown", "not_sure", "pending", "tbd", "dont_know", "i_dont_know", "to_be_confirmed", "no_se"]);
const MODES = new Set(["LOCKED_CONTEXT", "PREFILL_CONFIRM", "CONTEXT_ONLY", "CONFIDENTIAL"]);
const KNOWN_SOURCES = new Set(["pa_destination_countries", "PSM.selected_services", "PSM.selected_capabilities", "FA4.timing", "FA4.context"]);
const FORBIDDEN_KEYS = new Set(["score", "readiness_score", "quality_score", "provider", "provider_name", "partner_coverage", "coverage", "service_role", "core", "on_demand", "price", "prompt", "question_text", "script"]);
// provider/vendor names must never appear in a universal manifest (Layer 4 has no home). Deliberately small deny-list + pattern.
const PROVIDER_NAMES = /\b(DHL|FedEx|UPS|Maersk|Kuehne|DB Schenker|CEVA|XPO|Expeditors|Deloitte|KPMG|PwC|EY|Ernst & Young|SAP|Oracle|Salesforce|Manhattan Associates|Blue Yonder)\b/i;
const CAP_RE = /^CAP_[A-Z0-9_]+$/;

export function validateManifest(m, ctx) {
  const out = [];
  const add = (check, severity, where, message) => out.push({ check, severity, manifest: m.category_key, where, message });
  // ---- 1 schema
  if (!CATEGORY_KEY.test(m.category_key || "")) add("1.schema", "error", "category_key", "invalid category_key format");
  for (const k of ["fields", "critical_decisions", "country_overlays", "operational_pending_items", "visibility_rules"])
    if (!(k in m)) add("1.schema", "error", k, "required key missing (MB4 content shape)");
  if (!["standard", "light"].includes(m.intake_depth)) add("1.schema", "error", "intake_depth", "must be standard|light");
  if (!["operational", "strategic_advisory", "ecosystem_development", "new_category_discovery"].includes(m.crp_kind)) add("1.schema", "error", "crp_kind", "invalid crp_kind");
  const keys = new Map();
  const checkField = (f, where, isItem, inOverlay) => {
    const kr = isItem ? ITEM_KEY : FIELD_KEY;
    if (!kr.test(f.field_key || "")) add("1.schema", "error", where, `invalid field_key '${f.field_key}'`);
    if (!TYPES.has(f.type)) add("1.schema", "error", where, `unknown type '${f.type}'`);
    if (!LEVELS.has(f.requirement_level)) add("1.schema", "error", where, `invalid requirement_level '${f.requirement_level}'`);
    if (!f.label?.en || !f.label?.es) add("1.schema", "error", where, "label.en and label.es are required");
    if ((f.type === "enum" || f.type === "multi_enum") && !(Array.isArray(f.values) && f.values.length >= 1)) add("1.schema", "error", where, "enum/multi_enum needs values[]");
    if (Array.isArray(f.values)) {
      if (new Set(f.values).size !== f.values.length) add("1.schema", "error", where, "duplicate enum values");
      for (const v of f.values) if (PENDING_VALUES.has(String(v).toLowerCase())) add("1.schema", "error", where, `enum value '${v}' duplicates answer_state semantics (UNKNOWN/ASSUMED live in fact.answer_state, D12)`);
    }
    if (f.type === "number_with_unit" && !(Array.isArray(f.unit_values) && f.unit_values.length)) add("1.schema", "error", where, "number_with_unit needs unit_values");
    if (f.type === "repeatable_group") {
      if (!Array.isArray(f.group_item_schema) || !f.group_item_schema.length) add("1.schema", "error", where, "repeatable_group needs group_item_schema");
      if (!(Number.isInteger(f.min_items) && f.min_items >= 1)) add("1.schema", "warn", where, "repeatable_group without min_items");
    } else if (f.group_item_schema) add("1.schema", "error", where, "group_item_schema only on repeatable_group");
    if (!["any", "threshold", "operational"].includes(f.change_policy)) add("1.schema", "error", where, "change_policy must be any|threshold|operational");
    if (f.change_policy === "threshold") {
      const t = f.change_threshold;
      const okNum = ["number", "number_with_unit", "money"].includes(f.type) && t && typeof t.relative_pct === "number" && t.relative_pct > 0;
      const okDate = f.type === "date" && t && Number.isInteger(t.period_shift_months) && t.period_shift_months > 0;
      if (!okNum && !okDate) add("1.schema", "error", where, "change_policy=threshold needs a quantifiable type and a declared change_threshold (relative_pct | period_shift_months)");
    } else if (f.change_threshold) add("1.schema", "error", where, "change_threshold only with change_policy=threshold");
    if (typeof f.execution_dependency !== "boolean") add("1.schema", "error", where, "execution_dependency must be boolean");
    if (f.inheritance) {
      if (!MODES.has(f.inheritance.mode)) add("7.inheritance", "error", where, `unknown inheritance mode '${f.inheritance.mode}'`);
      if (!KNOWN_SOURCES.has(f.inheritance.source)) add("7.inheritance", "error", where, `inheritance source '${f.inheritance.source}' is not a declared source`);
      if (f.inheritance.capability_id && !CAP_RE.test(f.inheritance.capability_id)) add("7.inheritance", "error", where, "capability_id format");
    }
    if (f.type === "repeatable_group" && Array.isArray(f.group_item_schema)) {
      const seen = new Set();
      for (const it of f.group_item_schema) {
        if (seen.has(it.field_key)) add("1.schema", "error", where, `duplicate item field '${it.field_key}'`);
        seen.add(it.field_key);
        checkField(it, `${where}.${it.field_key}`, true, inOverlay);
        if (it.type === "repeatable_group") add("1.schema", "error", `${where}.${it.field_key}`, "nested repeatable_group is not supported (one array = one fact)");
      }
    }
  };
  for (const f of m.fields || []) {
    if (keys.has(f.field_key)) add("1.schema", "error", f.field_key, "duplicate field_key in manifest");
    keys.set(f.field_key, f);
    checkField(f, f.field_key, false, false);
  }
  // ---- 6 forbidden content (provider names / scores / coverage / question-text keys)
  const scan = (o, path) => {
    if (Array.isArray(o)) o.forEach((x, i) => scan(x, `${path}[${i}]`));
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) {
      if (FORBIDDEN_KEYS.has(k)) add("6.forbidden", "error", `${path}.${k}`, `forbidden key '${k}' (scores, coverage, Core/On-Demand, provider data, question text)`);
      scan(v, `${path}.${k}`);
    } else if (typeof o === "string" && PROVIDER_NAMES.test(o)) add("6.forbidden", "error", path, `provider/vendor name in universal manifest: '${o.match(PROVIDER_NAMES)[0]}'`);
  };
  scan({ fields: m.fields, critical_decisions: m.critical_decisions, country_overlays: m.country_overlays, operational_pending_items: m.operational_pending_items, visibility_rules: m.visibility_rules }, m.category_key);
  // ---- 3 references (rules, decisions, overlays, visibility, pending)
  const allKeys = new Set(keys.keys());
  const overlayAdded = (c) => new Set((m.country_overlays?.[c]?.add || []).map((f) => f.field_key));
  const checkRule = (rule, where, extra = new Set(), requireDepends) => {
    if (rule === null || rule === undefined) return [];
    const e = AST.validate(rule);
    if (e) { add("5.rule", "error", where, `invalid rule: ${e}`); return []; }
    const r = AST.refs(rule);
    for (const k of r) if (!allKeys.has(k) && !extra.has(k)) add("3.reference", "error", where, `rule references unknown field '${k}'`);
    for (const { field_key, item } of AST.itemRefs(rule)) {
      const g = keys.get(field_key);
      if (!g || g.type !== "repeatable_group") { if (g || !extra.has(field_key)) add("3.reference", "error", where, `'${field_key}' is not a repeatable_group`); continue; }
      if (!g.group_item_schema.some((i) => i.field_key === item)) add("3.reference", "error", where, `item field '${item}' not in ${field_key}.group_item_schema`);
    }
    return r;
  };
  for (const f of m.fields || []) {
    checkRule(f.applicability_rule, `${f.field_key}.applicability_rule`);
    if (f.requirement_level === "conditional" && !f.applicability_rule && !f.derived) add("5.rule", "warn", f.field_key, "conditional field without applicability_rule");
    if (f.applicability_rule && f.requirement_level === "blocking") add("5.rule", "warn", f.field_key, "blocking field with applicability_rule");
  }
  // enum value checks for equality rules over enum fields (typos are a classic silent failure)
  const valueTypos = (rule, where) => {
    const walk = (r) => {
      if (!r) return;
      if (r.op === "and" || r.op === "or") r.rules.forEach(walk);
      else if (r.op === "not") walk(r.rule);
      else if ((r.op === "field_equals" || r.op === "field_in" || r.op === "field_contains") && keys.has(r.field_key)) {
        const f = keys.get(r.field_key);
        const vals = r.op === "field_in" ? r.values : [r.value];
        if (f.type === "enum" || f.type === "multi_enum") for (const v of vals) if (!f.values.includes(v)) add("3.reference", "error", where, `value '${v}' is not an allowed value of ${r.field_key}`);
        if (f.type === "boolean" && r.op !== "field_contains") for (const v of vals) if (typeof v !== "boolean") add("3.reference", "error", where, `${r.field_key} is boolean; compared with '${v}'`);
      } else if ((r.op === "group_any_item_equals" || r.op === "group_any_item_in") && keys.has(r.field_key)) {
        const it = keys.get(r.field_key).group_item_schema?.find((i) => i.field_key === r.item_field_key);
        const vals = r.op === "group_any_item_in" ? r.values : [r.value];
        if (it && (it.type === "enum")) for (const v of vals) if (!it.values.includes(v)) add("3.reference", "error", where, `value '${v}' not allowed for item ${r.item_field_key}`);
      }
    };
    walk(rule);
  };
  for (const f of m.fields || []) valueTypos(f.applicability_rule, `${f.field_key}.applicability_rule`);
  for (const d of m.critical_decisions || []) {
    const where = d.decision_key;
    if (!FIELD_KEY.test(d.decision_key || "")) add("1.schema", "error", where, "invalid decision_key");
    if (d.gates !== "blocking") add("1.schema", "warn", where, "decision gates is not 'blocking'");
    if (!["path", "consistency", "confirmation"].includes(d.kind)) add("1.schema", "error", where, "decision kind must be path|consistency|confirmation (completion gate, D12)");
    if (d.kind === "consistency") {
      const ack = (d.depends_on_fields || []).filter((k) => keys.get(k)?.requirement_level === "conditional" && keys.get(k)?.type === "text" && /_ack$/.test(k));
      if (ack.length !== 1) add("5.rule", "error", where, "a consistency decision must depend on exactly one *_ack text field (client acknowledgement path, MB3 §9.1)");
    }
    const r = checkRule(d.resolution_rule, `${where}.resolution_rule`);
    valueTypos(d.resolution_rule, `${where}.resolution_rule`);
    for (const k of d.depends_on_fields || []) if (!allKeys.has(k)) add("3.reference", "error", where, `depends_on_fields has unknown '${k}'`);
    const missing = [...new Set(r)].filter((k) => !(d.depends_on_fields || []).includes(k));
    if (missing.length) add("5.rule", "error", where, `rule reads fields not listed in depends_on_fields: ${missing.join(", ")}`);
    const extra = (d.depends_on_fields || []).filter((k) => !r.includes(k));
    if (extra.length) add("5.rule", "warn", where, `depends_on_fields not used by the rule: ${extra.join(", ")}`);
  }
  for (const p of m.operational_pending_items || []) checkRule(p.applicability_rule, `${p.pending_item_key}.applicability_rule`);
  for (const v of m.visibility_rules || []) if (v.field_key !== "*" && !allKeys.has(v.field_key)) add("3.reference", "error", `visibility:${v.field_key}`, "visibility rule for unknown field");
  if (!(m.visibility_rules || []).some((v) => v.field_key === "*")) add("3.reference", "error", "visibility_rules", "missing default '*' rule");
  // ---- 4 overlays
  for (const [country, ov] of Object.entries(m.country_overlays || {})) {
    if (!/^[A-Z]{2}$/.test(country)) add("4.overlay", "error", country, "overlay key must be ISO 3166-1 alpha-2");
    const added = overlayAdded(country);
    for (const k of ov.deactivate || []) if (!allKeys.has(k)) add("4.overlay", "error", `${country}.deactivate`, `deactivates '${k}' which is not in base fields (silent no-op, hygiene A)`);
    for (const mod of ov.modify || []) {
      if (!allKeys.has(mod.field_key)) add("4.overlay", "error", `${country}.modify`, `modifies unknown '${mod.field_key}'`);
      for (const pk of Object.keys(mod.patch || {})) if (!["label", "help_text", "requirement_level", "validation_flag", "applicability_rule"].includes(pk)) add("4.overlay", "error", `${country}.modify.${mod.field_key}`, `patch key '${pk}' not allowed (type/values changes are rejected, D1)`);
      if (mod.patch?.requirement_level && !LEVELS.has(mod.patch.requirement_level)) add("4.overlay", "error", `${country}.modify.${mod.field_key}`, "invalid requirement_level in patch");
    }
    for (const f of ov.add || []) {
      if (allKeys.has(f.field_key)) add("4.overlay", "error", `${country}.add`, `adds '${f.field_key}' which already exists in base`);
      checkField(f, `${country}.add.${f.field_key}`, false, true);
      checkRule(f.applicability_rule, `${country}.add.${f.field_key}.applicability_rule`, added);
      valueTypos(f.applicability_rule, `${country}.add.${f.field_key}.applicability_rule`);
    }
    // overlay-added field contradiction with deactivation in the same overlay
    for (const k of ov.deactivate || []) if (added.has(k)) add("4.overlay", "error", `${country}`, `'${k}' is both added and deactivated`);
    // regulatory content must carry the validation flag until a validator approves
    const flagged = (f) => f.validation_flag === "CONTENT_VALIDATION_REQUIRED";
    for (const f of ov.add || []) if (!flagged(f) && m.manifest_status !== "PUBLISHABLE" && !m.domain_validator && /status|registry|registration|program|prior_notice/.test(f.field_key) && country !== undefined && !flagged(f))
      add("4.overlay", "warn", `${country}.add.${f.field_key}`, "regulatory-looking overlay field without CONTENT_VALIDATION_REQUIRED");
  }
  // multi-country conflicts: same field modified by two overlays with incompatible requirement_level direction is allowed (strictest wins); added with same key & different def is rejected
  const addedDefs = new Map();
  for (const [country, ov] of Object.entries(m.country_overlays || {})) for (const f of ov.add || []) {
    const sig = JSON.stringify({ t: f.type, v: f.values, u: f.unit_values });
    if (addedDefs.has(f.field_key) && addedDefs.get(f.field_key) !== sig) add("4.overlay", "error", `${country}.add.${f.field_key}`, "same added key with different type/values across overlays (D1 conflict)");
    addedDefs.set(f.field_key, sig);
  }
  // ---- 2 one key, one meaning (cross-manifest)
  if (ctx?.registry) for (const f of m.fields || []) {
    const sig = canon(f);
    const prev = ctx.registry.get(f.field_key);
    if (prev && prev.sig !== sig) add("2.one_key_one_meaning", "error", f.field_key, `defined differently in '${prev.owner}' (type/values/item schema differ)`);
    if (!prev) ctx.registry.set(f.field_key, { sig, owner: m.category_key });
  }
  // ---- 8 validator state
  if (m.manifest_status === "PUBLISHABLE" && !m.domain_validator) add("8.validator", "error", "manifest_status", "PUBLISHABLE requires a registered domain validator");
  if (!m.domain_validator && m.manifest_status !== "DRAFT-SIN-VALIDAR") add("8.validator", "error", "manifest_status", "no domain validator: status must be DRAFT-SIN-VALIDAR");
  // ---- 10 catalog service values & satisfiability (static)
  if (ctx?.catalog) {
    const sf = (m.fields || []).find((f) => f.field_key.endsWith("_services_in_scope"));
    if (sf) {
      const allowed = new Set([...(ctx.catalog[m.category_key] || []), ...(ctx.additions || [])]);
      for (const v of sf.values) if (!allowed.has(v)) add("10.catalog", "error", sf.field_key, `service '${v}' is not in the catalog projection of '${m.category_key}' nor a crosswalk addition`);
      const missing = (ctx.catalog[m.category_key] || []).filter((v) => !sf.values.includes(v));
      if (missing.length) add("10.catalog", "error", sf.field_key, `catalog services missing from scope values: ${missing.join(", ")}`);
    } else if (!["strategic_advisory", "ecosystem_development", "_generic"].includes(m.category_key)) add("10.catalog", "warn", m.category_key, "no *_services_in_scope field");
  }
  satisfiability(m, add, keys);
  return out;
}

function canon(f) {
  const item = (f.group_item_schema || []).map((i) => ({ k: i.field_key, t: i.type, v: i.values, u: i.unit_values }));
  return JSON.stringify({ t: f.type, v: f.values, u: f.unit_values, i: item });
}

// Static reachability: a field is unreachable if its applicability requires 'X = v' (or X in S) where X's own
// applicability requires an incompatible value of another field. Conjunctive equality constraints only (sound, not complete).
function satisfiability(m, add, keys) {
  const constraints = (rule) => { // returns array of {field, set:Set} implied by AND-chain of equals/in
    if (!rule) return [];
    if (rule.op === "field_equals") return [{ field: rule.field_key, set: new Set([JSON.stringify(rule.value)]) }];
    if (rule.op === "field_in") return [{ field: rule.field_key, set: new Set(rule.values.map((v) => JSON.stringify(v))) }];
    if (rule.op === "and") return rule.rules.flatMap(constraints);
    return [];
  };
  for (const f of m.fields || []) {
    for (const c of constraints(f.applicability_rule)) {
      const dep = keys.get(c.field);
      if (!dep || !dep.applicability_rule) continue;
      for (const dc of constraints(dep.applicability_rule)) {
        // dep is only applicable (and thus answerable) if dc.field ∈ dc.set; f needs dep ∈ c.set — independent unless same field
        if (dc.field === c.field) continue;
        const own = constraints(f.applicability_rule).filter((x) => x.field === dc.field);
        for (const o of own) {
          const inter = [...o.set].filter((v) => dc.set.has(v));
          if (inter.length === 0) add("11.satisfiability", "error", f.field_key, `unreachable: needs ${dc.field} ∈ {${[...o.set]}} but its prerequisite '${c.field}' is only applicable when ${dc.field} ∈ {${[...dc.set]}}`);
        }
      }
    }
  }
}

export function validateProjectManifest(pm, ctx) {
  const out = [];
  const add = (check, severity, where, message) => out.push({ check, severity, manifest: "project_manifest_v2", where, message });
  const cats = new Map();
  for (const c of pm.candidate_categories || []) {
    if (cats.has(c.category_key)) add("P1.dup", "error", c.category_key, "duplicate candidate");
    cats.set(c.category_key, c);
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(c.category_key)) add("P1.key", "error", c.category_key, "bad category_key");
    if (!c.detection_signals_positive?.en?.length || !c.detection_signals_positive?.es?.length) add("P2.signals", "error", c.category_key, "needs EN and ES positive signals");
    for (const d of c.typical_dependencies || []) if (!(pm.candidate_categories || []).some((x) => x.category_key === d)) add("P3.deps", "error", c.category_key, `dependency '${d}' is not a candidate category`);
    for (const cap of c.capability_signals || []) if (!CAP_RE.test(cap)) add("P2.signals", "error", c.category_key, `bad capability id ${cap}`);
  }
  if (ctx?.catalogCategories) {
    const want = new Set([...ctx.catalogCategories, ...(pm.reserved_platform_categories || [])]);
    for (const k of want) if (!cats.has(k)) add("P1.coverage", "error", k, "missing from candidate_categories");
    for (const k of cats.keys()) if (!want.has(k)) add("P1.coverage", "error", k, "candidate not in catalog taxonomy or reserved set");
  }
  for (const r of pm.reserved_platform_categories || []) if (cats.get(r)?.kind !== "reserved_platform") add("P1.reserved", "error", r, "reserved category must have kind reserved_platform");
  if (ctx?.manifests) for (const [k, c] of cats) {
    const have = ctx.manifests.has(k);
    if (c.category_manifest_status === "DRAFT-SIN-VALIDAR" && !have) add("P4.manifest_link", "error", k, "marked authored but no manifest provided");
    if (c.category_manifest_status === "NOT_AUTHORED" && have) add("P4.manifest_link", "error", k, "manifest exists but candidate says NOT_AUTHORED");
  }
  for (const fs of pm.fa4_front_signals || []) for (const k of fs.categories || []) if (!cats.has(k)) add("P5.fronts", "error", fs.front, `front points to unknown category '${k}'`);
  if (ctx?.fronts) for (const f of ctx.fronts) if (!(pm.fa4_front_signals || []).some((x) => x.front === f)) add("P5.fronts", "error", f, "FA 4.0 front not covered by fa4_front_signals");
  const secondary = ["pa_destination_countries", "pa_project_objective", "pa_expansion_product_or_service", "pa_operating_entity", "pa_time_window", "pa_confirmed_categories", "pa_critical_decisions"];
  for (const k of secondary) if (!(pm.material_fields || []).some((m) => m.field_key === k)) add("P6.material", "error", k, "missing from material_fields (D2 initial list)");
  if (!(pm.out_of_scope_topics || []).some((t) => t.topic_key === "mobility_immigration")) add("P7.oos", "error", "out_of_scope_topics", "mobility_immigration missing");
  const sig = new Set((pm.project_split_signals || []).map((s) => s.signal_key));
  for (const s of ["distinct_target_counterparty", "distinct_geography", "distinct_operating_model", "distinct_timeline", "distinct_investment_path"]) if (!sig.has(s)) add("P8.split", "error", s, "split signal missing");
  if (pm.project_split_rule?.min_true_signals_to_propose !== 2) add("P8.split", "warn", "project_split_rule", "threshold differs from the proposed initial 2");
  if (JSON.stringify(pm.add_a_service?.classification_order) !== JSON.stringify(["out_of_scope", "strategic_advisory", "ecosystem_development", "known_service", "unmapped_known_category", "discovery"])) add("P9.classification", "error", "add_a_service", "classification order differs from the consolidated definition (§13.19)");
  if (pm.manifest_status !== "DRAFT-SIN-VALIDAR") add("P10.state", "error", "manifest_status", "no validator: must be DRAFT-SIN-VALIDAR");
  out.push(...validateCcir(pm, ctx));
  return out;
}

// ---- P11: Company Context & Information Request (CCIR delta, 7 Oct 2026; corrected 7 Oct: Core is the source of truth) ----
export const CCIR_STATES = ["VERIFIED", "MISMATCH", "NOT_FOUND"];
export const CCIR_ATTEMPT_STATES = ["NOT_ATTEMPTED", "NO_SOURCE_AVAILABLE", "PROVIDER_ERROR", "TIMEOUT", "COMPLETED"];
export const CCIR_RESOLUTIONS = ["CORRECTED", "KEPT_DECLARED", "NOT_SURE", "PENDING"];
export const CCIR_ACTIONS = ["REUSE_VIA_PREFILL_CONFIRM", "NEW_WITH_CONTEXT_HINT", "DERIVE", "NEW"];
export const CCIR_LABELS_ES = { VERIFIED: "Datos validados", MISMATCH: "Favor de validar", NOT_FOUND: "No encontrado" };
export function validateCcir(pm, ctx) {
  const out = []; const add = (check, severity, where, message) => out.push({ check, severity, manifest: "project_manifest_v2", where, message });
  const cc = pm.company_context_request;
  if (!cc) { add("P11.block", "error", "company_context_request", "CCIR block missing"); return out; }
  const seq = (pm.precision_understanding_sequence?.stages || []).map((x) => x.stage_key);
  if (JSON.stringify(seq) !== JSON.stringify(["understand_project", "company_context_request", "psm_complete_confirm"])) add("P11.sequence", "error", "precision_understanding_sequence", "PU sequence must be understand_project → company_context_request → psm_complete_confirm");
  if (cc.part_of !== "precision_understanding") add("P11.flags", "error", "part_of", "CCIR is part of Precision Understanding");
  for (const k of ["is_separate_phase", "is_pbyc", "generates_crp", "activates_operation_hub", "assigns_sherpa", "blocks_psm"]) if (cc[k] !== false) add("P11.flags", "error", k, `${k} must be false`);
  if (cc.psm_gate_effect !== "none") add("P11.flags", "error", "psm_gate_effect", "CCIR must not gate the PSM");
  if (!/non-blocking for PU\/PSM confirmation unless a future explicit product rule says otherwise/.test(cc.non_blocking_rule || "")) add("P11.materiality", "error", "non_blocking_rule", "use the approved non-blocking wording");
  if ("material" in cc || cc.materiality?.default !== "contextual") add("P11.materiality", "error", "materiality", "Company Context is not declared universally non-material: materiality.default = contextual");
  if ((cc.documents_requested || []).length !== 0) add("P11.documents", "error", "documents_requested", "no documents are requested at this stage");
  const keys = new Set();
  for (const f of cc.fields || []) {
    keys.add(f.field_key);
    if (!/^company_[a-z][a-z0-9_]{2,60}$/.test(f.field_key)) add("P11.key", "error", f.field_key, "company context keys follow company_<name> (D8 format)");
    if (f.field_key === "company_verification") add("P11.sot", "error", f.field_key, "verification metadata belongs to the Core record, not to a Precision field");
    if (!["supporting", "informational"].includes(f.requirement_level)) add("P11.level", "error", f.field_key, "CCIR fields are never blocking/required (visibility, not friction)");
    if (f.execution_dependency !== false) add("P11.level", "error", f.field_key, "no execution dependency");
    if (f.scope !== "company_context") add("P11.scope", "error", f.field_key, "company-level scope only");
    if (f.canonical_owner !== "core.company" || f.precision_fact_role !== "interaction_receipt") add("P11.sot", "error", f.field_key, "the canonical owner is core.company; Precision facts are interaction receipts");
    if (f.materiality === "non_material") add("P11.materiality", "error", f.field_key, "not declared universally non-material");
    if (["file", "document", "upload"].includes(f.value_shape)) add("P11.documents", "error", f.field_key, "no document-type fields");
    if (!CCIR_ACTIONS.includes(f.classification)) add("P11.classification", "error", f.field_key, "unclassified against the anti-duplication control");
    if (ctx?.allFieldKeys?.has(f.field_key)) add("P11.dup", "error", f.field_key, "key already defined in a category manifest (company data must not be duplicated in Category scope)");
  }
  for (const k of ["company_trade_name", "company_legal_entity_name"]) {
    const f = (cc.fields || []).find((x) => x.field_key === k);
    if (!f?.context_hint?.never_auto_copy_to?.includes("company_trade_name") || !f.context_hint.never_auto_copy_to.includes("company_legal_entity_name")) add("P11.name", "error", k, "existing company name is context only; never copied automatically to trade or legal name");
    if (f?.inheritance) add("P11.name", "error", k, "no PREFILL inheritance for names: the origin does not say what the name represents");
    if (f?.classification !== "NEW_WITH_CONTEXT_HINT") add("P11.name", "error", k, "names are NEW_WITH_CONTEXT_HINT");
  }
  const emp = (cc.fields || []).find((x) => x.field_key === "company_employee_count");
  if (emp?.context_hint?.never_writes_value !== true || (emp?.parts || []).some((p) => p.part_key === "band")) add("P11.employees", "error", "company_employee_count", "the FA 4.0 size range is a contextual hint and never writes a value");
  if (emp?.classification !== "NEW_WITH_CONTEXT_HINT") add("P11.employees", "error", "company_employee_count", "employees are NEW_WITH_CONTEXT_HINT");
  const map = cc.anti_duplication_mapping || [];
  if (map.length < 8) add("P11.mapping", "error", "anti_duplication_mapping", "every requested datum must be classified");
  for (const m of map) { if (!CCIR_ACTIONS.includes(m.action)) add("P11.mapping", "error", m.requested, `bad action ${m.action}`); if (m.action !== "DERIVE" && !keys.has(m.key)) add("P11.mapping", "error", m.requested, `mapped key '${m.key}' is not a CCIR field`); }
  const cs = cc.customer_states?.states || [];
  if (cs.length !== 3 || cc.customer_states?.max !== 3) add("P11.states", "error", "customer_states", "exactly three customer-facing states");
  for (const st of CCIR_STATES) if (cs.find((x) => x.state === st)?.label?.es !== CCIR_LABELS_ES[st]) add("P11.states", "error", st, `approved Spanish label is '${CCIR_LABELS_ES[st]}'`);
  const v = cc.verification || {};
  if (JSON.stringify(v.attempt_states) !== JSON.stringify(CCIR_ATTEMPT_STATES)) add("P11.attempt", "error", "attempt_states", "internal attempt states must be NOT_ATTEMPTED, NO_SOURCE_AVAILABLE, PROVIDER_ERROR, TIMEOUT, COMPLETED");
  for (const [k, spec] of Object.entries(v.verifiable_fields || {})) {
    if (!keys.has(k)) add("P11.verification", "error", k, "verifiable field is not a CCIR field");
    for (const st of spec.statuses || []) if (!CCIR_STATES.includes(st)) add("P11.verification", "error", k, `status ${st} is not one of the three`);
    if ((v.not_verifiable || []).includes(k)) add("P11.verification", "error", k, "both verifiable and not_verifiable");
  }
  const web = v.verifiable_fields?.company_website;
  if (!web?.checks?.includes("domain_reachable") || !web?.checks?.includes("identity_match")) add("P11.website", "error", "company_website", "website verification distinguishes domain_reachable from identity_match");
  for (const k of ["company_employee_count", "company_last_fy_revenue"]) if (v.verifiable_fields?.[k]) add("P11.scale", "error", k, "declared scale data is never verified");
  for (const c of v.source_catalog || []) if (c.status === "available" || c.vendor !== "NOT_SELECTED") add("P11.providers", "error", c.source_kind, "no provider is selected or implemented yet");
  if (v.provider_selection?.no_external_dependency_implemented !== true) add("P11.providers", "error", "provider_selection", "no external dependency implemented yet");
  const core = cc.core_contract || {}; const rec = core.verification_record || [];
  if (core.owner !== "core.company" || core.port !== "CompanyContextPort") add("P11.sot", "error", "core_contract", "Core company owns Company Context through CompanyContextPort");
  const enumOf = (k) => rec.find((p) => p.part_key === k)?.values;
  if (JSON.stringify(enumOf("attempt_state")) !== JSON.stringify(CCIR_ATTEMPT_STATES)) add("P11.envelope", "error", "attempt_state", "attempt_state enum");
  if (JSON.stringify(enumOf("verification_status")) !== JSON.stringify(CCIR_STATES)) add("P11.envelope", "error", "verification_status", "internal status enum must be exactly the three states");
  if (JSON.stringify(enumOf("client_resolution")) !== JSON.stringify(CCIR_RESOLUTIONS)) add("P11.envelope", "error", "client_resolution", "resolution enum must be CORRECTED|KEPT_DECLARED|NOT_SURE|PENDING");
  for (const p of ["declared_value", "verification_status", "verification_source", "verification_checked_at", "external_value", "client_resolution"]) if (!rec.some((x) => x.part_key === p)) add("P11.envelope", "error", p, "provenance minimum part missing");
  if (core.precision_receipt?.value_shape?.authoritative !== false) add("P11.sot", "error", "precision_receipt", "a Precision receipt is never authoritative");
  if (!/never from a receipt/.test(core.precision_receipt?.read_rule || "")) add("P11.sot", "error", "precision_receipt", "consumers resolve the current value through the port");
  if (cc.mismatch_handling?.never_silently_replace_declared !== true || cc.mismatch_handling?.blocking !== false) add("P11.mismatch", "error", "mismatch_handling", "mismatch never replaces silently and never blocks");
  return out;
}
