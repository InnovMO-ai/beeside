import { QuestionDef } from "../engine/bundle-types";
import { RELATIONSHIP_STATUS, YES_PROBABLY_NO_NOT_SURE, opts, q, when } from "./helpers";

/**
 * Level 2 MVP — conditional follow-ups relocated from the pre-Level-2 operation question tree
 * (questions-operation.ts, kept unmodified and still used as-is by fa-qb-1.1.0) into the Needs
 * Explorer composition (5, "Needs Landscape").
 *
 * Owner decision (2026-09-17): the Needs Explorer replaces the old tree wherever a question is
 * fully covered by leaf selection — asking "is X relevant to you" again after the respondent just
 * selected leaf X is UX duplication the owner explicitly ruled out ("no quiero mantener dos
 * mecanismos paralelos que pregunten esencialmente lo mismo"). Where the old tree holds a UNIQUE
 * fact leaf selection doesn't capture (a volume, a current-state fact, a relationship detail), that
 * fact is kept and relocated here as a conditional follow-up gated on the matching leaf being
 * selected in `fa.needs.map`, instead of on the removed `fa.operation.components` (O1) gate.
 *
 * Same `id` and same `field_key` as the pre-Level-2 question in every case below — only the gate
 * and the composition it renders in change, so historical answers and anything keyed by field_key
 * downstream are unaffected. `fa.operation.expected_capabilities` / `banking_status` /
 * `insurance_status` (CAP1 and children) are NOT relocated here: they are fully superseded by leaf
 * selection itself, with a rules-engine compatibility fallback in legacy-capability-adapter.ts
 * instead of a visible question. `fa.operation.growth_focus` (GROWTH1) is not here either — it has
 * no Needs Explorer equivalent (a "boost" signal, not a capability gap) and is confirmed load-bearing
 * in the rules engine (rules/engine.ts F.growthFocus), so it stays a real question, relocated into
 * "Your Project" (question-bank-v2.ts) instead of here.
 *
 * Also intentionally NOT relocated (removed outright, not just moved) because the question itself —
 * not just its topic — is redundant with the act of selecting the leaf: O1 (the old mother
 * question), O_SRC_LOCAL, O_IMP_CROSS_BORDER, O_WH_LOCAL, O_LM_LOCAL, O_WF_HIRING, O_PRT_DEPENDENCY
 * (each was a "do you expect/need this" yes/probably/no/not_sure question that leaf selection now
 * answers by itself), and O_TECH_SYSTEMS (its own options literally duplicate the erp/wms/tms
 * leaves; its two values with no leaf equivalent — crm, ecommerce, proprietary — had no confirmed
 * downstream consumer, per the review that grounded this decision).
 */

const selectedLeaf = (leaf: string) => when.includes("fa.needs.map", leaf);
const selectedAnyLeaf = (...leaves: string[]) => when.any(...leaves.map(selectedLeaf));

/**
 * Manufacturing — no Needs Explorer leaf exists for "manufacturing capacity" (a documented gap in
 * needs-explorer-taxonomy.ts); gated on the company's own declared business type (B2, asked in
 * "Your Company") instead of the removed O1 mother question, and rendered there — right after B2 —
 * rather than in Needs Landscape, per the progressive-disclosure rule of revealing right after the
 * answer that triggers it.
 */
export const MANUFACTURING_FOLLOWUP_QUESTIONS: QuestionDef[] = [
  q({
    id: "O_MFG_VOLUME",
    field_key: "fa.operation.manufacturing.monthly_volume",
    type: "quantity",
    applies_when: when.eq("fa.business.type", "manufacturing"),
    title: ["Roughly how much do you produce per month?", "¿Aproximadamente cuánto producen al mes?"],
    helper: ["An approximate figure is enough — for example, 20,000 units.", "Una cifra aproximada es suficiente; por ejemplo, 20,000 unidades."],
    placeholder: ["Unit (e.g. units, tons, liters)", "Unidad (p. ej. unidades, toneladas, litros)"],
  }),
  q({
    id: "O_MFG_SKU",
    field_key: "fa.operation.manufacturing.sku_range",
    type: "single_select",
    applies_when: when.eq("fa.business.type", "manufacturing"),
    title: ["How many products or SKUs do you manage?", "¿Cuántos productos o SKU manejan?"],
    options: opts(
      ["lt_10", "Fewer than 10", "Menos de 10"],
      ["10_50", "10–50", "10–50"],
      ["51_250", "51–250", "51–250"],
      ["251_1000", "251–1,000", "251–1,000"],
      ["1000_plus", "More than 1,000", "Más de 1,000"],
    ),
  }),
];

/** Gated on a Needs Explorer leaf being selected; rendered in composition 5 ("Needs Landscape"),
 *  immediately after `fa.needs.map` itself. */
