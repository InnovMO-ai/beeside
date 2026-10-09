/**
 * The virtual manifest of the Understanding surface. `project_manifest_v2` fixes which `pa_*` fields exist and which are
 * material (see `material_fields`); the questions themselves are authored here so that the Understanding thread runs
 * through the SAME engine (`evaluateCategory`) as a category, with no percentage ever shown for it.
 *
 * Fact keys are stored as `precision.<field_key>` like every other fact. `pa_confirmed_categories` and
 * `pa_critical_decisions` are system-derived at My Service Map confirmation (never asked).
 */
import type { FieldDefinition } from "../manifest/effective-fields";
import type { ProjectManifestDoc } from "../manifest/bundled";
import type { EvaluationInput } from "../manifest/types";

const L = (en: string, es: string): Record<string, string> => ({ en, es });

export const PA_FIELD_KEYS = [
  "pa_project_objective",
  "pa_destination_countries",
  "pa_expansion_product_or_service",
  "pa_operating_entity",
  "pa_time_window",
  "pa_confirmed_categories",
  "pa_critical_decisions",
  "pa_priority_notes",
] as const;
export type PaFieldKey = (typeof PA_FIELD_KEYS)[number];

const FIELDS: FieldDefinition[] = [
  {
    field_key: "pa_project_objective", type: "text", requirement_level: "blocking", applicability_rule: null, execution_dependency: true, change_policy: "any",
    label: L("What do you want to achieve with this expansion?", "¿Qué quieres lograr con esta expansión?"),
    help_text: L("It lets us organize the services around your goal.", "Nos permite organizar los servicios alrededor de tu objetivo."),
  },
  {
    field_key: "pa_destination_countries", type: "country_list", requirement_level: "blocking", applicability_rule: null, execution_dependency: true, change_policy: "any",
    label: L("Which country or countries are you considering as a destination?", "¿Qué país o países estás considerando como destino?"),
    help_text: L("Each destination can change what we need to ask later.", "Cada destino puede cambiar lo que necesitamos preguntar después."),
  },
  {
    field_key: "pa_expansion_product_or_service", type: "text", requirement_level: "required", applicability_rule: null, execution_dependency: false, change_policy: "any",
    label: L("What product or service do you want to bring to this market?", "¿Qué producto o servicio quieres llevar a este mercado?"),
    help_text: L("It tells us what the services have to support.", "Nos indica qué deben respaldar los servicios."),
  },
  {
    field_key: "pa_operating_entity", type: "text", requirement_level: "required", applicability_rule: null, execution_dependency: true, change_policy: "any",
    label: L("Which company or entity will operate in the destination?", "¿Qué empresa o entidad operará en el destino?"),
    help_text: L("A company name or a short description is enough; you can leave it pending.", "Basta con el nombre de la empresa o una descripción breve; puedes dejarlo pendiente."),
  },
  {
    field_key: "pa_time_window", type: "date", requirement_level: "required", applicability_rule: null, execution_dependency: false, change_policy: "threshold", change_threshold: { period_shift_months: 3 },
    label: L("When would you like to start?", "¿Cuándo te gustaría empezar?"),
    help_text: L("A month and year are enough.", "Basta con un mes y un año."),
  },
  {
    field_key: "pa_priority_notes", type: "text", requirement_level: "supporting", applicability_rule: null, execution_dependency: false, change_policy: "operational",
    label: L("Is there anything else you want us to take into account?", "¿Hay algo más que quieras que tengamos en cuenta?"),
  },
  {
    field_key: "pa_confirmed_categories", type: "text_list", requirement_level: "informational", applicability_rule: null, derived: true, execution_dependency: false, change_policy: "any",
    label: L("Confirmed services", "Servicios confirmados"),
  },
  {
    field_key: "pa_critical_decisions", type: "text_list", requirement_level: "informational", applicability_rule: null, derived: true, execution_dependency: false, change_policy: "any",
    label: L("Open decisions", "Decisiones abiertas"),
  },
];

export function paManifestContent(): EvaluationInput["manifest"] {
  return {
    category_key: "_project",
    crp_kind: "none",
    intake_depth: "standard",
    fields: FIELDS.map((f) => ({ ...f })),
    critical_decisions: [],
    country_overlays: {},
    operational_pending_items: [],
    visibility_rules: [],
  };
}

/** Sanity check against the project manifest: every material field it declares must exist here. */
export function missingMaterialFields(pm: Pick<ProjectManifestDoc, "material_fields">): string[] {
  const have = new Set<string>(PA_FIELD_KEYS);
  const declared = (pm.material_fields as Array<{ field_key: string }> | undefined) ?? [];
  return declared.map((m) => m.field_key).filter((k) => !have.has(k));
}

/** Add a Service has no fields of its own: a manifest with nothing to ask keeps the engine's evaluation well defined. */
export function addServiceManifestContent(): EvaluationInput["manifest"] {
  return { category_key: "_add_service", fields: [], critical_decisions: [], country_overlays: {}, operational_pending_items: [], visibility_rules: [] };
}
