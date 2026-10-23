/**
 * First Assessment context for Precision: a tolerant pull by project id, the source pin (`context_pin`) created the first
 * time the context is read for work, and the small parsing helpers (destinations, time window).
 *
 * "Unavailable" is a normal state: a reader that returns null or throws yields `null`, never an error for the client; the
 * next request simply asks again (positive answers are cached briefly). Inherited values are PREFILL_CONFIRM only: nothing
 * here writes a confirmed fact.
 */
import type { Db } from "../../db/database";
import type { Logger } from "../../security/redact";
import { describeError } from "../../security/redact";
import type { FaContextRead, FaContextReader } from "../ports/fa-context";
import { countryName } from "../manifest/value-render";
import type { Locale } from "../api/dto";

const POSITIVE_TTL_MS = 30_000;

export interface FaContextService {
  /** The delivered context or null (none delivered, or the reader failed). Never throws. */
  read(projectId: string): Promise<FaContextRead | null>;
  /** Like `read`, but says whether a null means "nothing delivered" (failed=false) or "the reader failed just now" (failed=true). Never throws. */
  readWithStatus(projectId: string): Promise<{ read: FaContextRead | null; failed: boolean }>;
  /** Creates (or reuses) the current source pin for this result. */
  ensurePin(db: Db, projectId: string, read: FaContextRead): Promise<string>;
  invalidate(projectId?: string): void;
}

export function createFaContextService(reader: FaContextReader, log: Logger, now: () => number = Date.now): FaContextService {
  const cache = new Map<string, { at: number; value: FaContextRead }>();
  async function readWithStatus(projectId: string): Promise<{ read: FaContextRead | null; failed: boolean }> {
    const hit = cache.get(projectId);
    if (hit && now() - hit.at < POSITIVE_TTL_MS) return { read: hit.value, failed: false };
    try {
      const value = await reader.read(projectId);
      if (value) cache.set(projectId, { at: now(), value });
      else cache.delete(projectId);
      return { read: value, failed: false };
    } catch (error) {
      cache.delete(projectId);
      log("warn", "fa context unavailable", { error: describeError(error) });
      return { read: null, failed: true };
    }
  }
  return {
    read: async (projectId) => (await readWithStatus(projectId)).read,
    readWithStatus,
    async ensurePin(db, projectId, read) {
      const find = async (): Promise<string | undefined> => (await db.query<{ id: string }>("SELECT id FROM context_pin WHERE project_id = $1 AND source_result_id = $2", [projectId, read.sourceResultId])).rows[0]?.id;
      const existing = await find();
      if (existing) return existing;
      try {
        return await db.transaction(async (tx) => {
          const { rows } = await tx.query<{ id: string }>("SELECT gen_random_uuid() AS id");
          const id = rows[0]!.id;
          // superseding protocol: the old current pin points at the new one (deferred FK), then the new current pin is inserted
          await tx.query("UPDATE context_pin SET status = 'superseded', superseded_by_pin_id = $2 WHERE project_id = $1 AND status = 'current'", [projectId, id]);
          await tx.query(
            `INSERT INTO context_pin (id, project_id, source_system, source_project_id, source_result_id, catalog_version, contract_version, crosswalk_version, context_hash)
             VALUES ($1, $2, 'fa4', $3, $4, $5, $6, $7, $8)`,
            [id, projectId, read.sourceProjectId, read.sourceResultId, read.catalogVersion, read.contractVersion, read.crosswalkVersion, read.contextHash],
          );
          return id;
        });
      } catch (error) {
        if ((error as { code?: string }).code === "23505") {
          const raced = await find();
          if (raced) return raced;
        }
        throw error;
      }
    },
    invalidate(projectId) {
      if (projectId) cache.delete(projectId);
      else cache.clear();
    },
  };
}

// ------------------------------------------------------------------ parsing helpers
let regionIndex: Map<string, string> | null = null;
const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function regions(): Map<string, string> {
  if (regionIndex) return regionIndex;
  const m = new Map<string, string>();
  for (const loc of ["en", "es"] as const) {
    let dn: Intl.DisplayNames | null = null;
    try {
      dn = new Intl.DisplayNames([loc], { type: "region" });
    } catch {
      dn = null;
    }
    if (!dn) continue;
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        let name: string | undefined;
        try {
          name = dn.of(code);
        } catch {
          name = undefined;
        }
        if (name && name !== code) m.set(fold(name), code);
      }
    }
  }
  regionIndex = m;
  return m;
}

/** ISO-3166-1 alpha-2 codes found in a free destination text ("MX", "Mexico, Spain", "México y España"). */
export function parseCountryCodes(text: string | undefined | null): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const part of text.split(/[,;/&]|\by\b|\band\b/i)) {
    const t = part.trim();
    if (!t) continue;
    const code = /^[A-Za-z]{2}$/.test(t) ? t.toUpperCase() : regions().get(fold(t));
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

export function destinationsOf(codes: readonly string[], locale: Locale): { code: string; label: string }[] {
  return codes.map((code) => ({ code, label: countryName(code, locale) }));
}

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD` as stored for a date field; anything else is not offered as an inherited value. */
export function parseTimeWindow(text: string | undefined | null): string | null {
  const t = (text ?? "").trim();
  return /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/.test(t) ? t : null;
}
