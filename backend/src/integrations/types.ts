/**
 * Outbound integrations (Phase 12). PostgreSQL is the only system of record: destinations receive
 * data, they never write it back. Adapters get plain values prepared by beeside (never a database
 * handle) and return only an external reference, so nothing a destination does can change a Person,
 * Company, Project, answer, finding, Snapshot, entitlement or any other canonical entity.
 */

export const DESTINATIONS = ["smartsuite", "operation_hub"] as const;
export type Destination = (typeof DESTINATIONS)[number];

/** Every event type an adapter may receive; each destination routes a subset. */
export const ROUTABLE_EVENTS = [
  "assessment.completed",
  "premium.activation_requested",
  "subscription.premium_activated",
  "subscription.cancellation_requested",
  "subscription.subscription_period_ended",
  "subscription.premium_reactivated",
  "precision.handoff_package_generated",
  "retention.project_purged",
] as const;
export type RoutableEvent = (typeof ROUTABLE_EVENTS)[number];

export function isRoutableEvent(value: unknown): value is RoutableEvent {
  return typeof value === "string" && (ROUTABLE_EVENTS as readonly string[]).includes(value);
}

export interface OutboundEvent {
  eventId: string;
  eventType: string;
  projectId: string | null;
  occurredAt: Date;
  /** Ids, enumerations and booleans only (outbox payloads never carry personal data). */
  payload: Record<string, unknown>;
}

export type SourceValue = string | number | boolean | string[] | null;

export type AdapterOutcome =
  | { kind: "upserted"; externalId: string }
  | { kind: "deleted" }
  | { kind: "delivered"; externalReference: string | null }
  | { kind: "skipped"; reason: string };

export interface DeliveryContext {
  event: OutboundEvent;
  /** Current values of the allow-listed source keys, or null when the project no longer exists. */
  record: Readonly<Record<string, SourceValue>> | null;
  /** The id this destination previously assigned to the project's record, if any. */
  externalId: string | null;
}

export interface DestinationAdapter {
  readonly destination: Destination;
  /** e.g. "smartsuite_live", "smartsuite_capture" — recorded on each delivery. */
  readonly name: string;
  routes(eventType: string): boolean;
  deliver(context: DeliveryContext): Promise<AdapterOutcome>;
}

/** A destination failure. `retryable` false sends the delivery straight to dead-letter. */
export class IntegrationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "IntegrationError";
  }
}

export interface IntegrationSet {
  adapters: Partial<Record<Destination, DestinationAdapter>>;
}
