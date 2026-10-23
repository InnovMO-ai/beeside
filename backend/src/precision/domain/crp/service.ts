/**
 * CRP lifecycle services (Track A contract §2/§3, Build Readiness A-9/A-10).
 *
 *   getCrpView        draft (in progress) / ready_for_review / confirmed (read-only) view of a category's CRP
 *   requestChanges    before Confirm: the category stays in progress, an assistant notice is written (free of versioning)
 *   confirmCrp        ready required; ONE transaction: immutable pack + dated client confirmation + lifecycle -> completed.
 *                     Idempotent. Never sends anything.
 *   newVersion        client-initiated after Confirm: completed -> in progress. The confirmed pack stays current until a
 *                     new pack is confirmed.
 *
 * Concurrency: every mutation takes a per-category advisory lock inside its transaction, then re-reads the category, so
 * a double click or two racing requests produce exactly one effect (the second finds the new state and returns it).
 */
import { FaError } from "../../../fa/services/errors";
import type { Db } from "../../../db/database";
import type { CrpViewDto, Locale } from "../../api/dto";
import { completeCategoryAssessment, moveCategoryLifecycle } from "../../repository";
import { buildCrpContent, type CrpV1Content } from "../../manifest/crp-content";
import { evaluateCategoryDetailed, type DetailedEvaluation } from "../../manifest/readiness";
import type { PrecisionDomainDeps } from "../deps";
import { emitEvent } from "../events";
import { toCrpView, toStructured, type StructuredCrp } from "./content";
import {
  crpDeliveryKey,
  ledgerView,
  loadContextVersions,
  loadCurrentPack,
  loadFactMap,
  loadProjectFacts,
  lockCategory,
  resolveCategory,
  type CategoryRow,
  type PackRow,
  type ProjectFacts,
} from "./data";
import { CrpError } from "./errors";
import { NOTICE_REQUEST_CHANGES } from "./copy";

export interface CrpActor {
  projectId: string;
  locale: Locale;
  /** FULL access. Reads never need it; every mutation does (the router enforces it first). */
  canWrite: boolean;
}

import { formatDate } from "../../manifest/value-render";

type CrpDeps = Pick<PrecisionDomainDeps, "db" | "registry" | "log">;

const OF = { en: ["Objective", "Product or service", "Time window"], es: ["Objetivo", "Producto o servicio", "Horizonte de tiempo"] } as const;

function contextLines(p: ProjectFacts, locale: Locale): string[] {
  const [obj, prod, win] = OF[locale];
  const lines: string[] = [];
  if (p.objective) lines.push(`${obj}: ${p.objective}`);
  if (p.productOrService) lines.push(`${prod}: ${p.productOrService}`);
  if (p.timeWindow) lines.push(`${win}: ${formatDate(p.timeWindow, locale)}`);
  return lines;
}

export interface Draft {
  content: CrpV1Content;
  evaluation: DetailedEvaluation;
  factIds: string[];
  project: ProjectFacts;
  pinId: string | null;
}

/** Builds the live CRP of a category from its current facts (pure over the database state at call time). */
export async function buildDraft(deps: CrpDeps, db: Db, category: CategoryRow, locale: Locale): Promise<Draft> {
  const loaded = await deps.registry.getManifestForCategory(category.categoryKey, category.manifestVersion);
  // Sequential on purpose: `db` may be a transaction on ONE connection.
  const { facts, factIds } = await loadFactMap(db, category.instanceId);
  const project = await loadProjectFacts(db, category.projectId);
  const versions = await loadContextVersions(db, category.projectId);
  const evaluation = evaluateCategoryDetailed({ manifest: loaded.manifest, facts, countries: project.countries });
  const content = buildCrpContent(
    {
      categoryKey: category.categoryKey,
      manifest: loaded.manifest,
      facts,
      countries: project.countries,
      locale,
      contextLines: contextLines(project, locale),
      versions: { manifest: loaded.version, catalog: versions.catalog, crosswalk: versions.crosswalk, contract: versions.contract },
    },
    evaluation,
  );
  return { content, evaluation, factIds, project, pinId: versions.pinId };
}

function isCrpContent(c: unknown): c is CrpV1Content {
  const o = c as Partial<CrpV1Content> | null;
  return !!o && typeof o === "object" && o.schema === "crp.v1" && Array.isArray(o.sections) && Array.isArray(o.pending);
}

