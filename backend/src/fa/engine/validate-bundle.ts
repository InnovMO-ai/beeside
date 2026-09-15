import { getFieldDefinition } from "@beeside/canonical-fields";
import { BUNDLE_LOCALES, OptionDef, QuestionBankBundle, QuestionType } from "./bundle-types";
import { conditionFields } from "./conditions";
import { validateLifecyclePolicyConfig } from "../services/access-lifecycle";

const TYPE_TO_DATA_TYPE: Record<QuestionType, string> = {
  single_select: "single_select",
  multi_select: "multi_select",
  text: "text",
  short_text: "short_text",
  timing: "timing",
  country_list: "country_list",
  quantity: "quantity",
  locale: "locale",
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

/**
 * Structural validation of a First Assessment bundle against the canonical field registry
 * (shared/canonical-fields). Complements the database's generic bundle validation (Phase 3):
 * keys, types, option values and exclusivity must match the canonical definitions exactly, every
 * question belongs to exactly one step, and conditions only read answers asked earlier.
 */
export function validateQuestionBankBundle(bundle: QuestionBankBundle): string[] {
  const errors: string[] = [];
  const err = (message: string) => errors.push(message);

  if (bundle.schema_version !== 1) err("schema_version must be 1");
  if (!sameSet(bundle.locales, BUNDLE_LOCALES)) err("locales must be exactly en, es");

  const ids = new Set<string>();
  const fieldKeys = new Set<string>();
  for (const question of bundle.questions) {
    if (ids.has(question.id)) err(`duplicate question id ${question.id}`);
    ids.add(question.id);
    if (fieldKeys.has(question.field_key)) err(`duplicate field_key ${question.field_key}`);
    fieldKeys.add(question.field_key);

    const def = getFieldDefinition(question.field_key);
    if (!def) {
      err(`${question.id}: field_key ${question.field_key} is not a canonical field`);
      continue;
    }
    if (def.dataType !== TYPE_TO_DATA_TYPE[question.type]) {
      err(`${question.id}: type ${question.type} does not match canonical ${def.dataType}`);
    }
    if (def.source === "identity" && !def.binding?.startsWith("person.")) {
      err(`${question.id}: identity field ${question.field_key} cannot be asked as a journey question`);
    }
    const optionValues = (list?: OptionDef[]) => (list ?? []).map((o) => o.value);
    if (question.type === "single_select" || question.type === "multi_select" || question.type === "locale") {
      if (question.options_from) {
        if (question.options) err(`${question.id}: options and options_from are mutually exclusive`);
      } else if (!sameSet(optionValues(question.options), def.values ?? [])) {
        err(`${question.id}: option values differ from canonical values of ${question.field_key}`);
      }
    }
    if (question.type === "quantity" && question.units && !sameSet(optionValues(question.units), def.values ?? [])) {
      err(`${question.id}: unit values differ from canonical values of ${question.field_key}`);
    }
    if (!sameSet(question.exclusive_values ?? [], def.exclusiveValues ?? [])) {
      err(`${question.id}: exclusive values differ from canonical definition`);
    }
    for (const locale of BUNDLE_LOCALES) {
      if (!question.copy[locale]?.title?.trim()) err(`${question.id}: missing ${locale} title`);
      for (const option of [...(question.options ?? []), ...(question.units ?? [])]) {
        if (!option.copy[locale]?.trim()) err(`${question.id}: option ${option.value} missing ${locale} copy`);
      }
    }
  }

  const seenInSteps = new Map<string, string>();
  const askedSoFar = new Set<string>();
  const stepIds = new Set<string>();
  const questionsById = new Map(bundle.questions.map((q) => [q.id, q]));
  for (const step of bundle.steps) {
    if (stepIds.has(step.id)) err(`duplicate step id ${step.id}`);
    stepIds.add(step.id);
    if (!bundle.stages.some((s) => s.id === step.stage)) err(`step ${step.id}: unknown stage ${step.stage}`);
    if (step.kind === "transition" && step.question_ids.length > 0) err(`transition ${step.id} cannot contain questions`);
    if (step.kind === "questions" && step.question_ids.length === 0) err(`step ${step.id} has no questions`);
    for (const field of step.applies_when ? conditionFields(step.applies_when) : []) {
      if (!askedSoFar.has(field)) err(`step ${step.id}: condition reads ${field} before it is asked`);
    }
    for (const id of step.question_ids) {
      const question = questionsById.get(id);
      if (!question) {
        err(`step ${step.id}: unknown question ${id}`);
        continue;
      }
      if (seenInSteps.has(id)) err(`question ${id} appears in steps ${seenInSteps.get(id)} and ${step.id}`);
      seenInSteps.set(id, step.id);
      const reads = [
        ...(question.applies_when ? conditionFields(question.applies_when) : []),
        ...(question.options_from ? [question.options_from.field] : []),
      ];
      for (const field of reads) {
        if (!askedSoFar.has(field)) err(`${id}: reads ${field} before it is asked`);
      }
      askedSoFar.add(question.field_key);
    }
  }
  for (const id of ids) if (!seenInSteps.has(id)) err(`question ${id} is not part of any step`);

  const declared = new Set(bundle.variables);
  const used = JSON.stringify(bundle).match(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g) ?? [];
  for (const token of used) {
    const name = token.replace(/[{}\s]/g, "");
    if (!declared.has(name)) err(`undeclared template variable ${name}`);
  }

  // Operations configuration (optional sections; bundles published before them stay valid).
  for (const [name, url] of Object.entries(bundle.links ?? {})) {
    if (url === null && name === "privacy_policy_url") continue;
    if (typeof url !== "string" || !/^https:\/\/[^\s]+$/.test(url)) err(`links.${name} must be an https URL`);
  }
  if (bundle.lifecycle !== undefined) for (const message of validateLifecyclePolicyConfig(bundle.lifecycle)) err(message);
  if (bundle.premium !== undefined) {
    const en = bundle.premium.copy?.en;
    const es = bundle.premium.copy?.es;
    if (!en || !es) err("premium.copy must include en and es");
    else {
      if (en.consideration.pillars.map((p) => p.key).join("|") !== es.consideration.pillars.map((p) => p.key).join("|")) err("premium pillars differ between locales");
      if (en.consideration.outcomes.length !== es.consideration.outcomes.length) err("premium outcomes differ between locales");
      if (en.activation.points.length !== es.activation.points.length) err("premium activation points differ between locales");
    }
  }
  for (const [template, def] of Object.entries(bundle.emails)) {
    for (const locale of BUNDLE_LOCALES) {
      const copy = def.copy[locale];
      if (!copy?.subject?.trim() || !copy.body?.trim() || !copy.cta?.trim()) err(`emails.${template}: missing ${locale} subject, body or cta`);
    }
  }

  return errors;
}
