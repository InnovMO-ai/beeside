import { Logger } from "../security/redact";
import { AdapterOutcome, DeliveryContext, DestinationAdapter } from "./types";

/**
 * Operation Hub / ClickUp boundary (Phase 12) — strictly outbound. beeside tells the external
 * workspace that a Precision handoff is ready or that Premium access changed, identified by the
 * same project_id; it never reads anything back into canonical entities, and there is no inbound
 * endpoint. No workspace contract or credentials exist yet, so only the development capture
 * implementation is provided; `live` is refused at startup.
 */

export const OPERATION_HUB_EVENTS: ReadonlySet<string> = new Set([
  "precision.handoff_package_generated",
  "subscription.premium_activated",
  "subscription.cancellation_requested",
  "subscription.subscription_period_ended",
  "subscription.premium_reactivated",
]);

export type OperationHubCommand =
  | { command: "handoff_ready"; projectId: string; handoffPackageId: string | null; contractVersion: number | null }
  | { command: "access_changed"; projectId: string; accessActive: boolean; subscriptionStatus: string | null };

/** Builds the outbound command from the event's own ids and flags — no client content. */
export function operationHubCommand(context: DeliveryContext): OperationHubCommand | null {
  const { event } = context;
  if (!event.projectId || !OPERATION_HUB_EVENTS.has(event.eventType)) return null;
  const p = event.payload;
  if (event.eventType === "precision.handoff_package_generated") {
    return {
      command: "handoff_ready",
      projectId: event.projectId,
      handoffPackageId: typeof p.package_id === "string" ? p.package_id : null,
      contractVersion: typeof p.contract_version === "number" ? p.contract_version : null,
    };
  }
  return {
    command: "access_changed",
    projectId: event.projectId,
    accessActive: p.premium_access_active === true,
    subscriptionStatus: typeof p.status === "string" ? p.status : null,
  };
}

export class CaptureOperationHubAdapter implements DestinationAdapter {
  readonly destination = "operation_hub" as const;
  readonly name = "operation_hub_capture";
  readonly commands: OperationHubCommand[] = [];
  constructor(private readonly log?: Logger) {}

  routes(eventType: string): boolean {
    return OPERATION_HUB_EVENTS.has(eventType);
  }

  async deliver(context: DeliveryContext): Promise<AdapterOutcome> {
    const command = operationHubCommand(context);
    if (!command) return { kind: "skipped", reason: "not_routable" };
    this.commands.push(command);
    this.log?.("info", "operation hub capture", { command: command.command });
    return { kind: "delivered", externalReference: null };
  }
}
