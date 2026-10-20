import { Pool } from "pg";
import { Db } from "../../db/database";

/**
 * Correlación de auditoría (B5, X30). `kl.audit_event` se escribe en la misma transacción que el cambio y el acceso se
 * registra después en `admin_audit_event`: las dos auditorías no son atómicas, así que cada día se comparan por `request_id`.
 *
 *  - «solo en KL»: un cambio confirmado en KL sin su registro de acceso en la base principal (falló recordAudit);
 *  - «solo en la principal»: una acción kl.* ALLOWED que no es de lectura y no dejó cambio en KL.
 *
 * Fallo seguro: si cualquiera de las dos lecturas falla no se escribe ningún reporte (no hay falsos «limpio» ni falsas
 * discrepancias) y la ventana se reintenta tal cual. Nunca se corrige ni se borra nada: ambas auditorías son de solo inserción.
 * La ventana termina `graceMs` antes de ahora (peticiones en vuelo) y los pares se buscan con holgura de `graceMs` en los bordes.
 */
export const CORRELATION_LOCK_KEY = 7_306_003;
export const CORRELATION_INTERVAL_MS = 24 * 60 * 60_000;
export const CORRELATION_GRACE_MS = 5 * 60_000;
const MAX_LISTED = 500;

export interface CorrelationResult {
  skipped: "locked" | "window_too_small" | null;
  reportId?: string;
  status?: "clean" | "discrepancies";
  klChecked: number;
  platformChecked: number;
  klOnly: { requestId: string; actions: string[] }[];
  adminOnly: { requestId: string; action: string }[];
}

export class CorrelationIncomplete extends Error {
  constructor(readonly side: "kl" | "platform", cause: unknown) {
    super(`audit correlation incomplete: ${side} unavailable`);
    this.name = "CorrelationIncomplete";
    this.cause = cause;
  }
}

/** Una acción de lectura no deja cambio en KL: no se espera su par en kl.audit_event. */
const isRead = (action: string) => /\.read$/.test(action) || action === "kl.read";

export async function correlateAudit(deps: { platform: Db; kl: Pool; now?: () => Date; graceMs?: number }): Promise<CorrelationResult> {
  const now = (deps.now ?? (() => new Date()))();
  const grace = deps.graceMs ?? CORRELATION_GRACE_MS;
  const empty = (skipped: CorrelationResult["skipped"]): CorrelationResult => ({ skipped, klChecked: 0, platformChecked: 0, klOnly: [], adminOnly: [] });
  const client = await deps.kl.connect();
  try {
    const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [CORRELATION_LOCK_KEY]);
    if (!lock.rows[0]?.ok) return empty("locked");
    try {
      const to = new Date(now.getTime() - grace);
      let from: Date;
      try {
        const last = await client.query<{ w: Date | null }>("SELECT kl.last_correlation_window() AS w");
        from = last.rows[0]?.w ?? new Date(0);
      } catch (error) {
        throw new CorrelationIncomplete("kl", error);
      }
      if (to.getTime() <= from.getTime()) return empty("window_too_small");
      const lo = new Date(from.getTime() - grace);
      const hi = new Date(to.getTime() + grace);

      let klRows: { request_id: string; actions: string[]; first_at: Date }[];
      try {
        klRows = (await client.query<{ request_id: string; actions: string[]; first_at: Date }>("SELECT request_id::text AS request_id, actions, first_at FROM kl.correlation_snapshot($1, $2)", [lo, hi])).rows;
      } catch (error) {
        throw new CorrelationIncomplete("kl", error);
      }
      let platformRows: { request_id: string; action: string; outcome: string; occurred_at: Date }[];
      try {
        platformRows = (
          await deps.platform.query<{ request_id: string; action: string; outcome: string; occurred_at: Date }>(
            "SELECT request_id, action, outcome, occurred_at FROM admin_audit_event WHERE action LIKE 'kl.%' AND request_id IS NOT NULL AND occurred_at >= $1 AND occurred_at < $2",
            [lo, hi],
          )
        ).rows;
      } catch (error) {
        throw new CorrelationIncomplete("platform", error);
      }

      const platformIds = new Set(platformRows.map((r) => r.request_id));
      const klIds = new Set(klRows.map((r) => r.request_id));
      const inWindow = (d: Date) => d.getTime() >= from.getTime() && d.getTime() < to.getTime();
      const klOnly = klRows.filter((r) => inWindow(r.first_at) && !platformIds.has(r.request_id)).map((r) => ({ requestId: r.request_id, actions: r.actions }));
      const adminOnly = platformRows
        .filter((r) => inWindow(r.occurred_at) && r.outcome === "ALLOWED" && !isRead(r.action) && !klIds.has(r.request_id))
        .map((r) => ({ requestId: r.request_id, action: r.action }));
      const klChecked = klRows.filter((r) => inWindow(r.first_at)).length;
      const platformChecked = platformRows.filter((r) => inWindow(r.occurred_at)).length;

      const saved = await client.query<{ id: string; status: "clean" | "discrepancies" }>(
        "SELECT kl.record_correlation_report($1, $2, $3, $4, $5::jsonb, $6::jsonb) AS id, CASE WHEN $7 THEN 'clean' ELSE 'discrepancies' END AS status",
        [from, to, klChecked, platformChecked, JSON.stringify(klOnly.slice(0, MAX_LISTED)), JSON.stringify(adminOnly.slice(0, MAX_LISTED)), klOnly.length === 0 && adminOnly.length === 0],
      );
      return { skipped: null, reportId: String(saved.rows[0]?.id), status: saved.rows[0]?.status, klChecked, platformChecked, klOnly, adminOnly };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [CORRELATION_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

export function startAuditCorrelation(deps: { platform: Db; kl: Pool; log?: (message: string, fields?: Record<string, string | number | boolean | null>) => void }, intervalMs = CORRELATION_INTERVAL_MS): () => void {
  const tick = () => {
    correlateAudit(deps).then(
      (r) => {
        if (r.status === "discrepancies") deps.log?.("kl.audit_correlation.discrepancies", { klOnly: r.klOnly.length, adminOnly: r.adminOnly.length });
      },
      (error: unknown) => deps.log?.("kl.audit_correlation.incomplete", { error: error instanceof Error ? error.name : "error" }),
    );
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
