/**
 * Demo seed: a curated, completely synthetic project ("Northwind Foods Ltd") with the same rows a real activation produces.
 *
 *  - Core rows: company, person (synthetic address on a reserved TLD), project. The First Assessment configuration the
 *    project row pins is bootstrapped only when the database has none (development databases; refused otherwise).
 *  - Precision rows: the bundled manifests (`publishBundledManifests`, idempotent) and, optionally, a fast-forward
 *    (`stage`) that leaves the project at a rehearsal checkpoint by writing the same facts/lifecycle moves a conversation
 *    would. The default stage `start` writes nothing else: the presenter walks the route from the Cover.
 *  - Fixture data for the fixture First Assessment reader / entitlement provider is exported (`demoFixtureEntries`,
 *    `loadDemoFixtures`) because those providers answer from configuration, not from the database.
 *  - A one-time link token is minted through `createLinkToken` (its raw value is returned once and never logged).
 *
 * Idempotent: running it again finds the project by its company marker and changes nothing (a stage is only ever
 * advanced, never repeated). `reset` creates a NEW Northwind project (append-only tables cannot be emptied); the previous
 * one stays in the database but is no longer the demo project.
 * DATA ONLY: no product code reads anything from here, and no `demo` branch exists anywhere in product code.
 */
import type { Db } from "../../../db/database";
import { syncFieldRegistry } from "../../../fa/admin/field-registry";
import { ensureDevBootstrapAdmin, publishDevConfiguration } from "../../../fa/admin/publish-config";
import type { EntitlementState } from "../../ports/entitlement";
import type { FaContextReader } from "../../ports/fa-context";
import { buildServiceMapContent } from "../../manifest/service-map-content";
import { publishBundledManifests } from "../../manifest/publish";
import {
  confirmPrecisionAssessment,
  createPrecisionAssessment,
  getOrCreateCategoryAssessment,
  moveCategoryLifecycle,
  movePaLifecycle,
  recordFact,
} from "../../repository";
import { createLinkToken, DEFAULT_LINK_TTL_MS } from "../tokens";
import { appendMapNeeds, type MapNeed } from "../categories";
import {
  DEMO_COMPANY_NAME,
  DEMO_COMPANY_WEBSITE,
  DEMO_ENTITLEMENT,
  DEMO_FA_CONTEXT,
  DEMO_FA_RESULT_ID,
  DEMO_LOGISTICS_FACTS,
  DEMO_MAP_CATEGORIES,
  DEMO_PERSON_EMAIL,
  DEMO_UNDERSTANDING_FACTS,
  type DemoFact,
} from "./demo-data";

export type DemoStage = "start" | "map_confirmed" | "logistics_ready";
const STAGES: readonly DemoStage[] = ["start", "map_confirmed", "logistics_ready"];

export interface DemoSeedOptions {
  /** Create a fresh Northwind project instead of reusing the existing one. */
  reset?: boolean;
  /** Rehearsal checkpoint to leave the project at. Default `start`. Never moves a project backwards. */
  stage?: DemoStage;
  /** Mint a link token (default true) with this lifetime. */
  mintLink?: boolean;
  linkTtlMs?: number;
  /** Allow bootstrapping the First Assessment configuration when none is published (development databases only). */
  bootstrapFaConfig?: boolean;
  now?: Date;
}

export interface DemoSeedResult {
  projectId: string;
  companyId: string;
  created: boolean;
  stage: DemoStage;
  categories: Array<{ categoryKey: string; categoryId: string }>;
  /** One-time access code (shown once). Null when not minted. */
  linkToken: string | null;
  linkExpiresAt: string | null;
}

const rank = (s: DemoStage): number => STAGES.indexOf(s);

async function hasCurrent(db: Db, table: string): Promise<boolean> {
  return (await db.query(`SELECT 1 FROM ${table} WHERE is_current`)).rows.length > 0;
}

/** The three First Assessment registries the project row pins must have a current version. */
async function ensureFaConfiguration(db: Db, allowBootstrap: boolean): Promise<void> {
  const ok = (await hasCurrent(db, "question_bank_version")) && (await hasCurrent(db, "rules_engine_version")) && (await hasCurrent(db, "snapshot_template_version"));
  if (ok) return;
  if (!allowBootstrap) throw new Error("The First Assessment configuration is not published in this database. Run with CONFIG_BOOTSTRAP_ENV=development to bootstrap it (development databases only).");
  await db.transaction(async (tx) => {
    await syncFieldRegistry(tx);
    const admin = await ensureDevBootstrapAdmin(tx);
    await publishDevConfiguration(tx, admin);
  });
}

async function findDemoProject(db: Db): Promise<{ projectId: string; companyId: string } | null> {
  const { rows } = await db.query<{ project_id: string; company_id: string }>(
    `SELECT p.project_id, p.company_id FROM project p JOIN company c ON c.company_id = p.company_id
      WHERE c.name = $1 AND c.website = $2 ORDER BY p.created_at DESC, p.project_id LIMIT 1`,
    [DEMO_COMPANY_NAME, DEMO_COMPANY_WEBSITE],
  );
  return rows[0] ? { projectId: rows[0].project_id, companyId: rows[0].company_id } : null;
}

