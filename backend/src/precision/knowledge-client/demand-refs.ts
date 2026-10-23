/**
 * The opaque references Precision attaches to a knowledge demand signal.
 *
 * The Knowledge Layer must be able to count DISTINCT projects behind a demand but must never receive the real project id. So Precision
 * derives the reference itself: an HMAC-SHA256 keyed with a secret that only Precision holds (a key derived from the platform's hash
 * secret for this purpose alone). Without the key the reference cannot be reversed, recomputed from a guessed project id, or linked to any
 * other identifier; the same project always maps to the same reference, so recurrence by distinct project works.
 *
 * `eventRef` exists only so a retried turn counts once; it is derived the same way and is just as opaque.
 */
import { createHmac } from "node:crypto";
import type { DemandRefs } from "../../knowledge-layer/contract";

const PURPOSE = "beeside.kl.v1.demand-reference";
const HEX_BITS = 32; // 128 bits of the 256-bit MAC: plenty to tell projects apart, and the column's contract

export type DemandRefFactory = (projectId: string, turnKey: string) => DemandRefs;

export function createDemandRefs(secret: string): DemandRefFactory {
  if (typeof secret !== "string" || secret.length < 32) throw new Error("the demand reference key must be derived from a secret of at least 32 characters");
  // one key per purpose: the platform hash secret is never used directly
  const key = createHmac("sha256", secret).update(PURPOSE).digest();
  const mac = (scope: string, value: string): string => createHmac("sha256", key).update(`${scope}\u0000${value}`).digest("hex").slice(0, HEX_BITS);
  return (projectId, turnKey) => ({ projectRef: mac("project", projectId), eventRef: mac("event", `${projectId}\u0000${turnKey}`) });
}

/** Development/test key. NEVER valid in production: the wiring refuses to start without the real secret there. */
export const DEVELOPMENT_DEMAND_SECRET = "development-demand-reference-secret-not-for-production";
