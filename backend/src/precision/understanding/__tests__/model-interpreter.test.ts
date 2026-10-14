import { ModelUnavailableError, type ModelProvider } from "../../conversation/ports";
import { ScriptedModelProvider } from "../../conversation";
import { coerceInterpretation, createModelInterpreter, mergeInterpretations } from "../model-interpreter";
import { emptyFrame } from "../types";
import { govern } from "../governor";
import { interpretByRules } from "../interpreter";

const frame = emptyFrame("es");
const REQ = { text: "Somos 60 personas y necesitamos marketing.", locale: "es" as const, frame, asked: null, turnKey: "turn-000001" };

describe("the model reads, the governor decides", () => {
  it("coerces defensively: malformed parts are dropped, nothing throws", () => {
    expect(coerceInterpretation(null)).toBeNull();
    expect(coerceInterpretation("hola")).toBeNull();
    const i = coerceInterpretation({ intent: "nonsense", observations: [{ key: "workforce.headcount", value: { min: 60, max: 60 }, quote: "60 personas" }, { value: 1 }, 7], needs: [{ text: "marketing", conceptIds: ["marketing"], quote: "marketing" }, { nope: true }], countries: [{ code: "mx", role: "weird", quote: "México" }, { code: "México" }] })!;
    expect(i.intent).toBe("unclear");
    expect(i.observations).toHaveLength(1);
    expect(i.needs).toHaveLength(1);
    expect(i.countries).toEqual([expect.objectContaining({ code: "MX", role: "unspecified" })]);
  });

  it("an invented quote or an unknown aspect is rejected by the governor, never recorded", () => {
    const model = coerceInterpretation({ observations: [{ key: "workforce.headcount", value: { min: 500, max: 500 }, display: "500 personas", quote: "quinientas personas", interpretive: "observed" }, { key: "made.up", value: 1, quote: "60 personas" }] })!;
    const g = govern(model, { text: REQ.text, source: "client" });
    expect(g.interpretation.observations).toEqual([]);
    expect(g.rejected.map((r) => r.reason)).toEqual(expect.arrayContaining(["quote_not_in_text", "unknown_probe"]));
  });

  it("uses the model's reading and completes it with the rule baseline", async () => {
    const provider = new ScriptedModelProvider({ fixture: { "understanding:interpret": { interpret: { intent: "answer", needs: [{ text: "marketing", conceptIds: ["marketing"], quote: "marketing", resolution: "resolved" }] } } } });
    const r = await createModelInterpreter({ provider }).interpret(REQ);
    expect(r.source).toBe("model");
    expect(r.needs.some((n) => n.conceptIds.includes("marketing"))).toBe(true);
    expect(r.observations.some((o) => o.key === "workforce.headcount")).toBe(true); // from the rules: the model did not find it
  });

  it("a model outage or an unreadable answer never loses the turn: the rules answer", async () => {
    const reasons: string[] = [];
    const down: ModelProvider = { describe: () => ({ port: "model_provider", implementation: "x", mode: "SIMULATED", verification: "NOT_VERIFIED", note: "" }), complete: async () => { throw new ModelUnavailableError("timeout"); } };
    const a = await createModelInterpreter({ provider: down, onFallback: (x) => reasons.push(x) }).interpret(REQ);
    expect(a.observations.some((o) => o.key === "workforce.headcount")).toBe(true);
    const b = await createModelInterpreter({ provider: new ScriptedModelProvider({ fixture: { "understanding:interpret": { interpret: "garbage" } } }), onFallback: (x) => reasons.push(x) }).interpret(REQ);
    expect(b.needs.some((n) => n.conceptIds.includes("marketing"))).toBe(true);
    expect(reasons).toEqual(["unavailable", "unreadable"]);
  });

  it("merge: the model wins where both speak; the rules never duplicate", () => {
    const rules = interpretByRules({ text: REQ.text, locale: "es", frame, asked: null, source: "client" });
    const model = coerceInterpretation({ intent: "answer", observations: [{ key: "workforce.headcount", value: { min: 60, max: 70 }, display: "60 a 70", quote: "60 personas", interpretive: "understood" }] })!;
    const m = mergeInterpretations(model, rules);
    expect(m.observations.filter((o) => o.key === "workforce.headcount")).toHaveLength(1);
    expect(m.observations.find((o) => o.key === "workforce.headcount")?.value).toEqual({ min: 60, max: 70 });
  });
});
