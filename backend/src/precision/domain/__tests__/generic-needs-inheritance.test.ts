import { bundledCategoryManifest } from "../../manifest/bundled";
import { emptyFrame, type Frame, type NeedItem } from "../../understanding/types";
import { deriveGenericNeeds, mergeGenericItems, planInheritance } from "../category-inheritance";
import { planFrameMap } from "../frame-map";

const generic = new Map(bundledCategoryManifest("_generic")!.fields.map((f) => [f.field_key, f]));
const authored = new Map(bundledCategoryManifest("logistics")!.fields.map((f) => [f.field_key, f]));
const need = (over: Partial<NeedItem>): NeedItem => ({ id: "n1", text: "Queremos estudiar si nuestros clientes en México aceptarían un modelo de suscripción", conceptIds: [], resolution: "unresolved", categoryKey: null, serviceKeys: [], status: "confirmed", origin: "narrative", at: "2026-10-15T00:00:00.000Z", ...over });
function frameWith(needs: NeedItem[], rank: "top" | "important" | "can_wait" = "top", why?: string): Frame {
  const f = emptyFrame("es");
  f.needs = needs;
  f.priority = { status: "client_set", askedCount: 1, groups: [{ rank, subjects: needs.map((n) => n.id), ...(why ? { reason: why } : {}) }] };
  return f;
}
const keyOf = (f: Frame): string => planFrameMap(f).needs[0]!.categoryKey;

describe("generic categories start from what the project already knows", () => {
  it("seeds the need in the client's words, the reason they gave and the priority they set", () => {
    const f = frameWith([need({ why: "Queremos decidir si abrimos otro canal de ingresos" })]);
    const out = deriveGenericNeeds(f, keyOf(f), generic as never);
    const g = out.find((x) => x.fieldKey === "generic_needs")!;
    expect(keyOf(f)).toMatch(/^new:/);
    expect(g.value).toEqual([{ need_description: "Queremos estudiar si nuestros clientes en México aceptarían un modelo de suscripción", problem: "Queremos decidir si abrimos otro canal de ingresos", urgency: "high" }]);
    expect(g.provenance).toBe("client_answered");
    expect(out.find((x) => x.fieldKey === "generic_classification_confirmed")?.value).toBe(true);
  });
  it("never inherits an AI proposal, a removed need, an implied one, or anything for a category with an authored manifest", () => {
    const f = frameWith([need({ origin: "implied" })]);
    expect(deriveGenericNeeds(f, keyOf(f), generic as never)).toEqual([]);
    const r = frameWith([need({ status: "removed" })]);
    expect(deriveGenericNeeds(r, "new:otra", generic as never)).toEqual([]);
    expect(deriveGenericNeeds(frameWith([need({})]), "logistics", authored as never)).toEqual([]);
  });
  it("is deterministic and a proposed (unconfirmed) need seeds the description but does not confirm the classification", () => {
    const f = frameWith([need({ status: "proposed" })], "can_wait");
    const a = deriveGenericNeeds(f, keyOf(f), generic as never);
    expect(JSON.stringify(a)).toBe(JSON.stringify(deriveGenericNeeds(f, keyOf(f), generic as never)));
    expect((a[0]!.value as Array<{ urgency: string }>)[0]!.urgency).toBe("low");
    expect(a.find((x) => x.fieldKey === "generic_classification_confirmed")).toBeUndefined();
  });
  it("merging only fills what is empty: the client's own answers in the category stand, new needs are appended", () => {
    const merged = mergeGenericItems(
      [{ need_description: "Estudio de suscripción", objective: "Validar el modelo", urgency: "low" }],
      [{ need_description: " estudio de  suscripción ", urgency: "high", problem: "Nuevo canal" }, { need_description: "Otra necesidad" }],
    );
    expect(merged).toEqual([{ need_description: "Estudio de suscripción", objective: "Validar el modelo", urgency: "low", problem: "Nuevo canal" }, { need_description: "Otra necesidad" }]);
  });
  it("planInheritance: writes into an empty category; after add-service already wrote the bare need it enriches without a conflict, then is idempotent", () => {
    const f = frameWith([need({ why: "Nuevo canal de ingresos" })]);
    const cands = deriveGenericNeeds(f, keyOf(f), generic as never);
    const p1 = planInheritance(cands, {});
    expect(p1.writes.map((w) => w.fieldKey)).toEqual(expect.arrayContaining(["generic_needs", "generic_classification_confirmed"]));
    const bare = { generic_needs: { value: [{ need_description: need({}).text }], answerState: "ANSWERED", provenance: "client_confirmed" } } as never;
    const p2 = planInheritance(cands, bare);
    expect(Object.keys(p2.ledger.conflicts)).toEqual([]);
    expect((p2.nextFacts.generic_needs!.value as Array<Record<string, unknown>>)[0]).toMatchObject({ problem: "Nuevo canal de ingresos", urgency: "high" });
    const p3 = planInheritance(cands, p2.nextFacts);
    expect(p3.writes).toEqual([]);
    // the client edits the urgency in the category: the frame never overwrites it
    const edited = { ...p2.nextFacts, generic_needs: { ...p2.nextFacts.generic_needs!, value: [{ ...(p2.nextFacts.generic_needs!.value as Array<Record<string, unknown>>)[0]!, urgency: "low" }] } } as never;
    const p4 = planInheritance(cands, edited);
    expect(p4.writes).toEqual([]);
    expect((p4.nextFacts.generic_needs!.value as Array<{ urgency: string }>)[0]!.urgency).toBe("low");
  });
});
