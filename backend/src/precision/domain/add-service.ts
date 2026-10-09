/**
 * Add a Service: what happens once the client has confirmed a need in the Add a Service thread.
 *
 * The conversation only collects and confirms the need. Here the DOMAIN decides, deterministically (`classifyNeed`, never a
 * model), where it goes, and applies it in ONE transaction under the project's map lock, keyed by the confirming turn so a
 * replay has no second effect:
 *   out_of_scope           -> nothing is created; the client gets a plain notice (no promise either way)
 *   strategic_advisory     -> an item in `sa_studies`
 *   ecosystem_development  -> an item in `ed_engagements`
 *   known_service          -> the service is added to the category's services in scope
 *   unmapped_known_category-> `generic_has_unmapped_need` + an item in `generic_unmapped_needs`
 *   discovery / generic    -> `generic_needs` (a `new:<slug>` category is created when none exists)
 * Then the category exists as "Not started" and a new Service Map version is recorded (`precision_psm_new_version`).
 * Unmapped is not the same as out of scope, and nothing here promises availability, price or timing.
 */
import { createHash } from "node:crypto";
import type { Db } from "../../db/database";
import { ApiError } from "../api/errors";
import { bundledCatalog, bundledServicesProjection, cleanText, classifyNeed, containsTerm, normalizeSlug } from "../manifest";
import type { EngineClassification, FactMap } from "../manifest/types";
import type { Locale } from "../manifest/value-render";
import type { FaContextRead } from "../ports/fa-context";
import { appendMapNeeds, ensureCategoryInstance, type MapNeed } from "./categories";
import { loadCategoryRef, listCategoryRefs } from "./category-ref";
import type { PrecisionDomainDeps } from "./deps";
import { emitEvent } from "./events";
import { loadFactMap, lockProjectMap, recordCandidateFact } from "./facts";
import { loadPaState } from "./project-state";
import { buildLiveMap } from "./service-map";

export interface AddServiceOutcome {
  kind: "applied" | "out_of_scope";
  /** Internal scenario name (logs and events only). */
  scenario: string;
  /** For out_of_scope: the copy key of the notice to show. */
  noticeCopyKey?: string;
}

const NOTICE_BY_TOPIC: Record<string, string> = { mobility_immigration: "oos_mobility" };

export const requestKeyOf = (turnKey: string): string => `add_service:${turnKey}`.slice(0, 160);
const needId = (need: string): string => `add:${createHash("sha256").update(need.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 10)}`;

/** Signals the classifier needs, found by plain matching on the catalog (the model suggests nothing here). */
function suggestSignals(need: string, pm: Parameters<typeof classifyNeed>[1]): { service_key?: string; category_key?: string } {
  const rows = bundledServicesProjection();
  const hits = rows.filter(([, , key, name]) => containsTerm(need, name) || containsTerm(need, key.replace(/_/g, " ")));
  const services = [...new Set(hits.map((h) => h[2]))];
  if (services.length === 1) return { service_key: services[0] as string };
  const cats = [...new Set(hits.map((h) => h[1]))];
  if (cats.length === 1) return { category_key: cats[0] as string };
  if (hits.length > 0) return {};
  const byText = (pm?.candidate_categories ?? [])
    .filter((c) => c.kind === "catalog" && [...c.detection_signals_positive.en, ...c.detection_signals_positive.es].some((s) => containsTerm(need, s)))
    .map((c) => c.category_key);
  return byText.length === 1 ? { category_key: byText[0] as string } : {};
}

type FieldIndex = Map<string, { type: string; values?: string[] }>;
const fieldIndexOf = (manifest: { fields: Array<{ field_key: string; type: string; values?: unknown }> }): FieldIndex =>
  new Map(manifest.fields.map((f) => [f.field_key, { type: f.type, ...(Array.isArray(f.values) ? { values: f.values.filter((v): v is string => typeof v === "string") } : {}) }]));

const asItems = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown> | null>).map((i) => ({ ...(i ?? {}) })) : []);

interface Writer { put(fieldKey: string, value: unknown, valueType: string): Promise<void> }

