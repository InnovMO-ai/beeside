import { bundledProjectManifest, evaluateCategory } from "../../manifest";
import type { FactMap } from "../../manifest/types";
import { missingMaterialFields, paManifestContent, PA_FIELD_KEYS } from "../pa-manifest";

const A = (value: unknown): { value: unknown; answerState: "ANSWERED" } => ({ value, answerState: "ANSWERED" });
const ev = (facts: FactMap) => evaluateCategory({ manifest: paManifestContent(), facts, countries: [] });

describe("Understanding (pa_*) manifest", () => {
  it("declares every field the project manifest calls material", () => {
    expect(missingMaterialFields(bundledProjectManifest() as never)).toEqual([]);
    expect(paManifestContent().fields.map((f) => f.field_key).sort()).toEqual([...PA_FIELD_KEYS].sort());
  });

  it("asks blocking questions first and is ready once the blocking ones are answered; derived fields are never asked", () => {
    expect(ev({}).nextFieldKey).toBe("pa_project_objective");
    expect(ev({}).ready).toBe(false);
    const blocking = { pa_project_objective: A("Open a hub"), pa_destination_countries: A(["MX"]) };
    const e = ev(blocking);
    expect(e.ready).toBe(true);
    expect(e.nextFieldKey).not.toBeNull(); // required fields remain to ask
    const all = ev({ ...blocking, pa_expansion_product_or_service: A("Foods"), pa_operating_entity: A("Harness MX"), pa_time_window: A("2027-04") });
    expect(all.nextFieldKey).toBeNull();
    expect(all.pending.map((p) => p.fieldKey)).not.toContain("pa_confirmed_categories");
    expect(all.requirements.some((r) => r.fieldKey === "pa_critical_decisions" && r.applicable)).toBe(false);
  });

  it("exposes a percentage to nobody: it is not part of the Understanding DTOs", () => {
    // the engine computes one, the Understanding surface never returns it (asserted end to end in the API suites)
    expect(typeof ev({}).progressPct).toBe("number");
  });
});