export const NEEDS_FOLLOWUP_QUESTIONS: QuestionDef[] = [
  // Supplier search
  q({
    id: "O_SRC_SUPPLIERS",
    field_key: "fa.operation.sourcing.critical_supplier_count",
    type: "single_select",
    applies_when: selectedLeaf("supplier_search"),
    title: ["How many suppliers are critical to your operation?", "¿Cuántos proveedores son críticos para tu operación?"],
    options: opts(
      ["1_5", "1–5", "1–5"],
      ["6_20", "6–20", "6–20"],
      ["21_50", "21–50", "21–50"],
      ["51_plus", "More than 50", "Más de 50"],
      ["not_sure", "Not sure", "No estoy seguro"],
    ),
  }),
  q({
    id: "O_SRC_ITEMS",
    field_key: "fa.operation.sourcing.local_items",
    type: "text",
    applies_when: selectedLeaf("supplier_search"),
    title: ["What would need to be sourced locally?", "¿Qué necesitarías abastecer localmente?"],
  }),
  q({
    id: "O_SRC_STATUS",
    field_key: "fa.operation.sourcing.relationship_status",
    type: "single_select",
    applies_when: selectedLeaf("supplier_search"),
    title: ["Where are you with those local suppliers?", "¿Cómo vas con esos proveedores locales?"],
    options: RELATIONSHIP_STATUS,
  }),
  q({
    id: "O_SRC_CONTEXT",
    field_key: "fa.operation.sourcing.relationship_context",
    type: "text",
    required: false,
    applies_when: selectedLeaf("supplier_search"),
    title: ["Anything useful to know about those supplier relationships?", "¿Algo útil que debamos saber sobre esas relaciones con proveedores?"],
  }),
  // Import / export
  q({
    id: "O_IMP_SHIPMENTS",
    field_key: "fa.operation.import_export.monthly_shipments",
    type: "single_select",
    applies_when: selectedLeaf("foreign_trade_customs"),
    title: ["How many cross-border shipments do you typically handle per month?", "¿Cuántos envíos internacionales manejan normalmente al mes?"],
    options: opts(
      ["lt_5", "Fewer than 5", "Menos de 5"],
      ["5_20", "5–20", "5–20"],
      ["21_100", "21–100", "21–100"],
      ["101_plus", "More than 100", "Más de 100"],
      ["not_sure", "Not sure", "No estoy seguro"],
    ),
  }),
  // Warehousing
  q({
    id: "O_WH_MODEL",
    field_key: "fa.operation.warehousing.current_model",
    type: "single_select",
    applies_when: selectedLeaf("threepl_warehousing_inventory"),
    title: ["How do you manage inventory today?", "¿Cómo manejan su inventario hoy?"],
    options: opts(
      ["own", "Our own warehouse", "Almacén propio"],
      ["leased", "A leased warehouse", "Almacén rentado"],
      ["third_party_logistics", "A 3PL provider", "Un proveedor 3PL"],
      ["multiple", "Multiple models", "Varios modelos"],
      ["no_inventory", "We don’t hold inventory", "No manejamos inventario"],
    ),
  }),
  q({
    id: "O_WH_SCALE",
    field_key: "fa.operation.warehousing.scale",
    type: "quantity",
    required: false,
    applies_when: selectedLeaf("threepl_warehousing_inventory"),
    title: ["If you have a rough idea, what scale do you expect?", "Si ya tienes una idea aproximada, ¿qué escala esperas?"],
    units: opts(
      ["pallet_positions", "Pallet positions", "Posiciones de tarima"],
      ["square_meters", "Square meters", "Metros cuadrados"],
      ["orders_per_month", "Orders per month", "Pedidos al mes"],
    ),
  }),
  // Freight
  q({
    id: "O_FRT_FREQUENCY",
    field_key: "fa.operation.freight.frequency",
    type: "single_select",
    applies_when: selectedLeaf("freight_mobility"),
    title: ["How often do you move freight?", "¿Con qué frecuencia mueven carga?"],
    options: opts(
      ["daily", "Daily", "Diario"],
      ["several_weekly", "Several times a week", "Varias veces por semana"],
      ["weekly", "Weekly", "Semanal"],
      ["several_monthly", "Several times a month", "Varias veces al mes"],
      ["occasionally", "Occasionally", "Ocasionalmente"],
    ),
  }),
  q({
    id: "O_FRT_TYPE",
    field_key: "fa.operation.freight.type",
    type: "single_select",
    applies_when: selectedLeaf("freight_mobility"),
    title: ["What type of freight is it?", "¿Qué tipo de carga es?"],
    options: opts(
      ["dry", "Dry", "Seca"],
      ["refrigerated", "Refrigerated", "Refrigerada"],
      ["intermodal", "Intermodal", "Intermodal"],
      ["specialized", "Specialized", "Especializada"],
      ["other", "Other", "Otra"],
      ["not_sure", "Not sure", "No estoy seguro"],
    ),
  }),
  // Last mile
  q({
    id: "O_LM_DELIVERIES",
    field_key: "fa.operation.last_mile.monthly_deliveries",
    type: "single_select",
    applies_when: selectedLeaf("last_mile"),
    title: ["Roughly how many last-mile deliveries do you make per month?", "¿Aproximadamente cuántas entregas de última milla hacen al mes?"],
    options: opts(
      ["lt_500", "Fewer than 500", "Menos de 500"],
      ["500_5000", "500–5,000", "500–5,000"],
      ["5001_50000", "5,001–50,000", "5,001–50,000"],
      ["50001_plus", "More than 50,000", "Más de 50,000"],
      ["not_sure", "Not sure", "No estoy seguro"],
    ),
  }),
  // Facilities
  q({
    id: "O_FAC_REQUIRED",
    field_key: "fa.operation.facilities.facility_required",
    type: "single_select",
    applies_when: selectedAnyLeaf("industrial_warehouse_real_estate", "construction"),
    title: ["Will the new operation require a facility?", "¿La nueva operación requerirá instalaciones?"],
    options: opts(
      ["office", "Office", "Oficina"],
      ["warehouse", "Warehouse", "Almacén"],
      ["manufacturing", "Manufacturing", "Planta de manufactura"],
      ["retail", "Retail", "Punto de venta"],
      ["multiple", "Multiple", "Varias"],
      ["no", "No", "No"],
      ["not_sure", "Not sure", "No estoy seguro"],
    ),
  }),
  q({
    id: "O_FAC_LOCATION",
    field_key: "fa.operation.facilities.location_selected",
    type: "single_select",
    applies_when: when.all(
      selectedAnyLeaf("industrial_warehouse_real_estate", "construction"),
      when.in("fa.operation.facilities.facility_required", "office", "warehouse", "manufacturing", "retail", "multiple"),
    ),
    title: ["Has the location been selected or committed?", "¿Ya se seleccionó o comprometió la ubicación?"],
    options: opts(["yes", "Yes", "Sí"], ["evaluating", "We’re evaluating options", "Estamos evaluando opciones"], ["no", "Not yet", "Todavía no"]),
  }),
  // Technology — which system (erp/wms/tms) is now captured by leaf selection itself; only the
  // unique "will this need integration work" fact is kept, asked once across the whole group.
  q({
    id: "O_TECH_INTEGRATION",
    field_key: "fa.operation.technology.integration_expected",
    type: "single_select",
    applies_when: selectedAnyLeaf("erp", "wms", "tms", "data_video_surveillance"),
    title: [
      "Do you expect implementation, integration or adaptation work in the new market?",
      "¿Esperas trabajo de implementación, integración o adaptación en el nuevo mercado?",
    ],
    options: YES_PROBABLY_NO_NOT_SURE,
  }),
  // Workforce
  q({
    id: "O_WF_HEADCOUNT",
    field_key: "fa.operation.workforce.first_year_headcount",
    type: "single_select",
    applies_when: selectedLeaf("hr_payroll_social_security"),
    title: ["About how many people during the first year?", "¿Aproximadamente cuántas personas durante el primer año?"],
    options: opts(
      ["1_10", "1–10", "1–10"],
      ["11_50", "11–50", "11–50"],
      ["51_200", "51–200", "51–200"],
      ["201_plus", "More than 200", "Más de 200"],
      ["not_sure", "Not sure", "No estoy seguro"],
    ),
  }),
  // Partners
  q({
    id: "O_PRT_STATUS",
    field_key: "fa.operation.partners.relationship_status",
    type: "single_select",
    applies_when: selectedLeaf("local_partner_search_match"),
    title: ["Where are you with that partner?", "¿Cómo vas con ese socio?"],
    options: RELATIONSHIP_STATUS,
  }),
  q({
    id: "O_PRT_CONTEXT",
    field_key: "fa.operation.partners.relationship_context",
    type: "text",
    required: false,
    applies_when: selectedLeaf("local_partner_search_match"),
    title: ["Anything useful to know about that partner relationship?", "¿Algo útil que debamos saber sobre esa relación con el socio?"],
  }),
  // Regulated activities
  q({
    id: "O_REG_PERMITS",
    field_key: "fa.operation.regulated.permits_status",
    type: "single_select",
    applies_when: selectedLeaf("regulatory_permits"),
    title: [
      "Do you hold permits, certifications or regulatory approvals today?",
      "¿Hoy cuentan con permisos, certificaciones o aprobaciones regulatorias?",
    ],
    options: opts(["yes", "Yes", "Sí"], ["no", "No", "No"], ["not_sure", "Not sure", "No estoy seguro"]),
  }),
  q({
    id: "O_REG_WHICH",
    field_key: "fa.operation.regulated.permits_which",
    type: "text",
    applies_when: when.all(selectedLeaf("regulatory_permits"), when.eq("fa.operation.regulated.permits_status", "yes")),
    title: ["Which ones?", "¿Cuáles?"],
  }),
];