async function createDemoProject(db: Db): Promise<{ projectId: string; companyId: string }> {
  return db.transaction(async (tx) => {
    const company = (await tx.query<{ id: string }>(
      "INSERT INTO company (name, website, normalized_domain, normalized_name) VALUES ($1, $2, 'northwind-foods.example', 'northwind foods') RETURNING company_id AS id",
      [DEMO_COMPANY_NAME, DEMO_COMPANY_WEBSITE],
    )).rows[0]!.id;
    const person = (await tx.query<{ id: string }>(
      `INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
       VALUES ('Demo', 'Contact', $1, 'en', 'en', 'en') RETURNING person_id AS id`,
      [`${Date.now().toString(36)}.${DEMO_PERSON_EMAIL}`],
    )).rows[0]!.id;
    const project = (await tx.query<{ id: string }>(
      "INSERT INTO project (company_id, created_by_person_id, responsible_person_id) VALUES ($1, $2, $2) RETURNING project_id AS id",
      [company, person],
    )).rows[0]!.id;
    return { projectId: project, companyId: company };
  });
}

async function paInstance(db: Db, projectId: string): Promise<string> {
  const existing = (await db.query<{ id: string }>("SELECT id FROM precision_instance WHERE project_id = $1 AND scope = 'project'", [projectId])).rows[0];
  if (existing) return existing.id;
  return (await createPrecisionAssessment(db, projectId)).instanceId;
}

async function confirmMap(db: Db, projectId: string): Promise<void> {
  const pa = await paInstance(db, projectId);
  const state = (await db.query<{ lifecycle_status: string }>("SELECT lifecycle_status FROM precision_assessment WHERE instance_id = $1", [pa])).rows[0]!.lifecycle_status;
  if (state === "confirmed") return;
  for (const f of DEMO_UNDERSTANDING_FACTS) {
    await recordFact(db, { projectId, scopeInstanceId: pa, fieldKey: `precision.${f.fieldKey}`, value: f.value, valueType: f.valueType, answerState: "ANSWERED", source: "precision_assessment", provenanceStage: "client_answered" });
  }
  if (state === "not_started") await movePaLifecycle(db, pa, "in_progress");
  await movePaLifecycle(db, pa, "ready_for_confirmation");
  const content = buildServiceMapContent({
    project: {
      objective: String(DEMO_UNDERSTANDING_FACTS[0]!.value),
      destinations: ["MX"],
      timeWindow: "2027-04",
      productOrService: String(DEMO_UNDERSTANDING_FACTS[2]!.value),
      operatingEntity: String(DEMO_UNDERSTANDING_FACTS[3]!.value),
    },
    categories: DEMO_MAP_CATEGORIES.map((c) => ({ categoryKey: c.categoryKey, needs: c.needs.map((n) => ({ ...n, state: "pending" as const })) })),
    locale: "en",
  });
  // The same keys a live confirmation stores, so the live view of this project equals its snapshot (no "changes to review").
  await confirmPrecisionAssessment(db, pa, { ...content, destination_codes: ["MX"] } as typeof content);
}

async function ensureCategories(db: Db, projectId: string): Promise<Array<{ categoryKey: string; categoryId: string }>> {
  const out: Array<{ categoryKey: string; categoryId: string }> = [];
  for (const c of DEMO_MAP_CATEGORIES) {
    const r = await getOrCreateCategoryAssessment(db, projectId, c.categoryKey, "pa_detected");
    const st = (await db.query<{ lifecycle_status: string }>("SELECT lifecycle_status FROM category_assessment WHERE instance_id = $1", [r.instanceId])).rows[0]!.lifecycle_status;
    if (st === "proposed") await moveCategoryLifecycle(db, r.instanceId, "confirmed");
    // The needs that put the category on My Service Map, as the First Assessment proposal records them (ids match the snapshot items).
    await appendMapNeeds(db, projectId, r.instanceId, c.needs.map((n): MapNeed => ({ id: n.id, label: n.label, priority: n.priority, source: "fa" })));
    out.push({ categoryKey: c.categoryKey, categoryId: r.instanceId });
  }
  return out;
}

/** Moves a category to in progress and records the given answers (existing current facts are left alone). Used by the seed and by tests. */
export async function fillCategory(db: Db, projectId: string, categoryId: string, facts: readonly DemoFact[]): Promise<void> {
  const st = (await db.query<{ lifecycle_status: string }>("SELECT lifecycle_status FROM category_assessment WHERE instance_id = $1", [categoryId])).rows[0]!.lifecycle_status;
  if (st === "confirmed") await moveCategoryLifecycle(db, categoryId, "in_progress");
  const have = new Set((await db.query<{ field_key: string }>("SELECT field_key FROM fact WHERE scope_instance_id = $1 AND superseded_by IS NULL", [categoryId])).rows.map((r) => r.field_key));
  for (const f of facts) {
    if (have.has(`precision.${f.fieldKey}`)) continue;
    await recordFact(db, { projectId, scopeInstanceId: categoryId, fieldKey: `precision.${f.fieldKey}`, value: f.value, valueType: f.valueType, answerState: f.answerState, source: "category", provenanceStage: "client_answered" });
  }
}

