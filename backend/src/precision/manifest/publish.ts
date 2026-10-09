/**
 * Idempotent publish of the manifests that ship with the build into `project_manifest_version` and
 * `category_manifest_version` (migrations 0017–0026).
 *
 *  - What is published: the project manifest v2, the 7 authored category manifests, `_generic`, and one
 *    generic-backed row for every catalog category that has no authored manifest yet (same content as `_generic`, its
 *    own `category_key`, `crp_kind: "operational"`), so `category_assessment`'s composite FK always has a row to pin.
 *  - Version string = `${manifest_version_label}.${hash8}` (publish-hash.ts): same content -> same version. Re-running
 *    changes nothing. Changed content -> a new version that becomes current.
 *  - Writes go only through the sanctioned path: INSERT a DRAFT row, then `precision_*_manifest_publish(...)`. Published
 *    rows are never updated here (the guard triggers would refuse); an existing published version is left alone, and the
 *    current pointer is moved only for a newly created version, or when `forceCurrent` is set.
 *  - Everything runs in one transaction under an advisory lock, so concurrent boots cannot interleave.
 *  - Manifests are validated first (Gate D validator, zero errors required); nothing is written when validation fails.
 */
import type { Db } from "../../db/database";
import {
  AUTHORED_CATEGORY_KEYS,
  GENERIC_CATEGORY_KEY,
  bundledCatalog,
  bundledCategoryManifest,
  bundledProjectManifest,
  type CategoryManifestDoc,
  type ProjectManifestDoc,
} from "./bundled";
import { manifestContentHash, manifestVersionOf } from "./publish-hash";
import { CROSSWALK_SERVICE_ADDITIONS, errorsOf, validateManifest, validateProjectManifest, type Finding, type RegistryEntry } from "./validator";

export type PublishAction = "created" | "unchanged" | "made_current";
export interface PublishedItem {
  kind: "project" | "category";
  categoryKey: string | null;
  version: string;
  contentHash: string;
  action: PublishAction;
  isCurrent: boolean;
  /** True for rows generated from `_generic` for catalog categories without an authored manifest. */
  genericBacked: boolean;
}
export interface PublishResult { items: PublishedItem[]; created: number; unchanged: number; madeCurrent: number }

export interface PublishOptions {
  /** ADMIN user recorded as author and publisher. Default: the development bootstrap administrator. */
  actorAdminUserId?: string;
  /** Also repoint `is_current` for versions that already exist but are not current. Default false. */
  forceCurrent?: boolean;
  /** Add generic-backed rows for catalog categories without an authored manifest. Default true. */
  includeGenericBacked?: boolean;
  /** Called after a successful commit (e.g. `registry.invalidate`). */
  onPublished?: () => void;
}

export class ManifestValidationError extends Error {
  constructor(readonly findings: Finding[]) {
    super(`manifest validation failed: ${findings.slice(0, 5).map((f) => `${f.manifest}:${f.check} ${f.message}`).join("; ")}`);
    this.name = "ManifestValidationError";
  }
}

const LOCK_NAME = "precision_manifest_publish";

/** Catalog categories (project manifest) that have no authored category manifest. */
export function unauthoredCatalogCategories(pm: ProjectManifestDoc = bundledProjectManifest()): string[] {
  const authored = new Set<string>(AUTHORED_CATEGORY_KEYS);
  return pm.candidate_categories.filter((c) => c.kind === "catalog" && !authored.has(c.category_key)).map((c) => c.category_key);
}

/** `_generic` content re-keyed for a known category that has no authored manifest yet. */
export function genericBackedManifest(categoryKey: string): CategoryManifestDoc {
  const base = bundledCategoryManifest(GENERIC_CATEGORY_KEY);
  if (!base) throw new Error("the _generic manifest is not bundled");
  const doc = JSON.parse(JSON.stringify(base)) as CategoryManifestDoc;
  doc.category_key = categoryKey;
  doc.crp_kind = "operational";
  doc.manifest_status = "GENERIC_BACKED";
  doc.generic_backed = true;
  doc.backed_by = GENERIC_CATEGORY_KEY;
  return doc;
}

