import { createHash } from "node:crypto";
import { IntegrationDescriptor } from "../ports/integration-descriptor";
import {
  OH_CONTRACT_VERSION,
  OhAccessState,
  OhAcceptance,
  OhExternalReference,
  OhHandoffPayload,
  OhPortError,
  OhVerification,
  OperationHubPort,
  payloadChecksum,
} from "../ports/operation-hub";

/**
 * Operation Hub simulator. A faithful stand-in for the external platform: it owns its own store
 * (separate from Precision's database), is idempotent by key, computes its own checksum, and can be
 * scripted to fail in each way the real platform can. It never says "accepted" unless it stored the
 * delivery. Internal use only — client-facing surfaces must not expose that it is a simulator.
 */
export type SimulatorAccessMode = "pending" | "accessible_with_sherpa" | "accessible_without_sherpa";

export interface SimulatorOptions {
  /** What the client can do in Operation Hub after the first accepted send. */
  accessAfterFirstSend?: SimulatorAccessMode;
  sherpaDisplayName?: string;
  /** Test control: a direct Sherpa channel provided by the platform. Default none (the real hub's channel is not defined yet). */
  sherpaContactEmail?: string;
  now?: () => Date;
  /** Projects whose company_id the platform knows; used to emulate IDENTITY_MISMATCH. Omit to skip the check. */
  knownCompanies?: Record<string, string>;
}

export interface OhFaultInjector {
  /** Next publish: platform stores the delivery but the acknowledgement is lost (TIMEOUT, outcome unknown). */
  timeoutAfterStore(): void;
  /** Next publish: platform is down and stores nothing (UNAVAILABLE). */
  unavailableBeforeStore(): void;
  rateLimitNext(): void;
  rejectNext(): void;
  /** Next publish: platform stores something different from what was sent (CHECKSUM_MISMATCH). */
  corruptNext(): void;
  authFailureNext(): void;
}

type Fault = "timeout_after_store" | "unavailable" | "rate_limit" | "reject" | "corrupt" | "auth";

interface StoredDelivery {
  checksum: string;
  reference: OhExternalReference;
  acceptedAt: string;
  projectId: string;
  kind: string;
}

export class SimulatedOperationHub implements OperationHubPort, OhFaultInjector {
  private readonly deliveries = new Map<string, StoredDelivery>();
  private readonly provisionedProjects = new Set<string>();
  private readonly faults: Fault[] = [];
  private sequence = 0;
  private readonly accessAfterFirstSend: SimulatorAccessMode;
  private readonly sherpaDisplayName: string;
  private readonly now: () => Date;

  constructor(private readonly options: SimulatorOptions = {}) {
    this.accessAfterFirstSend = options.accessAfterFirstSend ?? "pending";
    this.sherpaDisplayName = options.sherpaDisplayName ?? "Your beeside team";
    this.now = options.now ?? (() => new Date());
  }

  describe(): IntegrationDescriptor {
    return {
      port: "operation_hub",
      implementation: "simulator",
      mode: "SIMULATED",
      verification: "NOT_VERIFIED",
      note: "Controlled acceptance; no real platform is contacted.",
    };
  }

  // ---- fault injection (tests and internal review only) ----
  timeoutAfterStore(): void { this.faults.push("timeout_after_store"); }
  unavailableBeforeStore(): void { this.faults.push("unavailable"); }
  rateLimitNext(): void { this.faults.push("rate_limit"); }
  rejectNext(): void { this.faults.push("reject"); }
  corruptNext(): void { this.faults.push("corrupt"); }
  authFailureNext(): void { this.faults.push("auth"); }

  /** Test/review hook: counts what the platform actually holds (duplicate-protection assertions). */
  storedCount(): number { return this.deliveries.size; }

  async publish(payload: OhHandoffPayload): Promise<OhAcceptance> {
    const key = payload.contract.idempotency_key;
    if (!["first_send", "crp", "psm_update"].includes(payload.contract.kind)) {
      throw new OhPortError("UNSUPPORTED_KIND", `kind ${String(payload.contract.kind)} is not supported`);
    }
    const fault = this.faults.shift();
    if (fault === "auth") throw new OhPortError("AUTH", "credentials rejected");
    if (fault === "unavailable") throw new OhPortError("UNAVAILABLE", "platform unavailable");
    if (fault === "rate_limit") throw new OhPortError("RATE_LIMITED", "too many requests");
    if (fault === "reject") throw new OhPortError("REJECTED_VALIDATION", "payload refused");

    const expectedCompany = this.options.knownCompanies?.[payload.identity.project_id];
    if (this.options.knownCompanies && expectedCompany !== payload.identity.company_id) {
      throw new OhPortError("IDENTITY_MISMATCH", "company does not match project");
    }

    const sent = payloadChecksum(payload);
    const existing = this.deliveries.get(key);
    if (existing) {
      if (existing.checksum !== sent) {
        throw new OhPortError("REJECTED_VALIDATION", "idempotency key already used with different content");
      }
      return this.acceptance(existing, true);
    }

    this.sequence += 1;
    const reference: OhExternalReference = {
      artifactId: `art_${this.sequence.toString().padStart(6, "0")}`,
      locationId: `loc_${createHash("sha1").update(payload.identity.project_id).digest("hex").slice(0, 8)}`,
      taskId: `task_${this.sequence.toString().padStart(6, "0")}`,
      secureReference: `sec_${createHash("sha256").update(`${key}:${this.sequence}`).digest("hex").slice(0, 16)}`,
    };
    const stored: StoredDelivery = {
      checksum: fault === "corrupt" ? createHash("sha256").update(`corrupt:${sent}`).digest("hex") : sent,
      reference,
      acceptedAt: this.now().toISOString(),
      projectId: payload.identity.project_id,
      kind: payload.contract.kind,
    };
    this.deliveries.set(key, stored);
    this.provisionedProjects.add(payload.identity.project_id);

    if (fault === "timeout_after_store") throw new OhPortError("TIMEOUT", "acknowledgement not received", { outcomeUnknown: true });
    const acceptance = this.acceptance(stored, false);
    if (acceptance.checksum !== sent) throw new OhPortError("CHECKSUM_MISMATCH", "platform stored different content");
    return acceptance;
  }

  async verify(idempotencyKey: string): Promise<OhVerification> {
    const stored = this.deliveries.get(idempotencyKey);
    if (!stored) return { found: false };
    return { found: true, reference: stored.reference, checksum: stored.checksum };
  }

  async accessState(projectId: string): Promise<OhAccessState> {
    if (!this.provisionedProjects.has(projectId)) {
      return { provisioned: false, clientAccessible: false, sherpaAssigned: false };
    }
    switch (this.accessAfterFirstSend) {
      case "pending":
        return { provisioned: true, clientAccessible: false, sherpaAssigned: false };
      case "accessible_without_sherpa":
        return { provisioned: true, clientAccessible: true, sherpaAssigned: false };
      case "accessible_with_sherpa":
        return { provisioned: true, clientAccessible: true, sherpaAssigned: true, sherpaDisplayName: this.sherpaDisplayName, ...(this.options.sherpaContactEmail ? { sherpaContactEmail: this.options.sherpaContactEmail } : {}) };
    }
  }

  private acceptance(stored: StoredDelivery, replayed: boolean): OhAcceptance {
    return {
      reference: stored.reference,
      checksum: stored.checksum,
      contractVersion: OH_CONTRACT_VERSION,
      acceptedAt: stored.acceptedAt,
      replayed,
    };
  }
}