function writerFor(tx: Db, projectId: string, instanceId: string, initial: FactMap, turnKey: string): Writer {
  let current = initial;
  return {
    async put(fieldKey, value, valueType) {
      const id = await recordCandidateFact(
        tx,
        { projectId, scopeInstanceId: instanceId, source: "category", fact: { fieldKey, value, valueType, answerState: "ANSWERED", provenanceStage: "client_confirmed", confidence: null, supersedes: false, idempotencyKey: `${turnKey}:${fieldKey}` } },
        current,
      );
      if (id) current = { ...current, [fieldKey]: { value, answerState: "ANSWERED", provenance: "client_confirmed" } };
    },
  };
}

/** Writes the need into the category's own fields according to the scenario. Returns the scenario actually applied. */
async function writeNeed(w: Writer, facts: FactMap, fields: FieldIndex, scenario: string, need: string, serviceKey: string | undefined, categoryKey: string): Promise<void> {
  const appendItem = async (group: string, sub: string): Promise<void> => {
    const items = asItems(facts[group]?.value);
    if (items.some((i) => typeof i[sub] === "string" && String(i[sub]).toLowerCase() === need.toLowerCase())) return;
    items.push({ [sub]: need });
    await w.put(group, items, "repeatable_group");
  };
  const generic = async (hasFlag: string | null, group: string): Promise<boolean> => {
    if (!fields.has(group)) return false;
    if (hasFlag) {
      if (!fields.has(hasFlag)) return false;
      await w.put(hasFlag, true, "boolean");
    }
    await appendItem(group, "need_description");
    return true;
  };

  if (scenario === "strategic_advisory" && fields.has("sa_studies")) return appendItem("sa_studies", "objective");
  if (scenario === "ecosystem_development" && fields.has("ed_engagements")) return appendItem("ed_engagements", "purpose");
  if (scenario === "known_service" && serviceKey) {
    const key = `${categoryKey}_services_in_scope`;
    const def = fields.get(key);
    if (def && def.values?.includes(serviceKey)) {
      const have = Array.isArray(facts[key]?.value) ? (facts[key]?.value as unknown[]).filter((v): v is string => typeof v === "string") : [];
      if (!have.includes(serviceKey)) await w.put(key, [...have, serviceKey], "multi_enum");
      return;
    }
  }
  // unmapped need inside an authored category, or any category backed by the generic manifest
  if (await generic("generic_has_unmapped_need", "generic_unmapped_needs")) return;
  if (fields.has("generic_needs")) {
    if (fields.has("generic_classification_confirmed")) await w.put("generic_classification_confirmed", true, "boolean");
    await appendItem("generic_needs", "need_description");
  }
}

export interface NeedDecision {
  /** Copy key of the notice when the need is out of scope (nothing is created), else null. */
  outOfScope: string | null;
  targetKey: string;
  effective: string;
  signals: { service_key?: string; category_key?: string };
}

/** Where a confirmed need goes. Pure decision: reads the project manifest and the project's instance keys, writes nothing. */
export async function classifyForProject(
  deps: Pick<PrecisionDomainDeps, "registry">,
  q: Pick<Db, "query">,
  projectId: string,
  paManifestVersion: string,
  need: string,
): Promise<NeedDecision> {
  const pm = (await deps.registry.getProjectManifest(paManifestVersion)) ?? (await deps.registry.getProjectManifest());
  if (!pm) throw new Error("no project manifest is published");
  const refs = await listCategoryRefs(q, projectId);
  const signals = suggestSignals(need, pm.manifest);
  const cls: EngineClassification = classifyNeed({ text: need, ...signals, existing_instance_keys: refs.map((r) => r.categoryKey) }, pm.manifest, bundledCatalog());
  const scenario = String(cls.scenario);
  if (scenario === "out_of_scope") return { outOfScope: NOTICE_BY_TOPIC[String(cls.topic_key ?? "")] ?? "add_service_not_available_yet", targetKey: "", effective: scenario, signals };
  if (scenario === "strategic_advisory" || scenario === "ecosystem_development") return { outOfScope: null, targetKey: String(cls.instance_key), effective: scenario, signals };
  if (scenario === "known_service") return { outOfScope: null, targetKey: String(cls.category_key), effective: scenario, signals };
  if (scenario === "unmapped_known_category" || scenario === "known_category_exists") return { outOfScope: null, targetKey: String(cls.category_key), effective: "unmapped_known_category", signals };
  if (scenario === "ambiguous") {
    // the client confirmed the service in so many words: that confirmed service wins over a study-sounding phrase
    const options = (cls.options as string[] | undefined) ?? [];
    return { outOfScope: null, targetKey: String(options[1] ?? options[0]), effective: "known_service", signals };
  }
  return { outOfScope: null, targetKey: String(cls.instance_key ?? `new:${normalizeSlug(need)}`), effective: "discovery", signals };
}