/** Validates the shipped manifests exactly as Gate D does. Returns every finding (errors and warnings). */
export function validateBundled(): Finding[] {
  const catalog = bundledCatalog();
  const additions = [...CROSSWALK_SERVICE_ADDITIONS];
  const registry = new Map<string, RegistryEntry>();
  const findings: Finding[] = [];
  const manifests = new Map<string, CategoryManifestDoc>();
  for (const key of [...AUTHORED_CATEGORY_KEYS, GENERIC_CATEGORY_KEY]) {
    const m = bundledCategoryManifest(key);
    if (!m) throw new Error(`manifest ${key} is not bundled`);
    manifests.set(key, m);
    findings.push(...validateManifest(m, { registry, catalog, additions }));
  }
  const pm = bundledProjectManifest();
  const fronts = ((pm.fa4_front_signals as Array<{ front: string }> | undefined) ?? []).map((x) => x.front);
  findings.push(...validateProjectManifest(pm, { catalogCategories: Object.keys(catalog), manifests, fronts }));
  return findings;
}

interface DocToPublish { kind: "project" | "category"; categoryKey: string | null; doc: ProjectManifestDoc | CategoryManifestDoc; genericBacked: boolean }

export function manifestsToPublish(includeGenericBacked = true): DocToPublish[] {
  const out: DocToPublish[] = [{ kind: "project", categoryKey: null, doc: bundledProjectManifest(), genericBacked: false }];
  for (const key of [...AUTHORED_CATEGORY_KEYS, GENERIC_CATEGORY_KEY]) {
    const doc = bundledCategoryManifest(key);
    if (!doc) throw new Error(`manifest ${key} is not bundled`);
    out.push({ kind: "category", categoryKey: key, doc, genericBacked: false });
  }
  if (includeGenericBacked) for (const key of unauthoredCatalogCategories()) out.push({ kind: "category", categoryKey: key, doc: genericBackedManifest(key), genericBacked: true });
  return out;
}

interface ExistingRow { status: string; is_current: boolean }

async function publishOne(tx: Db, item: DocToPublish, actor: string, forceCurrent: boolean): Promise<PublishedItem> {
  const version = manifestVersionOf(item.doc);
  const contentHash = manifestContentHash(item.doc);
  const base = { kind: item.kind, categoryKey: item.categoryKey, version, contentHash, genericBacked: item.genericBacked };
  const content = JSON.stringify(item.doc);

  const lookup =
    item.kind === "project"
      ? await tx.query<ExistingRow>("SELECT status, is_current FROM project_manifest_version WHERE version = $1", [version])
      : await tx.query<ExistingRow>("SELECT status, is_current FROM category_manifest_version WHERE category_key = $1 AND version = $2", [item.categoryKey, version]);
  const existing = lookup.rows[0];

  const publish = (): Promise<unknown> =>
    item.kind === "project"
      ? tx.query("SELECT precision_project_manifest_publish($1, $2::uuid)", [version, actor])
      : tx.query("SELECT precision_category_manifest_publish($1, $2, $3::uuid)", [item.categoryKey, version, actor]);

  if (!existing) {
    if (item.kind === "project") {
      await tx.query("INSERT INTO project_manifest_version (version, content, content_hash, created_by_admin_user_id) VALUES ($1, $2::jsonb, $3, $4::uuid)", [version, content, contentHash, actor]);
    } else {
      await tx.query("INSERT INTO category_manifest_version (category_key, version, content, content_hash, created_by_admin_user_id) VALUES ($1, $2, $3::jsonb, $4, $5::uuid)", [item.categoryKey, version, content, contentHash, actor]);
    }
    await publish();
    return { ...base, action: "created", isCurrent: true };
  }
  if (existing.status !== "PUBLISHED") {
    await publish();
    return { ...base, action: "created", isCurrent: true };
  }
  if (!existing.is_current && forceCurrent) {
    await publish();
    return { ...base, action: "made_current", isCurrent: true };
  }
  return { ...base, action: "unchanged", isCurrent: existing.is_current };
}

/** Publishes the bundled manifests. Safe to run on every boot / deploy. */
export async function publishBundledManifests(db: Db, options: PublishOptions = {}): Promise<PublishResult> {
  const findings = validateBundled();
  const errors = errorsOf(findings);
  if (errors.length > 0) throw new ManifestValidationError(errors);

  const docs = manifestsToPublish(options.includeGenericBacked !== false);
  const items = await db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_NAME]);
    // loaded lazily: the bootstrap helper pulls in the FA content bundles, which the pure engine never needs
    const actor = options.actorAdminUserId ?? (await (await import("../../fa/admin/publish-config")).ensureDevBootstrapAdmin(tx));
    const out: PublishedItem[] = [];
    for (const d of docs) out.push(await publishOne(tx, d, actor, options.forceCurrent === true));
    return out;
  });
  options.onPublished?.();
  return {
    items,
    created: items.filter((i) => i.action === "created").length,
    unchanged: items.filter((i) => i.action === "unchanged").length,
    madeCurrent: items.filter((i) => i.action === "made_current").length,
  };
}
