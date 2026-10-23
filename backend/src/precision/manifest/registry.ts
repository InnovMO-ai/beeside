/**
 * Manifest registry — DB-backed loader with an in-memory cache.
 *
 *  - The database (`project_manifest_version`, `category_manifest_version`) is the runtime source of truth. Published
 *    rows are immutable, so a row loaded by (category, version) is cached for the life of the process.
 *  - The "current" pointer can move (a publish repoints it), so it is cached for a short TTL (default 30 s) and
 *    `invalidate()` drops it at once (publish calls it; so can tests).
 *  - `getManifestForCategory(categoryKey)` is the one call the domain makes: a `new:<slug>` instance or a category
 *    without its own published manifest resolves to `_generic`. The result names the manifest key and version that
 *    must be pinned on the category assessment (`category_assessment.manifest_category_key` / `manifest_version`).
 *  - Optional bundled fallback (off by default): serves the manifests that ship with the build when the database has
 *    no published row yet. Versions are the same deterministic strings `publish.ts` writes, so they stay pinnable.
 *
 * Never throws for "not found" on the nullable getters; `getManifestForCategory` throws only when even `_generic` is
 * unavailable (a deployment error, surfaced loudly rather than papered over).
 */
import type { Db } from "../../db/database";
import { bundledCategoryManifest, bundledProjectManifest, type CategoryManifestDoc, type ProjectManifestDoc } from "./bundled";
import { isNewCategoryKey } from "./categories";
import { manifestContentHash, manifestVersionOf } from "./publish-hash";

export const GENERIC_KEY = "_generic";
const DEFAULT_CURRENT_TTL_MS = 30_000;

export interface LoadedCategoryManifest {
  /** The key asked for (an instance key such as `new:public_procurement` or a catalog category). */
  requestedKey: string;
  /** The key of the manifest actually used (`_generic` for new categories and categories without their own). */
  manifestCategoryKey: string;
  /** Pinned version string (stored on the assessment, never shown to the client). */
  version: string;
  contentHash: string | null;
  isCurrent: boolean;
  source: "database" | "bundled";
  manifest: CategoryManifestDoc;
}
export interface LoadedProjectManifest {
  version: string;
  contentHash: string | null;
  isCurrent: boolean;
  source: "database" | "bundled";
  manifest: ProjectManifestDoc;
}

export interface ManifestRegistryOptions {
  currentTtlMs?: number;
  /** Serve bundled manifests when the database has no published row. Default false. */
  allowBundledFallback?: boolean;
  now?: () => number;
}

export interface ManifestRegistry {
  getProjectManifest(version?: string): Promise<LoadedProjectManifest | null>;
  /** Exact manifest for a category key (and, optionally, a pinned version). Null when none is published. */
  getCategoryManifest(categoryKey: string, version?: string): Promise<LoadedCategoryManifest | null>;
  /**
   * Manifest to use for an instance key. With a pinned `version` (a resumed category assessment) the pinned row is
   * returned as stored; otherwise the current one. `new:*` and categories without their own manifest use `_generic`.
   */
  getManifestForCategory(categoryKey: string, version?: string): Promise<LoadedCategoryManifest>;
  /** Drops cached "current" pointers (immutable versions stay cached). */
  invalidate(): void;
}

/** `new:<slug>` instances are always backed by `_generic`; every other key is its own manifest key. */
export function resolveManifestCategoryKey(categoryKey: string): string {
  return isNewCategoryKey(categoryKey) ? GENERIC_KEY : categoryKey;
}

function assertManifestShape(content: unknown, where: string): asserts content is CategoryManifestDoc {
  const c = content as Partial<CategoryManifestDoc> | null;
  if (!c || typeof c !== "object" || !Array.isArray(c.fields) || !Array.isArray(c.critical_decisions) || !c.country_overlays || typeof c.country_overlays !== "object") {
    throw new Error(`manifest ${where} is malformed (fields / critical_decisions / country_overlays)`);
  }
  if (!Array.isArray(c.operational_pending_items)) (c as { operational_pending_items: unknown[] }).operational_pending_items = [];
  if (!Array.isArray(c.visibility_rules)) (c as { visibility_rules: unknown[] }).visibility_rules = [];
}

interface Row { version: string; content: unknown; content_hash: string | null; is_current: boolean }

