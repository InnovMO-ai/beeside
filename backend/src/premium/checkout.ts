import { Db } from "../db/database";

/**
 * Checkout boundary. No commercial payment provider is selected (Phase 9 instruction): the default
 * adapter only records that the client asked to continue, and beeside confirms the activation, which
 * then arrives through the provider-agnostic subscription_event contract. A future provider adapter
 * returns a redirect instead — without changing the subscription/entitlement model.
 */
export type CheckoutOutcome = { kind: "pending_confirmation" } | { kind: "redirect"; url: string } | { kind: "activated" };

export interface CheckoutRequest {
  requestId: string;
  projectId: string;
  kind: "activation" | "reactivation";
  now: Date;
}

export interface CheckoutAdapter {
  readonly name: string;
  begin(tx: Db, request: CheckoutRequest): Promise<{ outcome: CheckoutOutcome; reference: string | null }>;
}

/** Default: no provider, no charge, no activation — the request waits for beeside's confirmation. */
export class ManualConfirmationCheckout implements CheckoutAdapter {
  readonly name = "manual_confirmation";
  async begin(): Promise<{ outcome: CheckoutOutcome; reference: string | null }> {
    return { outcome: { kind: "pending_confirmation" }, reference: null };
  }
}

/**
 * Development only: simulates the provider confirming immediately, so the full transition can be
 * exercised end to end. The simulated event goes through the same processor as any real event.
 */
export class DevSimulatedCheckout implements CheckoutAdapter {
  readonly name = "dev_simulated";
  constructor(
    private readonly confirm: (tx: Db, request: CheckoutRequest) => Promise<void>,
  ) {}
  async begin(tx: Db, request: CheckoutRequest): Promise<{ outcome: CheckoutOutcome; reference: string | null }> {
    await this.confirm(tx, request);
    return { outcome: { kind: "activated" }, reference: `dev-sim-${request.requestId}` };
  }
}
