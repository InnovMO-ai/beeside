/**
 * Material signals — cross-cutting facts about the PROJECT that no single category owns (a Portuguese parent, parent funding, intra-group
 * services, related-party goods, a mixed workforce...). They are derived, purely and deterministically, from what the client said or
 * confirmed (Discovery included); an AI proposal never counts. A signal is not a category field: it is a dimension of the Project Frame that
 * every relevant category can read, so a material fact is never lost because the taxonomy has no natural owner.
 *
 * Two consumers: the materiality overlay (readiness = material sufficiency, see category-materiality.ts) and the "what I already know" panel.
 */
import type { Frame, FrameItem, L10n } from "./types";

export type SignalKey =
  | "local_entity"
  | "foreign_parent"
  | "parent_funding"
  | "parent_loan"
  | "parent_equity"
  | "intercompany_any"
  | "intercompany_services"
  | "intercompany_goods"
  | "intercompany_financing"
  | "intercompany_ip"
  | "workforce_direct"
  | "workforce_third_party"
  | "group_reporting"
  | "partners"
  | "existing_presence";

export interface MaterialSignal { key: SignalKey; text: L10n; /** Frame item keys / country codes that support it. */ basis: string[] }

/** Only what the client said, confirmed, corrected or Discovery captured (never `ai_understood`). */
const clientSide = (i: FrameItem | undefined): i is FrameItem => Boolean(i) && i!.provenance !== "ai_understood" && (i!.status === "known" || i!.status === "undecided");

const kindsOf = (i: FrameItem): string[] => {
  const v = i.value && typeof i.value === "object" ? (i.value as { kinds?: unknown }) : {};
  return Array.isArray(v.kinds) ? v.kinds.filter((k): k is string => typeof k === "string" && k !== "unspecified") : [];
};
const unspecifiedIntercompany = (i: FrameItem): boolean => {
  const v = i.value && typeof i.value === "object" ? (i.value as { unspecified?: unknown; kinds?: unknown }) : {};
  return Boolean(v.unspecified);
};

const T = (es: string, en: string): L10n => ({ es, en });

/** Country name for client-language lines; the code when unknown (no table to keep in sync here). */
const NAMES: Record<string, L10n> = {
  PT: T("Portugal", "Portugal"), MX: T("México", "Mexico"), ES: T("España", "Spain"), US: T("Estados Unidos", "United States"), DE: T("Alemania", "Germany"),
  FR: T("Francia", "France"), IT: T("Italia", "Italy"), BR: T("Brasil", "Brazil"), CL: T("Chile", "Chile"), CO: T("Colombia", "Colombia"), CN: T("China", "China"),
  JP: T("Japón", "Japan"), KR: T("Corea del Sur", "South Korea"), CA: T("Canadá", "Canada"), GB: T("Reino Unido", "United Kingdom"), NL: T("Países Bajos", "Netherlands"),
};
export const countryName = (code: string, loc: "es" | "en"): string => NAMES[code]?.[loc] ?? code;

