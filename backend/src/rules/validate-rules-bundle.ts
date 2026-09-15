import { FA_FIELDS, RULES_CATEGORY_ID, getFieldDefinition } from "@beeside/canonical-fields";
import { conditionLeaves, readsStatus } from "./conditions";
import { PRESSURE_PRIMITIVES, RuleCondition, RulesEngineBundle } from "./types";

/**
 * Structural validation of a Rules Engine bundle before it can be published. Besides shape, it
 * enforces the frozen guarantees that make the engine auditable field by field:
 * - every condition reads a canonical fa.* key with values that key actually allows;
 * - open-text fields are only ever tested for presence (`answered`) — never for meaning;
 * - every CRITICAL_GAP rule combines unresolved + material pressure from the fixed primitive set;
 * - statuses only read the finding itself inside signal rules.
 */
export function validateRulesEngineBundle(bundle: RulesEngineBundle): string[] {
  const errors: string[] = [];
  const known = new Set(FA_FIELDS.map((f) => f.key));

  const checkCondition = (condition: RuleCondition, path: string, allowStatus: boolean) => {
    if (!allowStatus && readsStatus(condition)) errors.push(`${path} reads a finding status outside a signal rule`);
    for (const leaf of conditionLeaves(condition)) {
      const def = getFieldDefinition(leaf.field);
      if (!def || !known.has(leaf.field)) {
        errors.push(`${path} reads unknown field ${leaf.field}`);
        continue;
      }
      if (def.openText && leaf.op !== "answered") errors.push(`${path} interprets open-text field ${leaf.field} (${leaf.op}); only presence may be tested`);
      if (def.values) {
        const allowed = new Set(def.values);
        for (const value of leaf.values) if (!allowed.has(value)) errors.push(`${path} uses value ${value} not allowed for ${leaf.field}`);
      }
    }
  };

  if (bundle.schema_version !== 1) errors.push("schema_version must be 1");
  if (bundle.product !== "first_assessment_rules") errors.push("product must be first_assessment_rules");
  const ids = bundle.areas.map((a) => a.id).sort((a, b) => a - b);
  if (JSON.stringify(ids) !== JSON.stringify(Array.from({ length: 14 }, (_, i) => i + 1))) errors.push("areas must define ids 1–14 exactly once");

  for (const area of bundle.areas) {
    const path = `areas[${area.id}]`;
    if (RULES_CATEGORY_ID[area.category as keyof typeof RULES_CATEGORY_ID] !== area.id) errors.push(`${path}.category ${area.category} does not match the catalog id`);
    checkCondition(area.applies_when, `${path}.applies_when`, false);
    for (const key of area.evidence_fields) if (!known.has(key)) errors.push(`${path}.evidence_fields has unknown key ${key}`);
    for (const critical of area.critical) {
      if (critical.status !== "CRITICAL_GAP") errors.push(`${path}.${critical.id} must be CRITICAL_GAP`);
      if (!critical.pressure || critical.pressure.length === 0) errors.push(`${path}.${critical.id} has no material-pressure test`);
      for (const p of critical.pressure ?? []) if (!(PRESSURE_PRIMITIVES as readonly string[]).includes(p)) errors.push(`${path}.${critical.id} uses unknown pressure ${p}`);
      checkCondition(critical.unresolved, `${path}.${critical.id}.unresolved`, false);
    }
    for (const rule of area.rules) {
      if (rule.status !== "DEFINED" && rule.status !== "NEEDS_ATTENTION") errors.push(`${path}.${rule.id} has an invalid status`);
      checkCondition(rule.when, `${path}.${rule.id}`, false);
    }
    if (area.fallback.status !== "NEEDS_ATTENTION") errors.push(`${path}.fallback must be NEEDS_ATTENTION`);
    for (const [factor, condition] of Object.entries(area.weighting)) if (condition) checkCondition(condition, `${path}.weighting.${factor}`, false);
    area.signals.forEach((s, i) => checkCondition(s.when, `${path}.signals[${i}]`, true));
    for (const capability of area.capability_ids) {
      if (!bundle.capabilities.categories.some((c) => c.id === capability)) errors.push(`${path} maps to unknown capability ${capability}`);
    }
    const ruleIds = [...area.critical.map((r) => r.id), ...area.rules.map((r) => r.id), area.fallback.id];
    if (new Set(ruleIds).size !== ruleIds.length) errors.push(`${path} has duplicate rule ids`);
    for (const locale of bundle.locales) {
      for (const text of [...area.critical, ...area.rules, area.fallback].map((r) => r.copy[locale]?.reason)) {
        if (!text) errors.push(`${path} is missing ${locale} reason copy`);
      }
      if (!area.copy[locale]?.label || !area.copy[locale]?.short_label || !area.copy[locale]?.precision_focus) errors.push(`${path} is missing ${locale} labels`);
    }
  }

  for (const p of PRESSURE_PRIMITIVES) if (!bundle.pressure_reasons.some((r) => r.id === p)) errors.push(`pressure_reasons is missing ${p}`);
  for (const [panel, config] of Object.entries(bundle.panels)) if (config.ceiling !== 5) errors.push(`panels.${panel}.ceiling must be 5 (Rules Matrix v1 §17)`);
  if (bundle.capabilities.ceiling !== 6) errors.push("capabilities.ceiling must be 6 (Capability Taxonomy v1 CT-2)");
  if (bundle.capabilities.categories.length !== 10) errors.push("capabilities must list the 10 taxonomy categories");

  const growthValues = new Set(getFieldDefinition("fa.operation.growth_focus")?.values ?? []);
  for (const boost of bundle.growth_boosts) {
    if (!growthValues.has(boost.value) || boost.value === "not_sure") errors.push(`growth_boosts has invalid value ${boost.value}`);
    for (const id of boost.area_ids) if (id < 1 || id > 14) errors.push(`growth_boosts.${boost.value} maps to unknown area ${id}`);
  }
  for (const id of bundle.priority_alignment.go_to_market_dependency_area_ids) if (id < 1 || id > 14) errors.push(`dependency map has unknown area ${id}`);
  for (const locale of bundle.locales) {
    const phrases = bundle.priority_alignment.copy[locale]?.priority_phrases ?? {};
    for (const category of Object.keys(RULES_CATEGORY_ID)) if (!phrases[category]) errors.push(`priority_alignment ${locale} phrase missing for ${category}`);
  }
  return errors;
}
