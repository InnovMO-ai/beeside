import { Pool } from "pg";
import { Db } from "../../db/database";

/**
 * Conciliación periódica (CR-KL-002 §4.2): defensa adicional que marca como inactivos en beeside_kl a los principales
 * desactivados en el Control Center. NUNCA autoriza nada ni reactiva: solo kl.reconcile_principal(false). Corre en el
 * backend cada 5 minutos con un bloqueo consultivo para que la ejecute una sola instancia.
 */
export const RECONCILE_LOCK_KEY = 7_306_002;
export const RECONCILE_INTERVAL_MS = 5 * 60_000;

export interface ReconcileResult {
  skipped: boolean;
  checked: number;
  deactivated: number;
}

export async function reconcilePrincipals(deps: { beeside: Db; kl: Pool }): Promise<ReconcileResult> {
  const client = await deps.kl.connect();
  try {
    const lock = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1) AS ok", [RECONCILE_LOCK_KEY]);
    if (!lock.rows[0]?.ok) return { skipped: true, checked: 0, deactivated: 0 };
    try {
      // Solo se leen las columnas mínimas de identidad y estado.
      const users = await deps.beeside.query<{ admin_user_id: string; active: boolean; login_enabled: boolean }>("SELECT admin_user_id, active, login_enabled FROM admin_user");
      let deactivated = 0;
      for (const u of users.rows) {
        const r = await client.query<{ changed: boolean }>("SELECT kl.reconcile_principal($1, $2) AS changed", [u.admin_user_id, u.active && u.login_enabled]);
        if (r.rows[0]?.changed) deactivated += 1;
      }
      return { skipped: false, checked: users.rows.length, deactivated };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [RECONCILE_LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}

/** Arranca el ciclo de conciliación; devuelve la función que lo detiene. Un ciclo fallido solo se registra. */
export function startReconciler(deps: { beeside: Db; kl: Pool; log?: (message: string, fields?: Record<string, string | number | boolean | null>) => void }, intervalMs = RECONCILE_INTERVAL_MS): () => void {
  const tick = () => {
    reconcilePrincipals(deps).then(
      (r) => {
        if (!r.skipped && r.deactivated > 0) deps.log?.("kl.reconcile.deactivated", { count: r.deactivated });
      },
      (error: unknown) => deps.log?.("kl.reconcile.failed", { error: error instanceof Error ? error.name : "error" }),
    );
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