/** Seeds (or finds) the Northwind project. See the file header for the guarantees. */
export async function seedDemoProject(db: Db, options: DemoSeedOptions = {}): Promise<DemoSeedResult> {
  const stage = options.stage ?? "start";
  const now = options.now ?? new Date();
  await ensureFaConfiguration(db, options.bootstrapFaConfig === true);
  // The route is written against the bundled manifests: make them the current ones (a no-op when they already are).
  await publishBundledManifests(db, { forceCurrent: true });

  // One seeder at a time for the WHOLE run: two concurrent runs must neither create two projects nor race on the same lifecycle.
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["precision_demo_seed"]);
    const found = options.reset ? null : await findDemoProject(tx);
    const created = !found;
    const proj = found ?? (await createDemoProject(tx));

    let categories: DemoSeedResult["categories"] = [];
    if (rank(stage) >= rank("map_confirmed")) {
      await confirmMap(tx, proj.projectId);
      categories = await ensureCategories(tx, proj.projectId);
    }
    if (rank(stage) >= rank("logistics_ready")) {
      const logistics = categories.find((c) => c.categoryKey === "logistics");
      if (logistics) await fillCategory(tx, proj.projectId, logistics.categoryId, DEMO_LOGISTICS_FACTS);
    }
    // Existing categories (a previous run advanced further) are reported even when this run asked for less.
    if (categories.length === 0) {
      categories = (await tx.query<{ category_key: string; instance_id: string }>(
        "SELECT category_key, instance_id FROM category_assessment WHERE project_id = $1 AND lifecycle_status <> 'not_selected' ORDER BY created_at, instance_id",
        [proj.projectId],
      )).rows.map((r) => ({ categoryKey: r.category_key, categoryId: r.instance_id }));
    }

    let linkToken: string | null = null;
    let linkExpiresAt: string | null = null;
    if (options.mintLink !== false) {
      const t = await createLinkToken(tx, proj.projectId, options.linkTtlMs ?? DEFAULT_LINK_TTL_MS, now);
      linkToken = t.token;
      linkExpiresAt = t.expiresAt.toISOString();
    }
    return { projectId: proj.projectId, companyId: proj.companyId, created, stage, categories, linkToken, linkExpiresAt };
  });
}

// ---------------------------------------------------------------------------------------------- fixture providers (configuration)

export interface DemoFixtureEntries {
  faContext: { projectId: string; resultId: string; context: typeof DEMO_FA_CONTEXT };
  entitlement: EntitlementState;
}

/** The configuration entries for the fixture providers of one demo project. Pure data. */
export function demoFixtureEntries(projectId: string): DemoFixtureEntries {
  return {
    faContext: { projectId, resultId: DEMO_FA_RESULT_ID, context: DEMO_FA_CONTEXT },
    entitlement: { projectId, premiumActive: DEMO_ENTITLEMENT.premiumActive, accessMode: DEMO_ENTITLEMENT.accessMode },
  };
}

/** Anything exposing the fixture providers' configuration methods (the real Core-backed providers expose neither). */
export interface FixtureTargets {
  faContext?: FaContextReader & { add?: (e: DemoFixtureEntries["faContext"]) => void; setFallback?: (r: (projectId: string) => Promise<DemoFixtureEntries["faContext"] | null>) => void };
  entitlement?: { set?: (s: EntitlementState) => void; setFallback?: (r: (projectId: string) => Promise<EntitlementState | null>) => void };
}

/** Registers the demo project (found in the database by its company marker) with the fixture providers. Returns its id, or null when none is seeded. */
export async function loadDemoFixtures(db: Db, targets: FixtureTargets): Promise<string | null> {
  // Projects seeded after this process started (a re-seed) are resolved from the database by the same company marker,
  // so the app never needs a restart to serve a fresh synthetic project.
  const isSeededDemoProject = async (projectId: string): Promise<boolean> =>
    (await db.query(
      "SELECT 1 FROM project p JOIN company c ON c.company_id = p.company_id WHERE p.project_id = $1 AND c.name = $2 AND c.website = $3",
      [projectId, DEMO_COMPANY_NAME, DEMO_COMPANY_WEBSITE],
    )).rows.length > 0;
  targets.faContext?.setFallback?.(async (projectId) => ((await isSeededDemoProject(projectId)) ? demoFixtureEntries(projectId).faContext : null));
  targets.entitlement?.setFallback?.(async (projectId) => ((await isSeededDemoProject(projectId)) ? demoFixtureEntries(projectId).entitlement : null));
  const proj = await findDemoProject(db);
  if (!proj) return null;
  const e = demoFixtureEntries(proj.projectId);
  targets.faContext?.add?.(e.faContext);
  targets.entitlement?.set?.(e.entitlement);
  return proj.projectId;
}