/** Applies a confirmed need. Idempotent per `turnKey`. */
export async function applyConfirmedNeed(
  deps: Pick<PrecisionDomainDeps, "db" | "registry" | "log">,
  read: FaContextRead | null,
  args: { projectId: string; locale: Locale; turnKey: string; need: string },
): Promise<AddServiceOutcome> {
  const { projectId, locale, turnKey } = args;
  const need = cleanText(args.need).slice(0, 160);
  if (need.length < 3) throw new ApiError("INVALID_INPUT");
  const requestKey = requestKeyOf(turnKey);

  return deps.db.transaction(async (tx): Promise<AddServiceOutcome> => {
    await lockProjectMap(tx, projectId);
    const pa = await loadPaState(tx, projectId);
    if (!pa || pa.status !== "confirmed") throw new ApiError("CONFLICT");

    const done = (await tx.query("SELECT 1 FROM service_map_snapshot WHERE precision_instance_id = $1 AND content->>'client_request_id' = $2", [pa.instanceId, requestKey])).rows.length > 0;
    if (done) return { kind: "applied", scenario: "replayed" };

    const decision = await classifyForProject(deps, tx, projectId, pa.manifestVersion, need);
    if (decision.outOfScope) return { kind: "out_of_scope", scenario: "out_of_scope", noticeCopyKey: decision.outOfScope };
    const { targetKey, effective, signals } = decision;

    const { instanceId, created } = await ensureCategoryInstance(deps, tx, projectId, targetKey, "client_added", "confirmed");
    const ref = await loadCategoryRef(tx, projectId, instanceId);
    if (!ref) throw new ApiError("CONFLICT");
    const manifest = await deps.registry.getManifestForCategory(ref.categoryKey, ref.manifestVersion);
    const facts = await loadFactMap(tx, instanceId);
    const mapNeed: MapNeed = { id: needId(need), label: need, priority: null, source: "client" };
    await appendMapNeeds(tx, projectId, instanceId, [mapNeed]);
    await writeNeed(writerFor(tx, projectId, instanceId, facts, turnKey), facts, fieldIndexOf(manifest.manifest as never), effective, need, signals.service_key, ref.categoryKey);

    const live = await buildLiveMap(deps, tx, projectId, locale, read);
    const content = { ...live.content, destination_codes: live.destinationCodes, client_request_id: requestKey };
    await tx.query("SELECT precision_psm_new_version($1, $2, $3::jsonb)", [pa.instanceId, requestKey, JSON.stringify(content)]);

    await emitEvent(tx, { name: "add_service_completed", eventKey: `add_service_completed:${projectId}:${requestKey}`, projectId, locale, properties: { scenario: effective } });
    if (effective === "unmapped_known_category" || effective === "discovery") {
      await emitEvent(tx, { name: "possible_new_service_detected", eventKey: `possible_new_service_detected:${projectId}:${requestKey}`, projectId, locale, properties: { scenario: effective } });
      await emitEvent(tx, {
        name: "possible_new_service_category_proposed",
        eventKey: `possible_new_service_category_proposed:${projectId}:${requestKey}:${effective === "discovery" && created ? ref.categoryKey : "none"}`,
        projectId,
        locale,
        properties: { category_key: effective === "discovery" && created ? ref.categoryKey : "none" },
      });
    }
    return { kind: "applied", scenario: effective };
  });
}
