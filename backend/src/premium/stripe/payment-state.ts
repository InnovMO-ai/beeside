import { Request, Response, Router } from "express";
import { Db } from "../../db/database";
import { FaError } from "../../fa/services/errors";
import { FaDeps } from "../../fa/services/repository";
import { authenticateSession } from "../../fa/services/session-service";

/**
 * "Payment pending confirmation" read model for the client's return page. It exposes ONE word and nothing from the
 * payment platform: no ids, amounts, provider names or technical payment states. It is derived from Core tables
 * only, so it can never be used to grant anything — the return page just reflects what Core has (or has not yet) confirmed.
 *
 *   active       — Premium is active for this project (a verified payment has been applied).
 *   confirming   — a payment attempt is open or paid and Core has not confirmed it yet: keep showing "confirming".
 *   failed_retry — the last attempt did not go through (e.g. a delayed payment method was declined): the client may try again.
 *   not_started  — nothing in progress.
 */
export type PaymentConfirmationState = "confirming" | "active" | "not_started" | "failed_retry";

export async function getPaymentConfirmationState(db: Db, projectId: string, now: Date): Promise<{ state: PaymentConfirmationState }> {
  const { rows } = await db.query<{ premium_access_active: boolean | null; status: string | null; expires_at: Date | null; outcome: string | null }>(
    `SELECT e.premium_access_active, c.status, c.expires_at, c.outcome
       FROM project p
       LEFT JOIN entitlement e ON e.project_id = p.project_id
       LEFT JOIN LATERAL (SELECT status, expires_at, outcome FROM premium_checkout WHERE project_id = p.project_id ORDER BY (status = 'open') DESC, created_at DESC LIMIT 1) c ON true
      WHERE p.project_id = $1`,
    [projectId],
  );
  const row = rows[0];
  if (!row) throw new FaError("NOT_FOUND", "project not found");
  if (row.premium_access_active === true) return { state: "active" };
  if (row.status === "open" && (!row.expires_at || row.expires_at.getTime() > now.getTime())) return { state: "confirming" };
  // Paid but not activated (e.g. the project cannot enter Premium): ops has an alert; the client sees the neutral "confirming" state.
  if (row.status === "completed" && row.outcome !== "ACTIVATED") return { state: "confirming" };
  if (row.status === "failed") return { state: "failed_retry" };
  return { state: "not_started" };
}

function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.header("authorization") ?? "");
  return match?.[1] ?? null;
}

/**
 * Mounted at /api/fa/session/premium/payment-state with the same session authentication as the rest of /api/fa/session
 * (Bearer session token). The front end needs no change to consume it other than calling it from its return page.
 */
export function createPaymentStateRouter(deps: FaDeps): Router {
  const router = Router();
  router.get("/", (req: Request, res: Response, next) => {
    void (async () => {
      try {
        const ctx = await authenticateSession(deps, bearerToken(req));
        res.set("Cache-Control", "no-store").json(await getPaymentConfirmationState(deps.db, ctx.project.project_id, deps.config.now()));
      } catch (error) {
        if (error instanceof FaError) res.status(error.status).json({ error: error.code, message: error.message });
        else next(error);
      }
    })();
  });
  return router;
}
