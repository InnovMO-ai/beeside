import { createHash } from "node:crypto";
import { canonicalJson, type Fa4PrecisionContextV1 } from "@beeside/fa-public-engine";
import type { Db } from "../../db/database";
import { getFa4PrecisionContext } from "../../fa4/precision";
import { FaError } from "../../fa/services/errors";
import { IntegrationDescriptor } from "../ports/integration-descriptor";
import type { FaClientSafeContext, FaContextRead, FaContextReader } from "../ports/fa-context";

/**
 * PERMANENT Discovery -> Precision reader.
 *
 * Discovery (module `fa4`) and Precision run in the same platform, so the boundary is the canonical in-process function Discovery publishes,
 * `getFa4PrecisionContext(projectId, resultId)` -> `Fa4PrecisionContextV1` (contract `fa4-precision-context/1`), NOT an HTTP hop and NOT Discovery's tables:
 *   - it reads ONLY the sealed (delivered, immutable) result envelope; never the mutable project/answers, never the rendered view (YEV), no AI;
 *   - this adapter additionally resolves ids to display names from the IMMUTABLE catalog version that result names (reproducible; Precision keeps its own
 *     crosswalk from capability id to category and never uses a name to decide a category from the contract);
 *   - which result is current is "the latest sealed result of the project" (append-only, monotonic sequence).
 * The only things this file decides are Precision-side: how the contract is flattened into the port's client-safe context, and the context hash Precision pins
 * (the contract says the hash lives with Precision). Nothing is copied into Precision tables here (the pin is a reference), and nothing is written.
 */
export const SUPPORTED_CONTRACT = "fa4-precision-context/1";
/** Precision's own crosswalk (FA 4.0 capability -> destination category) version this adapter's consumers apply. */
export const PRECISION_CROSSWALK_VERSION = "v3";

/** A contract whose version Precision does not know: refused loudly, never guessed at (the service logs it and reports Discovery as unavailable). */
export class UnsupportedDiscoveryContractError extends Error {
  constructor(readonly found: string) { super(`Discovery contract "${found}" is not supported (supported: ${SUPPORTED_CONTRACT})`); this.name = "UnsupportedDiscoveryContractError"; }
}

type Loc = "es" | "en";
const L = (es: string, en: string): Record<Loc, string> => ({ es, en });