/** The stored (immutable) content of a pack, validated. A malformed pack is a server fault, not a client error. */
export function packContent(pack: PackRow): CrpV1Content {
  if (!isCrpContent(pack.content)) throw new Error("pack content is not crp.v1");
  return pack.content;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function confirmedView(category: CategoryRow, pack: PackRow, actor: CrpActor, structured: StructuredCrp): CrpViewDto {
  return toCrpView(structured, {
    categoryId: category.instanceId,
    state: "confirmed",
    confirmedAt: iso(pack.confirmedAt),
    canConfirm: false,
    canRequestChanges: false,
    canStartNewVersion: actor.canWrite,
  });
}

function draftView(category: CategoryRow, draft: Draft, actor: CrpActor): CrpViewDto {
  const ready = draft.evaluation.evaluation.ready;
  const active = category.lifecycle === "in_progress";
  return toCrpView(toStructured(draft.content), {
    categoryId: category.instanceId,
    state: ready && active ? "ready_for_review" : "draft",
    confirmedAt: null,
    canConfirm: actor.canWrite && active && ready,
    canRequestChanges: actor.canWrite && active,
    canStartNewVersion: false,
  });
}

/** The CRP view for the category: the confirmed pack when completed, otherwise the live draft. */
export async function getCrpView(deps: CrpDeps, actor: CrpActor, categoryId: string): Promise<CrpViewDto> {
  const category = await resolveCategory(deps.db, actor.projectId, categoryId);
  return viewOf(deps, deps.db, actor, category);
}

async function viewOf(deps: CrpDeps, db: Db, actor: CrpActor, category: CategoryRow): Promise<CrpViewDto> {
  if (category.lifecycle === "completed") {
    const pack = await loadCurrentPack(db, category);
    if (pack?.confirmedAt) return confirmedView(category, pack, actor, toStructured(packContent(pack)));
    if (pack) {
      // A pack that was completed without a recorded client confirmation: shown for review, confirmable.
      const s = toStructured(packContent(pack));
      return toCrpView(s, { categoryId: category.instanceId, state: "ready_for_review", confirmedAt: null, canConfirm: actor.canWrite, canRequestChanges: false, canStartNewVersion: false });
    }
  }
  return draftView(category, await buildDraft(deps, db, category, actor.locale), actor);
}

const turnKey = (instanceId: string, revision: number): string => `crp-changes:${instanceId}:${revision}`;

async function factRevision(db: Db, instanceId: string): Promise<number> {
  const { rows } = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM fact WHERE scope_instance_id = $1", [instanceId]);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Before Confirm the category is already in progress (draft and "ready for review" are derived), so this writes no
 * lifecycle change: it records an assistant-visible notice in the category conversation and an analytics event, once
 * per state of the category's facts (repeating the click without changing anything adds nothing).
 */
export async function requestChanges(deps: CrpDeps, actor: CrpActor, categoryId: string): Promise<CrpViewDto> {
  const first = await resolveCategory(deps.db, actor.projectId, categoryId);
  const db = deps.db;
  await db.transaction(async (tx) => {
    await lockCategory(tx, first.instanceId);
    const category = await resolveCategory(tx, actor.projectId, categoryId);
    if (category.lifecycle !== "in_progress") throw new CrpError("CONFLICT");
    const revision = await factRevision(tx, category.instanceId);
    await tx.query(
      `INSERT INTO precision_turn (project_id, scope_instance_id, turn_key, role, surface, kind, locale, content)
       VALUES ($1, $2, $3, 'assistant', 'category', 'notice', $4, $5)
       ON CONFLICT (project_id, turn_key, role) DO NOTHING`,
      [category.projectId, category.instanceId, turnKey(category.instanceId, revision), actor.locale, NOTICE_REQUEST_CHANGES[actor.locale]],
    );
    await emitEvent(tx, {
      name: "crp_change_requested",
      eventKey: `crp_change_requested:${category.instanceId}:${revision}`,
      projectId: category.projectId,
      properties: { category_key: category.categoryKey },
      locale: actor.locale,
    });
  });
  const category = await resolveCategory(db, actor.projectId, categoryId);
  return viewOf(deps, db, actor, category);
}

export interface ConfirmResult { view: CrpViewDto; /** False when this call found the CRP already confirmed (nothing was written). */ created: boolean }

/** Confirms the CRP. Requires `evaluation.ready`. Does NOT send. */
export async function confirmCrp(deps: CrpDeps, actor: CrpActor, categoryId: string): Promise<ConfirmResult> {
  const first = await resolveCategory(deps.db, actor.projectId, categoryId);
  let created = false;
  try {
    await deps.db.transaction(async (tx) => {
      await lockCategory(tx, first.instanceId);
      const category = await resolveCategory(tx, actor.projectId, categoryId);

      if (category.lifecycle === "completed") {
        // Repeated click / racing request: already confirmed -> no-op. A completed pack that lacks its confirmation is repaired.
        const pack = await loadCurrentPack(tx, category);
        if (pack && !pack.confirmedAt) {
          await tx.query("INSERT INTO crp_confirmation (pack_id, project_id) VALUES ($1, $2) ON CONFLICT (pack_id) DO NOTHING", [pack.id, category.projectId]);
          await emitConfirmed(tx, category, pack.id, pack.version, actor.locale);
          created = true;
        }
        return;
      }
      if (category.lifecycle === "confirmed") throw new CrpError("NOT_READY", { detail: "info" }); // selected, nothing answered yet
      if (category.lifecycle !== "in_progress") throw new CrpError("CONFLICT");

      const draft = await buildDraft(deps, tx, category, actor.locale);
      if (!draft.evaluation.evaluation.ready) throw new CrpError("NOT_READY", { detail: "info" });

      const snapshot = {
        category_manifest_version: category.manifestVersion,
        destination_countries: draft.project.countries,
        fact_ids: draft.factIds,
        project_fact_ids: draft.project.factIds,
        context_pin_id: draft.pinId,
        locale: actor.locale,
      };
      const packId = await completeCategoryAssessment(tx, category.instanceId, draft.content, snapshot);
      await tx.query("INSERT INTO crp_confirmation (pack_id, project_id) VALUES ($1, $2)", [packId, category.projectId]);
      const version = (await tx.query<{ version: number }>("SELECT version FROM pack WHERE id = $1", [packId])).rows[0]!.version;
      await emitConfirmed(tx, category, packId, version, actor.locale);
      created = true;
    });
  } catch (e) {
    if (e instanceof FaError) throw new CrpError("CONFLICT", { cause: e });
    throw e;
  }
  const category = await resolveCategory(deps.db, actor.projectId, categoryId);
  return { view: await viewOf(deps, deps.db, actor, category), created };
}

async function emitConfirmed(tx: Db, category: CategoryRow, packId: string, version: number, locale: Locale): Promise<void> {
  await emitEvent(tx, {
    name: "crp_confirmed",
    eventKey: `crp_confirmed:${packId}`,
    projectId: category.projectId,
    properties: { category_key: category.categoryKey, crp_version: version },
    locale,
  });
}

/** Client-initiated change of a confirmed CRP: back to in progress; the confirmed pack stays current until a new one is confirmed. */
export async function newVersion(deps: CrpDeps, actor: CrpActor, categoryId: string): Promise<CrpViewDto> {
  const first = await resolveCategory(deps.db, actor.projectId, categoryId);
  await deps.db.transaction(async (tx) => {
    await lockCategory(tx, first.instanceId);
    const category = await resolveCategory(tx, actor.projectId, categoryId);
    if (category.lifecycle === "in_progress") {
      // Duplicate click: already in progress. Only meaningful when a confirmed pack exists to version.
      if (!category.currentPackId) throw new CrpError("CONFLICT");
      return;
    }
    if (category.lifecycle !== "completed") throw new CrpError("CONFLICT");
    const pack = await loadCurrentPack(tx, category);
    if (!pack?.confirmedAt) throw new CrpError("CONFLICT");

    // A first send that failed must be completed first: a new pack would get a new delivery key, and the activation
    // gate only lets the project's first attempted key through.
    const ledger = await ledgerView(tx, category.projectId, crpDeliveryKey(category.projectId, pack.id, pack.version));
    if (!ledger.firstSendDone && ledger.attempted) throw new CrpError("ACTIVATION_PENDING_RETRY_FIRST");

    await moveCategoryLifecycle(tx, category.instanceId, "in_progress");
    await emitEvent(tx, {
      name: "crp_change_requested",
      eventKey: `crp_change_requested:${pack.id}`,
      projectId: category.projectId,
      properties: { category_key: category.categoryKey },
      locale: actor.locale,
    });
  });
  const category = await resolveCategory(deps.db, actor.projectId, categoryId);
  return viewOf(deps, deps.db, actor, category);
}