export function createManifestRegistry(db: Pick<Db, "query">, options: ManifestRegistryOptions = {}): ManifestRegistry {
  const ttl = options.currentTtlMs ?? DEFAULT_CURRENT_TTL_MS;
  const now = options.now ?? Date.now;
  const fallback = options.allowBundledFallback === true;

  const pinned = new Map<string, Promise<LoadedCategoryManifest | null>>();
  const pinnedProject = new Map<string, Promise<LoadedProjectManifest | null>>();
  const currentCat = new Map<string, { at: number; value: Promise<LoadedCategoryManifest | null> }>();
  let currentProject: { at: number; value: Promise<LoadedProjectManifest | null> } | null = null;

  const fresh = (at: number): boolean => ttl > 0 && now() - at < ttl;
  const evictOnFailure = <T>(p: Promise<T>, drop: () => void): Promise<T> => {
    p.catch(drop);
    return p;
  };

  function bundledCategory(key: string, version?: string): LoadedCategoryManifest | null {
    const doc = bundledCategoryManifest(key);
    if (!doc) return null;
    const v = manifestVersionOf(doc);
    if (version && version !== v) return null;
    return { requestedKey: key, manifestCategoryKey: key, version: v, contentHash: manifestContentHash(doc), isCurrent: true, source: "bundled", manifest: doc };
  }

  async function loadCategory(key: string, version?: string): Promise<LoadedCategoryManifest | null> {
    const { rows } = version
      ? await db.query<Row>("SELECT version, content, content_hash, is_current FROM category_manifest_version WHERE category_key = $1 AND version = $2 AND status = 'PUBLISHED'", [key, version])
      : await db.query<Row>("SELECT version, content, content_hash, is_current FROM category_manifest_version WHERE category_key = $1 AND is_current", [key]);
    const row = rows[0];
    if (!row) return fallback ? bundledCategory(key, version) : null;
    assertManifestShape(row.content, `${key}@${row.version}`);
    return { requestedKey: key, manifestCategoryKey: key, version: row.version, contentHash: row.content_hash, isCurrent: row.is_current, source: "database", manifest: row.content };
  }

  async function loadProject(version?: string): Promise<LoadedProjectManifest | null> {
    const { rows } = version
      ? await db.query<Row>("SELECT version, content, content_hash, is_current FROM project_manifest_version WHERE version = $1 AND status = 'PUBLISHED'", [version])
      : await db.query<Row>("SELECT version, content, content_hash, is_current FROM project_manifest_version WHERE is_current");
    const row = rows[0];
    if (!row) {
      if (!fallback) return null;
      const doc = bundledProjectManifest();
      const v = manifestVersionOf(doc);
      if (version && version !== v) return null;
      return { version: v, contentHash: manifestContentHash(doc), isCurrent: true, source: "bundled", manifest: doc };
    }
    const c = row.content as Partial<ProjectManifestDoc> | null;
    if (!c || !Array.isArray(c.candidate_categories)) throw new Error(`project manifest ${row.version} is malformed (candidate_categories)`);
    return { version: row.version, contentHash: row.content_hash, isCurrent: row.is_current, source: "database", manifest: c as ProjectManifestDoc };
  }

  const registry: ManifestRegistry = {
    getProjectManifest(version) {
      if (version) {
        let p = pinnedProject.get(version);
        if (!p) {
          p = evictOnFailure(loadProject(version), () => pinnedProject.delete(version));
          pinnedProject.set(version, p);
        }
        // A pinned lookup that found nothing may be published later: do not keep a negative answer.
        return p.then((r) => {
          if (!r) pinnedProject.delete(version);
          return r;
        });
      }
      if (currentProject && fresh(currentProject.at)) return currentProject.value;
      const value = loadProject();
      const entry = { at: now(), value };
      currentProject = entry;
      value.catch(() => {
        if (currentProject === entry) currentProject = null;
      });
      return value;
    },

    getCategoryManifest(categoryKey, version) {
      if (version) {
        const k = `${categoryKey}@${version}`;
        let p = pinned.get(k);
        if (!p) {
          p = evictOnFailure(loadCategory(categoryKey, version), () => pinned.delete(k));
          pinned.set(k, p);
        }
        return p.then((r) => {
          if (!r) pinned.delete(k);
          return r;
        });
      }
      const hit = currentCat.get(categoryKey);
      if (hit && fresh(hit.at)) return hit.value;
      const value = loadCategory(categoryKey);
      const entry = { at: now(), value };
      currentCat.set(categoryKey, entry);
      value.catch(() => {
        if (currentCat.get(categoryKey) === entry) currentCat.delete(categoryKey);
      });
      return value;
    },

    async getManifestForCategory(categoryKey, version) {
      const own = resolveManifestCategoryKey(categoryKey);
      const exact = await registry.getCategoryManifest(own, version);
      if (exact) return { ...exact, requestedKey: categoryKey };
      if (own !== GENERIC_KEY && !version) {
        const generic = await registry.getCategoryManifest(GENERIC_KEY);
        if (generic) return { ...generic, requestedKey: categoryKey };
      }
      throw new Error(version ? `manifest ${own}@${version} is not published` : `no published manifest for ${own} and no ${GENERIC_KEY} manifest to fall back to`);
    },

    invalidate() {
      currentCat.clear();
      currentProject = null;
    },
  };
  return registry;
}