const START: Record<string, Record<Loc, string>> = {
  asap: L("lo antes posible", "as soon as possible"), "3m": L("en los próximos 3 meses", "within 3 months"),
  "6m": L("en los próximos 6 meses", "within 6 months"), "12m": L("en los próximos 12 meses", "within 12 months"),
};
const PRESENCE: Record<string, Record<Loc, string>> = {
  remote: L("a distancia", "remotely"), third_parties: L("a través de terceros", "through third parties"), own_physical: L("con instalaciones propias", "with own premises"),
  own_onsite: L("con ejecución propia en sitio, sin instalaciones propias", "with own on-site execution, without own premises"), acquisition: L("mediante una adquisición", "through an acquisition"),
};
const PERMANENCE: Record<string, Record<Loc, string>> = { permanent: L("permanente", "permanent"), temporary: L("temporal", "temporary") };
const EXISTING: Record<string, Record<Loc, string>> = {
  nothing: L("hoy no tiene actividad allí", "no activity there today"), commercial_traction: L("hoy tiene clientes o conversaciones comerciales, sin presencia propia", "customers or commercial conversations today, without own presence"),
  via_third: L("hoy opera mediante terceros", "operates through third parties today"), own: L("hoy tiene presencia propia", "has its own presence today"),
};
const ACTIVITY: Record<string, Record<Loc, string>> = {
  sell: L("vender", "sell"), produce: L("producir", "produce"), source: L("abastecerse", "source supplies"), operate: L("operar", "operate"), hire: L("contratar personal", "hire staff"), invest_only: L("solo invertir", "invest only"),
};
const WITH: Record<string, Record<Loc, string>> = { goods: L("bienes", "goods"), services: L("servicios", "services"), digital: L("productos digitales", "digital products") };
const SELLS: Record<string, Record<Loc, string>> = { companies: L("empresas", "companies"), government: L("gobierno", "government"), consumers: L("consumidores", "consumers"), mixed: L("clientes mixtos", "mixed customers") };
const CARRIES: Record<string, Record<Loc, string>> = { people: L("personas", "people"), equipment: L("equipo", "equipment") };
const REASON: Record<string, Record<Loc, string>> = {
  client_request: L("lo piden clientes", "clients ask for it"), follow_clients: L("seguir a sus clientes", "follow its clients"), growth: L("crecer", "grow"), talent: L("talento", "talent"), cost: L("costos", "cost"),
  resilience: L("resiliencia", "resilience"), diversify: L("diversificar", "diversify"), contract: L("un contrato", "a contract"), partner: L("un socio", "a partner"),
};
const SUPPORT: Record<string, Record<Loc, string>> = {
  speed: L("velocidad", "speed"), no_network: L("no necesita red propia", "no network of its own"), single_contact: L("un solo contacto", "a single contact"), local_validation: L("validación local", "local validation"),
  comparable_options: L("opciones comparables", "comparable options"), coordination: L("coordinación", "coordination"), cost: L("costo", "cost"), keep_control: L("mantener el control", "keep control"),
};
const list = (xs: readonly string[], dict: Record<string, Record<Loc, string>>, loc: Loc): string[] => xs.map((x) => dict[x]?.[loc]).filter((x): x is string => Boolean(x));
const join = (xs: string[], loc: Loc): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${loc === "es" ? "y" : "and"} ${xs[xs.length - 1]}`);

/** What the client DECLARED, in plain sentences (Discovery provenance; interpreted by Precision with the same governed interpreter as any client text). */
export function declaredStatements(c: Fa4PrecisionContextV1): string[] {
  const loc: Loc = c.locale;
  const d = c.declared;
  const out: string[] = [];
  for (const comp of d.components) {
    const bits: string[] = [];
    if (comp.description) bits.push(comp.description);
    const act = list(comp.activities, ACTIVITY, loc); if (act.length) bits.push(`${loc === "es" ? "quiere" : "wants to"} ${join(act, loc)}`);
    const what = list(comp.offering, WITH, loc); if (what.length) bits.push(`${loc === "es" ? "con" : "with"} ${join(what, loc)}`);
    const pres = comp.presenceModel ? PRESENCE[comp.presenceModel]?.[loc] : undefined; if (pres) bits.push(pres);
    const perm = comp.permanence ? PERMANENCE[comp.permanence]?.[loc] : undefined;
    if (perm) bits.push(`${perm}${comp.durationMonths ? ` (${comp.durationMonths} ${loc === "es" ? "meses" : "months"})` : ""}`);
    const ex = EXISTING[comp.currentPositionInDestination.state === "COMMERCIAL_TRACTION" ? "commercial_traction" : comp.currentPositionInDestination.state === "THIRD_PARTY_OPERATION" ? "via_third" : comp.currentPositionInDestination.state === "OWN_PRESENCE" ? "own" : comp.currentPositionInDestination.state === "NONE" ? "nothing" : ""]?.[loc];
    if (ex) bits.push(ex);
    if (comp.currentPositionInDestination.note) bits.push(comp.currentPositionInDestination.note);
    const sells = comp.customerType ? SELLS[comp.customerType]?.[loc] : undefined; if (sells) bits.push(`${loc === "es" ? "vende a" : "sells to"} ${sells}`);
    const carries = list(comp.movesFromAbroad, CARRIES, loc); if (carries.length) bits.push(`${loc === "es" ? "llevaría desde su país" : "would move from abroad"}: ${join(carries, loc)}`);
    if (comp.exactLocation.text) bits.push(`${loc === "es" ? "ubicación" : "location"}: ${comp.exactLocation.text}`);
    if (bits.length) out.push(`${comp.countries.join("/")}: ${bits.join("; ")}.`);
  }
  const why = list(d.intent.motivations, REASON, loc);
  if (why.length) out.push(`${loc === "es" ? "Motivos" : "Reasons"}: ${join(why, loc)}.`);
  if (d.intent.projectSize.some((p) => p.state === "ANSWERED")) out.push(`${loc === "es" ? "Tamaño" : "Size"}: ${d.intent.projectSize.filter((p) => p.state === "ANSWERED").map((p) => p.answer).join("; ")}.`);
  if (d.intent.externalDeadline.has && (d.intent.externalDeadline.date || d.intent.externalDeadline.what)) out.push(`${loc === "es" ? "Fecha límite externa" : "External deadline"}: ${[d.intent.externalDeadline.what, d.intent.externalDeadline.date].filter(Boolean).join(" — ")}.`);
  for (const n of d.addedNeeds) if (n.text.trim()) out.push(`${loc === "es" ? "Necesidad que mencionó" : "Need it mentioned"} (${n.destination}): ${n.text.trim()}.`);
  const sup = list(d.supportPreferences.values, SUPPORT, loc); if (sup.length) out.push(`${loc === "es" ? "Valora" : "Values"}: ${join(sup, loc)}${d.supportPreferences.words ? ` — ${d.supportPreferences.words}` : ""}.`);
  if (d.supportPreferences.keepInTeam) out.push(`${loc === "es" ? "Prefiere mantener en su equipo" : "Prefers to keep in its team"}: ${d.supportPreferences.keepInTeam}.`);
  for (const [k, v] of [["success", loc === "es" ? "Éxito para el cliente" : "Success for the client"], ["constraints", loc === "es" ? "Restricciones" : "Constraints"], ["priorExperience", loc === "es" ? "Experiencia previa" : "Prior experience"], ["description", loc === "es" ? "Descripción" : "Description"]] as const) {
    const t = d.notes[k]; if (t && t.trim()) out.push(`${v}: ${t.trim()}.`);
  }
  return out;
}

const CAPS_OK = new Set(["ACTIVE", "SOURCEABLE", "REVIEW"]);

export function toClientSafeContext(c: Fa4PrecisionContextV1, nameOf: (capabilityId: string) => string | undefined): FaClientSafeContext {
  const loc: Loc = c.locale;
  const d = c.declared;
  const dest = d.destinations.list;
  const timeframe = d.intent.externalDeadline.has && d.intent.externalDeadline.date ? d.intent.externalDeadline.date : d.intent.startTiming ? START[d.intent.startTiming]?.[loc] : undefined;
  const needs: FaClientSafeContext["needs"] = [];
  const seen = new Set<string>();
  for (const dd of c.derived.destinations) {
    for (const n of dd.needs) {
      // A capability Discovery DETERMINED for this project (not a "may apply" hint and not something the catalog does not offer)
      if (n.possible || n.state === "NOT_OFFERED" || n.state === "UNMAPPED_NEED") continue;
      for (const cap of n.capabilities) {
        if (!CAPS_OK.has(cap.state) || seen.has(cap.capabilityId)) continue;
        seen.add(cap.capabilityId);
        needs.push({
          capabilityId: cap.capabilityId, label: nameOf(cap.capabilityId) ?? cap.capabilityId,
          // only what the client said: a topic they marked critical is their priority; Discovery never invents one
          ...(n.critical ? { priority: "high" as const } : {}), ...(n.status ? { status: n.status } : {}),
        } as FaClientSafeContext["needs"][number]);
      }
    }
  }
  const context = declaredStatements(c).join(" ").slice(0, 2400);
  return {
    project: {
      destinationCountry: dest.map((x) => x.country).join(", "),
      ...(dest.some((x) => x.region) ? { destinationMarket: dest.filter((x) => x.region).map((x) => `${x.country}: ${x.region}`).join("; ") } : {}),
      sector: d.company.sector,
      expansionObjective: d.components.map((x) => x.description).filter(Boolean).join("; ") || d.notes.description || "",
      ...(timeframe ? { timeframe } : {}),
    },
    company: { displayName: d.company.name, ...(d.company.size ? { sizeBand: d.company.size } : {}), operatingCountries: [...d.company.operatesIn] },
    needs,
    literals: { ...(d.intent.motivationText ? { motive: d.intent.motivationText } : {}), ...(context ? { context } : {}) },
    locale: loc,
  };
}

export class Fa4DiscoveryContextReader implements FaContextReader {
  private readonly names = new Map<string, Map<string, { es: string; en: string }>>();
  constructor(private readonly db: Db) {}

  describe(): IntegrationDescriptor {
    return {
      port: "fa_context", implementation: "discovery", mode: "REAL", verification: "NOT_VERIFIED",
      note: `In-process canonical contract ${SUPPORTED_CONTRACT} (getFa4PrecisionContext): sealed immutable result only; no YEV, no mutable tables, no HTTP hop.`,
    };
  }

  private async capabilityNames(catalogVersion: string): Promise<Map<string, { es: string; en: string }>> {
    const hit = this.names.get(catalogVersion);
    if (hit) return hit;
    const { rows } = await this.db.query<{ content: { capabilities?: Array<{ capabilityId: string; nameEs: string; nameEn: string }> } }>("SELECT content FROM fa4_catalog_version WHERE version = $1", [catalogVersion]);
    const m = new Map<string, { es: string; en: string }>();
    for (const c of rows[0]?.content.capabilities ?? []) m.set(c.capabilityId, { es: c.nameEs, en: c.nameEn });
    this.names.set(catalogVersion, m);   // a catalog version is immutable: safe to keep
    return m;
  }

  async read(projectId: string): Promise<FaContextRead | null> {
    const row = (await this.db.query<{ result_id: string }>("SELECT result_id FROM fa4_result WHERE project_id = $1 AND NOT legacy_unsealed ORDER BY result_seq DESC LIMIT 1", [projectId])).rows[0];
    if (!row) return null;                                                   // not delivered yet: a normal state
    let c: Fa4PrecisionContextV1;
    try {
      c = await getFa4PrecisionContext(this.db, projectId, row.result_id);
    } catch (e) {
      if (e instanceof FaError && (e.code === "NOT_FOUND" || e.code === "NOT_RECOVERABLE")) return null;   // erased or not eligible: nothing to inherit
      throw e;                                                               // anything else (incl. an unreadable envelope) is a failure the service reports, never a guess
    }
    const major = /^fa4-precision-context\/(\d+)$/.exec(c.contract.version);
    if (!major || c.contract.version !== SUPPORTED_CONTRACT) throw new UnsupportedDiscoveryContractError(c.contract.version);
    if (c.ids.projectId !== projectId) throw new Error("Discovery returned a context for another project");   // permanent project identity: never bridged
    const names = await this.capabilityNames(c.versions.catalogVersion);
    const context = toClientSafeContext(c, (id) => names.get(id)?.[c.locale]);
    return {
      sourceSystem: "fa4", sourceProjectId: c.ids.projectId, sourceResultId: c.ids.resultId, catalogVersion: c.versions.catalogVersion,
      contractVersion: c.contract.version, crosswalkVersion: PRECISION_CROSSWALK_VERSION,
      // the hash of what Discovery handed over (the contract: "the hash lives with Precision"), not of Precision's flattening of it
      contextHash: createHash("sha256").update(canonicalJson(c)).digest("hex"), deliveredAt: c.deliveredAt, context,
    };
  }
}
