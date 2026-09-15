import { Condition, OptionDef, QuestionDef } from "../engine/bundle-types";

/** A bilingual string: [English, Spanish]. */
export type Bi = readonly [string, string];

export function opts(...pairs: ReadonlyArray<readonly [string, string, string]>): OptionDef[] {
  return pairs.map(([value, en, es]) => ({ value, copy: { en, es } }));
}

export const YES_PROBABLY_NO_NOT_SURE = opts(
  ["yes", "Yes", "Sí"],
  ["probably", "Probably", "Probablemente"],
  ["no", "No", "No"],
  ["not_sure", "Not sure", "No estoy seguro"],
);

export const RELATIONSHIP_STATUS = opts(
  ["still_looking", "Still looking", "Todavía buscando"],
  ["identified", "Identified", "Identificado"],
  ["evaluating", "Evaluating", "En evaluación"],
  ["in_discussions", "In discussions", "En conversaciones"],
  ["selected", "Selected", "Seleccionado"],
  ["already_working_together", "Already working together", "Ya trabajamos juntos"],
);

export const RESOLUTION_STATUS = opts(
  ["already_in_place", "Already in place", "Ya está resuelto"],
  ["in_progress", "In progress", "En proceso"],
  ["need_to_establish", "We need to establish it", "Necesitamos establecerlo"],
  ["not_sure_required", "Not sure what will be required", "No estoy seguro de qué se requerirá"],
);

/** Rules Matrix v1 §0 fixed category list, in catalog order. */
export const CATEGORY_OPTIONS = opts(
  ["target_market", "Target market", "Mercado objetivo"],
  ["customs_trade", "Customs & trade", "Aduanas y comercio exterior"],
  ["local_sourcing_suppliers", "Local sourcing / suppliers", "Abastecimiento / proveedores locales"],
  ["local_inventory_warehousing", "Local inventory & warehousing", "Inventario y almacenamiento local"],
  ["freight_logistics", "Freight & logistics", "Transporte y logística"],
  ["technology_systems", "Technology systems", "Sistemas tecnológicos"],
  ["local_workforce", "Local workforce", "Personal local"],
  ["facilities_real_estate", "Facilities & real estate", "Instalaciones e inmuebles"],
  ["local_partner_distributor", "Local partner / distributor", "Socio / distribuidor local"],
  ["regulatory_permits_certifications", "Regulatory permits & certifications", "Permisos y certificaciones regulatorias"],
  ["local_entity_legal_setup", "Local entity & legal setup", "Entidad local y estructura legal"],
  ["banking", "Banking", "Banca"],
  ["insurance", "Insurance", "Seguros"],
  ["go_to_market_commercial_strategy", "Go-to-market / commercial strategy", "Estrategia comercial / de entrada al mercado"],
  ["other", "Other", "Otro"],
);

export const SELECT_ALL: Bi = ["Select all that apply.", "Selecciona todas las que apliquen."];

interface QuestionInput extends Omit<QuestionDef, "copy" | "required"> {
  required?: boolean;
  title: Bi;
  helper?: Bi;
  placeholder?: Bi;
}

export function q(input: QuestionInput): QuestionDef {
  const { title, helper, placeholder, required = true, ...rest } = input;
  const locale = (i: 0 | 1) => ({
    title: title[i],
    ...(helper ? { helper: helper[i] } : {}),
    ...(placeholder ? { placeholder: placeholder[i] } : {}),
  });
  return { ...rest, required, copy: { en: locale(0), es: locale(1) } };
}

export const when = {
  eq: (field: string, value: string): Condition => ({ field, op: "eq", value }),
  in: (field: string, ...values: string[]): Condition => ({ field, op: "in", values }),
  includes: (field: string, ...values: string[]): Condition => ({ field, op: "includes_any", values }),
  answered: (field: string): Condition => ({ field, op: "answered" }),
  any: (...conditions: Condition[]): Condition => ({ any: conditions }),
  all: (...conditions: Condition[]): Condition => ({ all: conditions }),
};
