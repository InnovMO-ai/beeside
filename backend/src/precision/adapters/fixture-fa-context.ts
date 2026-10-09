import { createHash } from "node:crypto";
import { canonicalJson } from "../ports/operation-hub";
import { IntegrationDescriptor } from "../ports/integration-descriptor";
import { FaClientSafeContext, FaContextRead, FaContextReader } from "../ports/fa-context";

/** FA context reader over synthetic, client-safe contexts supplied by configuration. */
export class FixtureFaContextReader implements FaContextReader {
  private readonly contexts = new Map<string, FaContextRead>();
  private fallback: ((projectId: string) => Promise<{ projectId: string; resultId: string; context: FaClientSafeContext; deliveredAt?: string } | null>) | null = null;

  constructor(entries: { projectId: string; resultId: string; context: FaClientSafeContext; deliveredAt?: string }[] = []) {
    for (const e of entries) this.add(e);
  }

  /** Resolves projects that were registered after start-up (configuration lookup on a miss). */
  setFallback(resolve: (projectId: string) => Promise<{ projectId: string; resultId: string; context: FaClientSafeContext; deliveredAt?: string } | null>): void {
    this.fallback = resolve;
  }

  add(e: { projectId: string; resultId: string; context: FaClientSafeContext; deliveredAt?: string }): void {
    this.contexts.set(e.projectId, {
      sourceSystem: "fa4",
      sourceProjectId: e.projectId,
      sourceResultId: e.resultId,
      catalogVersion: "2026-10-04.v4",
      contractVersion: "0.2",
      crosswalkVersion: "v3",
      contextHash: createHash("sha256").update(canonicalJson(e.context)).digest("hex"),
      deliveredAt: e.deliveredAt ?? "2026-10-01T09:00:00.000Z",
      context: e.context,
    });
  }

  describe(): IntegrationDescriptor {
    return {
      port: "fa_context",
      implementation: "fixture",
      mode: "SIMULATED",
      verification: "NOT_VERIFIED",
      note: "Synthetic client-safe First Assessment context.",
    };
  }

  async read(projectId: string): Promise<FaContextRead | null> {
    const known = this.contexts.get(projectId);
    if (known || !this.fallback) return known ?? null;
    const entry = await this.fallback(projectId);
    if (!entry) return null;
    this.add(entry);
    return this.contexts.get(projectId) ?? null;
  }
}
