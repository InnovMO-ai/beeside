import { Db } from "../db/database";
import { recordJourneyEvent } from "../fa/services/analytics";
import { FaError } from "../fa/services/errors";
import { FaDeps } from "../fa/services/repository";
import { CheckoutAdapter, CheckoutOutcome, DevSimulatedCheckout, ManualConfirmationCheckout } from "./checkout";
import { BundleStore } from "../fa/services/bundle-store";
import { PremiumContent, premiumContentOf } from "./content";
import { processSubscriptionEvent } from "./subscription-events";

/** Days of the simulated development period only; real periods always come from the provider event. */
const DEV_SIMULATED_PERIOD_DAYS = 30;

export interface PremiumStatus {
  /** Premium continuation is offered only after the Snapshot exists (First Assessment locked). */
  available: boolean;
  everActivated: boolean;
  accessActive: boolean;
  subscriptionStatus: "PREMIUM_ACTIVE" | "CANCELLATION_SCHEDULED" | "PREMIUM_INACTIVE" | null;
  accessUntil: string | null;
  pendingRequest: { kind: "activation" | "reactivation"; requestedAt: string } | null;
  canActivate: boolean;
  canReactivate: boolean;
  previewRoomUrl: string;
  termsUrl: string;
}

/** Premium copy and links for one project: its pinned question bank (fa-qb-1.1.0+) or the code default. */
export async function premiumContentForProject(db: Db, bundles: BundleStore, projectId: string): Promise<PremiumContent> {
  const { rows } = await db.query<{ question_bank_version: string }>("SELECT question_bank_version FROM project WHERE project_id = $1", [projectId]);
  const version = rows[0]?.question_bank_version;
  if (!version) throw new FaError("NOT_FOUND", "project not found");
  const bundle = await bundles.byVersion(version).catch(() => null);
  return premiumContentOf(bundle, version);
}

export async function getPremiumStatus(db: Db, projectId: string, bundles?: BundleStore): Promise<PremiumStatus> {
  const { rows } = await db.query<{
    assessment_state: string;
    question_bank_version: string;
    premium_ever_activated: boolean;
    premium_access_active: boolean | null;
    effective_until: Date | null;
    status: PremiumStatus["subscriptionStatus"];
    current_period_end: Date | null;
    request_kind: "activation" | "reactivation" | null;
    requested_at: Date | null;
  }>(
    `SELECT p.assessment_state, p.question_bank_version, p.premium_ever_activated, e.premium_access_active, e.effective_until, s.status, s.current_period_end,
            r.kind AS request_kind, r.requested_at
       FROM project p
       LEFT JOIN entitlement e ON e.project_id = p.project_id
       LEFT JOIN LATERAL (SELECT status, current_period_end FROM subscription WHERE project_id = p.project_id ORDER BY created_at DESC, current_period_start DESC LIMIT 1) s ON true
       LEFT JOIN premium_activation_request r ON r.project_id = p.project_id AND r.status = 'REQUESTED'
      WHERE p.project_id = $1`,
    [projectId],
  );
  const row = rows[0];
  if (!row) throw new FaError("NOT_FOUND", "project not found");
  const available = row.assessment_state === "COMPLETED_LOCKED";
  const accessActive = row.premium_access_active === true;
  const pending = row.request_kind && row.requested_at ? { kind: row.request_kind, requestedAt: row.requested_at.toISOString() } : null;
  const links = bundles ? premiumContentOf(await bundles.byVersion(row.question_bank_version).catch(() => null), row.question_bank_version) : premiumContentOf(null, null);
  return {
    available,
    everActivated: row.premium_ever_activated,
    accessActive,
    subscriptionStatus: row.status,
    accessUntil: row.status === "CANCELLATION_SCHEDULED" && row.current_period_end ? row.current_period_end.toISOString() : null,
    pendingRequest: pending,
    canActivate: available && !row.premium_ever_activated && !pending,
    canReactivate: available && row.premium_ever_activated && !accessActive && !pending,
    previewRoomUrl: links.previewRoomUrl,
    termsUrl: links.termsUrl,
  };
}

/** The checkout adapter for this deployment: manual confirmation unless dev simulation is enabled. */
export function checkoutFor(deps: FaDeps): CheckoutAdapter {
  if (deps.premium?.checkout) return deps.premium.checkout;
  return new ManualConfirmationCheckout();
}

export function devSimulatedCheckout(deps: Pick<FaDeps, "bundles">): CheckoutAdapter {
  return new DevSimulatedCheckout(async (tx, request) => {
    await processSubscriptionEvent(tx, deps.bundles, {
      projectId: request.projectId,
      eventType: request.kind === "activation" ? "premium_activated" : "premium_reactivated",
      occurredAt: request.now,
      source: "dev_simulated",
      idempotencyKey: `dev-sim-${request.requestId}`,
      periodStart: request.now,
      periodEnd: new Date(request.now.getTime() + DEV_SIMULATED_PERIOD_DAYS * 86_400_000),
    });
  });
}

/**
 * "Activate Premium" from the consideration experience (Functional Specification v1 §16.6): records
 * the request with its Terms acceptance and hands it to the checkout adapter. No price is involved.
 */
export async function requestPremiumActivation(
  deps: FaDeps,
  projectId: string,
  personId: string,
  input: { acceptTerms: unknown; interfaceLanguage: string },
): Promise<{ outcome: CheckoutOutcome; status: PremiumStatus }> {
  if (input.acceptTerms !== true) throw new FaError("INVALID_INPUT", "the Terms & Conditions must be accepted", { fields: ["acceptTerms"] });
  const now = deps.config.now();
  const checkout = checkoutFor(deps);
  return deps.db.transaction(async (tx) => {
    await tx.query("SELECT project_id FROM project WHERE project_id = $1 FOR UPDATE", [projectId]);
    const status = await getPremiumStatus(tx, projectId, deps.bundles);
    if (status.pendingRequest) return { outcome: { kind: "pending_confirmation" as const }, status };
    if (!status.canActivate && !status.canReactivate) throw new FaError("NOT_APPLICABLE", "Premium cannot be requested for this project right now");
    const kind = status.canActivate ? "activation" : "reactivation";
    const inserted = await tx.query<{ request_id: string }>(
      `INSERT INTO premium_activation_request (project_id, person_id, kind, terms_url, terms_accepted_at, interface_language, checkout_adapter, requested_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $5) RETURNING request_id`,
      [projectId, personId, kind, status.termsUrl, now, input.interfaceLanguage === "es" ? "es" : "en", checkout.name],
    );
    const requestId = inserted.rows[0]?.request_id as string;
    await recordJourneyEvent(tx, { eventType: "premium_activation_requested", projectId, properties: { kind, checkout: checkout.name } });
    await tx.query("INSERT INTO outbox_event (project_id, event_type, payload, occurred_at) VALUES ($1, 'premium.activation_requested', $2::jsonb, $3)", [
      projectId,
      JSON.stringify({ request_id: requestId, project_id: projectId, kind }),
      now,
    ]);
    const { outcome, reference } = await checkout.begin(tx, { requestId, projectId, kind, now });
    if (reference) await tx.query("UPDATE premium_activation_request SET checkout_reference = $2 WHERE request_id = $1", [requestId, reference]);
    return { outcome, status: await getPremiumStatus(tx, projectId, deps.bundles) };
  });
}
