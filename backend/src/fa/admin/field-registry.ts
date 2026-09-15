import { FA_FIELDS } from "@beeside/canonical-fields";

interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** The registry rows derived from shared/canonical-fields (the single source of truth). */
export function faRegistryPayload() {
  return FA_FIELDS.map((f) => ({
    field_key: f.key,
    data_type: f.dataType,
    source: f.source,
    module: f.module,
    description: f.description,
  }));
}

/** Deterministic sync: upserts every canonical fa.* key and deactivates any other active fa.* key. */
export async function syncFieldRegistry(db: Queryable): Promise<Record<string, unknown>> {
  const { rows } = await db.query("SELECT field_registry_sync('first_assessment', $1::jsonb) AS result", [
    JSON.stringify(faRegistryPayload()),
  ]);
  return (rows[0] as { result: Record<string, unknown> }).result;
}

/** Drift report: differences between the active database registry and shared/canonical-fields. */
export async function checkFieldRegistry(db: Queryable): Promise<{ missing: string[]; extra: string[]; changed: string[] }> {
  const { rows } = await db.query(
    "SELECT field_key, data_type, source, description FROM field_key_registry WHERE module = 'first_assessment' AND active",
  );
  const active = new Map((rows as Array<{ field_key: string; data_type: string; source: string; description: string | null }>).map((r) => [r.field_key, r]));
  const expected = faRegistryPayload();
  const missing = expected.filter((e) => !active.has(e.field_key)).map((e) => e.field_key);
  const changed = expected
    .filter((e) => {
      const r = active.get(e.field_key);
      return r && (r.data_type !== e.data_type || r.source !== e.source || r.description !== e.description);
    })
    .map((e) => e.field_key);
  const expectedKeys = new Set(expected.map((e) => e.field_key));
  const extra = [...active.keys()].filter((k) => !expectedKeys.has(k));
  return { missing, extra, changed };
}
