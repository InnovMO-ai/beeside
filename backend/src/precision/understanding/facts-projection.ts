/**
 * Frame -> `pa_*` facts. The frame is the source of what Precision understands; these facts keep the existing readers (readiness,
 * My Service Map, Operation Hub payload) working off the same fact model. Idempotent: same frame -> same candidates.
 */
import type { CandidateFact } from "../conversation/types";
import type { Frame } from "./types";

export function projectFacts(frame: Frame, turnKey: string): CandidateFact[] {
  const out: CandidateFact[] = [];
  const add = (fieldKey: string, value: unknown, valueType: string, from: { provenance: string; sourcePinId?: string; sourceItemRef?: string }): void => {
    const corrected = from.provenance === "client_corrected";
    out.push({
      fieldKey, value, valueType, answerState: "ANSWERED", provenanceStage: corrected ? "client_corrected" : "client_answered", confidence: null, supersedes: corrected,
      ...(from.sourcePinId ? { sourcePinId: from.sourcePinId, ...(from.sourceItemRef ? { sourceItemRef: from.sourceItemRef } : {}) } : {}), idempotencyKey: `${turnKey}:${fieldKey}`,
    });
  };
  const obj = frame.items["project.objective"];
  if (obj?.status === "known") add("pa_project_objective", obj.display, "text", obj);
  const dest = [...new Set(frame.countries.filter((c) => c.role === "operation").map((c) => c.code))];
  if (dest.length > 0) add("pa_destination_countries", dest, "country_list", { provenance: frame.countries.find((c) => c.role === "operation")?.provenance ?? "client_stated" });
  const prod = frame.items["product.what"];
  if (prod?.status === "known") add("pa_expansion_product_or_service", prod.display, "text", prod);
  const ent = frame.items["entity.form"];
  if (ent?.status === "known") add("pa_operating_entity", ent.display, "text", ent);
  const tf = frame.items["project.timeframe"];
  const m = tf?.status === "known" ? /^(\d{4})-(\d{2})/.exec(String(tf.value)) : null;
  if (tf && m) add("pa_time_window", `${m[1]}-${m[2]}`, "date", tf);
  return out;
}