export function materialSignals(frame: Frame): MaterialSignal[] {
  const out: MaterialSignal[] = [];
  const loc = frame.locale;
  const add = (key: SignalKey, es: string, en: string, basis: string[]): void => {
    if (!out.some((s) => s.key === key)) out.push({ key, text: T(es, en), basis });
  };
  const operation = frame.countries.find((c) => c.role === "operation")?.code;
  const funding = frame.items["entity.funding"];
  const structure = frame.items["entity.funding_structure"];
  const inter = frame.items["tax.intercompany"];
  const form = frame.items["entity.form"];
  const model = frame.items["workforce.model"];
  const accounting = frame.items["accounting.setup"];

  const fundedByParent = clientSide(funding) && Array.isArray((funding.value as { sources?: unknown } | null)?.sources) && ((funding.value as { sources: string[] }).sources).includes("parent");
  const kinds = clientSide(inter) ? kindsOf(inter) : [];
  const interSignal = clientSide(inter) && (kinds.length > 0 || unspecifiedIntercompany(inter));

  // a parent exists abroad: stated as headquarters, or as the origin of a project whose parent funds it / trades with it
  const hq = frame.countries.find((c) => c.role === "headquarters" && c.code !== operation && c.provenance !== "ai_understood");
  const origin = frame.countries.find((c) => c.role === "origin" && c.code !== operation && c.provenance !== "ai_understood");
  const parentCountry = hq ?? ((fundedByParent || interSignal) ? origin : undefined);

  if (clientSide(form) && ["company", "branch", "rep_office"].includes((form.value as { kind?: string } | null)?.kind ?? "")) {
    add("local_entity", "Habrá una entidad propia en el país", "There will be a local entity", [form.key]);
  } else if (clientSide(form) && form.status === "undecided") {
    add("local_entity", "Se está evaluando crear una entidad en el país", "A local entity is being considered", [form.key]);
  }
  if (parentCountry) {
    const n = countryName(parentCountry.code, loc);
    add("foreign_parent", `La casa matriz está en ${n}`, `The parent company is in ${n}`, [`country:${parentCountry.code}`]);
  } else if (fundedByParent) {
    add("foreign_parent", "Hay una casa matriz fuera del país", "There is a parent company abroad", [funding!.key]);
  }
  if (fundedByParent) add("parent_funding", "La casa matriz financiará la operación local", "The parent will fund the local operation", [funding!.key]);
  if (clientSide(structure)) {
    const v = structure.value;
    if (v === "loan" || v === "mixed") add("parent_loan", "El financiamiento incluye un préstamo de la matriz", "The funding includes a loan from the parent", [structure.key]);
    if (v === "equity" || v === "mixed") add("parent_equity", "El financiamiento incluye aportación de capital", "The funding includes a capital contribution", [structure.key]);
  }
  if (interSignal) {
    add("intercompany_any", "Habrá operaciones entre la entidad local y el grupo", "There will be transactions between the local entity and the group", [inter!.key]);
    if (kinds.includes("services") || kinds.some((k) => /servicios|services/i.test(k))) add("intercompany_services", "Habrá servicios entre empresas del grupo", "There will be intra-group services", [inter!.key]);
    if (kinds.some((k) => /equipo|materiales|equipment|goods/i.test(k))) add("intercompany_goods", "Habrá compraventa de equipo o materiales con el grupo", "There will be equipment or goods transactions with the group", [inter!.key]);
    if (kinds.some((k) => /pr[eé]stamos|loans?|financ/i.test(k))) add("intercompany_financing", "Habrá préstamos entre empresas del grupo", "There will be intra-group loans", [inter!.key]);
    if (kinds.some((k) => /regal[ií]as|licen[cs]|royalt/i.test(k))) add("intercompany_ip", "Habrá regalías o licencias con el grupo", "There will be royalties or licences with the group", [inter!.key]);
  }
  if (clientSide(model)) {
    const v = model.value;
    if (v === "direct" || v === "mixed") add("workforce_direct", "Parte del personal se contratará directamente", "Part of the staff will be hired directly", [model.key]);
    if (v === "outsourced" || v === "mixed") add("workforce_third_party", "Parte del personal vendrá por un tercero", "Part of the staff will come through a third party", [model.key]);
  }
  // cross-cutting facts the client stated that no probe owns (a local partner, an entity that already exists)
  for (const x of frame.crossCutting ?? []) {
    if (x.kind === "partners") add("partners", "Habrá un socio o alianza local", "There will be a local partner", [x.id]);
    if (x.kind === "existing_presence") { add("existing_presence", "Ya hay presencia en el país", "There is already a presence in the country", [x.id]); add("local_entity", "Ya existe una entidad en el país", "An entity already exists in the country", [x.id]); }
  }
  if (clientSide(accounting) && /consolid|reporte (?:a|para) la matriz|reportar a la matriz|group reporting|report to the parent/i.test(`${accounting.display} ${typeof accounting.value === "string" ? accounting.value : ""}`)) {
    add("group_reporting", "Hay que reportar la contabilidad al grupo", "Accounting must be reported to the group", [accounting.key]);
  }
  return out;
}

export const hasSignal = (signals: readonly MaterialSignal[], key: SignalKey): boolean => signals.some((s) => s.key === key);
