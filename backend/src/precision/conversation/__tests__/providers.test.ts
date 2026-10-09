/**
 * Provider tests. The gateway provider runs against an injected fake `fetch` and a DUMMY key placed in an
 * injected env object (never process.env, never a real credential). Nothing here touches the network.
 */
import type { FetchLike } from "../../engine/gateway";
import { cleanModelText, GatewayModelProvider } from "../providers/gateway-model";
import { providerNameFromEnv, selectModelProvider } from "../providers/select";
import { ScriptedModelProvider } from "../providers/scripted-model";
import { ModelUnavailableError, type ExtractRequest, type FieldBrief, type RouteRequest, type WriteRequest } from "../ports";

const DUMMY_ENV = {
  PRECISION_GATEWAY_PRIMARY_MODEL: "model-a",
  PRECISION_GATEWAY_PRIMARY_ENDPOINT: "https://gateway.invalid/v1/chat",
  PRECISION_GATEWAY_PRIMARY_API_KEY: "dummy-test-value",
};

function reply(content: string): ReturnType<FetchLike> {
  return Promise.resolve({ status: 200, ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
}

function fakeFetch(handler: (body: Record<string, unknown>, n: number) => ReturnType<FetchLike>): { fetchImpl: FetchLike; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const fetchImpl: FetchLike = (_url, init) => {
    const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
    calls.push(body);
    return handler(body, calls.length);
  };
  return { fetchImpl, calls };
}

const extractReq = (over: Partial<ExtractRequest> = {}): ExtractRequest => ({
  task: "extract",
  surface: "category",
  step: "dest_country",
  locale: "es",
  turnKey: "turn-key-00001",
  clientText: "Vendemos a Chile y Peru",
  question: "A que paises?",
  specs: [
    { name: "dest_country", type: "string", description: "Destination country", isTarget: true },
    { name: "mode", type: "enum", description: "Mode", enumValues: ["air", "sea"], enumLabels: { air: "Aereo", sea: "Maritimo" }, isTarget: false },
    { name: "tags", type: "multi_enum", description: "Tags", enumValues: ["a", "b", "c"], isTarget: false },
  ],
  timeoutMs: 5000,
  ...over,
});

const writeReq: WriteRequest = {
  task: "write",
  surface: "category",
  step: "dest_country",
  locale: "es",
  turnKey: "turn-key-00001",
  attempt: 1,
  intent: {
    kind: "ask_field",
    field: { fieldKey: "dest_country", label: "Pais", helpText: null, type: "string", options: [], requirementLevel: "required" },
    ack: "none",
    nextOrdinal: 1,
    recorded: null,
  },
  system: "system prompt",
  user: "user prompt",
  feedback: [],
  timeoutMs: 5000,
};

const routeReq: RouteRequest = {
  task: "route",
  surface: "category",
  step: "route",
  locale: "es",
  turnKey: "turn-key-00001",
  clientText: "como funciona esto",
  topics: [
    { topicKey: "crp", hint: "what a CRP is" },
    { topicKey: "sherpa", hint: "who helps" },
  ],
  timeoutMs: 5000,
};

describe("cleanModelText", () => {
  it("removes meta blocks, tags and wrapping quotes and collapses whitespace", () => {
    expect(cleanModelText('<meta>{"x":1}</meta>\n  "Hola   <b>mundo</b>"  ')).toBe("Hola mundo");
    expect(cleanModelText("«Texto»")).toBe("Texto");
    expect(cleanModelText("plain")).toBe("plain");
  });
});

describe("GatewayModelProvider (injected fake fetch, dummy key)", () => {
  it("describes itself as REAL / NOT_VERIFIED and reports whether a target is configured", () => {
    const configured = new GatewayModelProvider({ env: DUMMY_ENV }).describe();
    expect(configured).toMatchObject({ port: "model_provider", implementation: "gateway", mode: "REAL", verification: "NOT_VERIFIED" });
    expect(configured.note).toMatch(/configured/i);
    const bare = new GatewayModelProvider({ env: {} }).describe();
    expect(bare.mode).toBe("REAL");
    expect(bare.note).toMatch(/no target configured/i);
  });

  it("maps extraction output, splits multi_enum and reports physical calls", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      reply(
        JSON.stringify({
          dest_country: { status: "found", value: "Chile", confidence: 0.93, source: "Chile" },
          mode: { status: "not_found" },
          tags: { status: "found", value: "a, c", confidence: 0.9, source: "a y c" },
        }),
      ),
    );
    const p = new GatewayModelProvider({ env: DUMMY_ENV, deps: { fetchImpl, env: DUMMY_ENV } });
    const out = await p.complete(extractReq());
    expect(out.task).toBe("extract");
    expect(out.physicalCalls).toBe(1);
    expect(calls).toHaveLength(1);
    const byName = new Map(out.fields.map((f) => [f.name, f]));
    expect(byName.get("dest_country")).toMatchObject({ status: "ok", value: "Chile", confidence: 0.93 });
    expect(byName.get("mode")).toMatchObject({ status: "not_found", value: null });
    expect(byName.get("tags")?.value).toEqual(["a", "c"]);
    // the prompt carries the client text and the localized option labels
    const sent = JSON.stringify(calls[0]);
    expect(sent).toContain("Vendemos a Chile y Peru");
    expect(sent).toContain("Maritimo");
  });

  it("counts the engine's single malformed-shape retry as a second physical call", async () => {
    const { fetchImpl } = fakeFetch((_b, n) => (n === 1 ? reply("not json at all") : reply(JSON.stringify({ dest_country: { status: "found", value: "Chile", confidence: 0.9, source: "Chile" }, mode: { status: "not_found" }, tags: { status: "not_found" } }))));
    const p = new GatewayModelProvider({ env: DUMMY_ENV, deps: { fetchImpl, env: DUMMY_ENV } });
    const out = await p.complete(extractReq());
    expect(out.physicalCalls).toBe(2);
    expect(out.fields.find((f) => f.name === "dest_country")?.value).toBe("Chile");
  });

  it("throws ModelUnavailableError(not_configured) with no target and (exhausted) when every target fails", async () => {
    const none = new GatewayModelProvider({ env: {} });
    await expect(none.complete(extractReq())).rejects.toMatchObject({ name: "ModelUnavailableError", reason: "not_configured" });
    await expect(none.complete(writeReq)).rejects.toBeInstanceOf(ModelUnavailableError);

    const { fetchImpl } = fakeFetch(() => Promise.resolve({ status: 503, ok: false, json: async () => ({}) }));
    const p = new GatewayModelProvider({ env: DUMMY_ENV, deps: { fetchImpl, env: DUMMY_ENV } });
    await expect(p.complete(extractReq())).rejects.toMatchObject({ reason: "exhausted" });
    await expect(p.complete(writeReq)).rejects.toMatchObject({ reason: "exhausted" });
    await expect(p.complete(routeReq)).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it("reports a timeout reason when the attempt aborted by timeout", async () => {
    const { fetchImpl } = fakeFetch(() => {
      const e = new Error("aborted");
      e.name = "TimeoutError";
      return Promise.reject(e);
    });
    const p = new GatewayModelProvider({ env: DUMMY_ENV, deps: { fetchImpl, env: DUMMY_ENV } });
    await expect(p.complete(writeReq)).rejects.toMatchObject({ reason: "timeout" });
  });

  it("never leaks provider text, endpoint or key through the error", async () => {
    const { fetchImpl } = fakeFetch(() => Promise.reject(new Error("connect ECONNREFUSED gateway.invalid dummy-test-value")));
    const p = new GatewayModelProvider({ env: DUMMY_ENV, deps: { fetchImpl, env: DUMMY_ENV } });
    const err = await p.complete(writeReq).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(ModelUnavailableError);
    const text = `${(err as Error).message} ${JSON.stringify(err)}`;
    expect(text).not.toMatch(/dummy-test-value|gateway\.invalid|ECONNREFUSED/);
  });

  it("write: cleans the draft; attempt 2 uses a lower temperature", async () => {
    const { fetchImpl, calls } = fakeFetch(() => reply('"Hola, <i>cual</i> es el pais?" <meta>x</meta>'));
    const p = new GatewayModelProvider({ env: DUMMY_ENV, deps: { fetchImpl, env: DUMMY_ENV } });
    const a = await p.complete(writeReq);
    expect(a).toMatchObject({ task: "write", text: "Hola, cual es el pais?", physicalCalls: 1 });
    await p.complete({ ...writeReq, attempt: 2 });
    expect(Number(calls[0]?.temperature)).toBeGreaterThan(Number(calls[1]?.temperature));
  });

  it("route: parses a JSON array, keeps only known topic keys (max 2), tolerates garbage", async () => {
    const mk = (content: string) => new GatewayModelProvider({ env: DUMMY_ENV, deps: { fetchImpl: fakeFetch(() => reply(content)).fetchImpl, env: DUMMY_ENV } });
    expect((await mk('["crp","sherpa","invented"]').complete(routeReq)).topicKeys).toEqual(["crp", "sherpa"]);
    expect((await mk('Sure: ["invented"]').complete(routeReq)).topicKeys).toEqual([]);
    expect((await mk("no array here").complete(routeReq)).topicKeys).toEqual([]);
    expect((await mk("[broken").complete(routeReq)).topicKeys).toEqual([]);
  });
});

describe("selectModelProvider / providerNameFromEnv", () => {
  it("defaults to scripted for a missing, empty or unknown value (a typo can never reach a real model)", () => {
    for (const v of [undefined, "", "scripted", "GATEWAY", "real", "openai"]) expect(providerNameFromEnv({ PRECISION_MODEL_PROVIDER: v })).toBe("scripted");
    expect(providerNameFromEnv({})).toBe("scripted");
    expect(selectModelProvider({ env: {} }).describe()).toMatchObject({ mode: "SIMULATED", verification: "NOT_VERIFIED" });
  });

  it("selects the gateway provider only for the exact value 'gateway'", () => {
    expect(providerNameFromEnv({ PRECISION_MODEL_PROVIDER: "gateway" })).toBe("gateway");
    const p = selectModelProvider({ env: { PRECISION_MODEL_PROVIDER: "gateway" } });
    expect(p).toBeInstanceOf(GatewayModelProvider);
    expect(p.describe().mode).toBe("REAL");
  });
});

describe("ScriptedModelProvider", () => {
  it("is SIMULATED / NOT_VERIFIED through describe() and says so nowhere else", async () => {
    const p = new ScriptedModelProvider();
    expect(p.describe()).toMatchObject({ port: "model_provider", mode: "SIMULATED", verification: "NOT_VERIFIED" });
    const out = await p.complete(writeReq);
    expect(out.text).not.toMatch(/scripted|simulat|mock|fake|stub/i);
  });

  it("is deterministic: the same request twice gives identical output, and calls are recorded", async () => {
    const a = new ScriptedModelProvider();
    const b = new ScriptedModelProvider();
    const x1 = await a.complete(extractReq());
    const x2 = await b.complete(extractReq());
    const w1 = await a.complete(writeReq);
    const w2 = await b.complete(writeReq);
    expect(x1).toEqual(x2);
    expect(w1).toEqual(w2);
    expect(a.calls).toHaveLength(2);
  });

  it("failNext makes the next n calls throw ModelUnavailableError with the given reason, then recovers", async () => {
    const p = new ScriptedModelProvider();
    p.failNext(2, "timeout");
    await expect(p.complete(writeReq)).rejects.toMatchObject({ reason: "timeout" });
    await expect(p.complete(writeReq)).rejects.toMatchObject({ reason: "timeout" });
    await expect(p.complete(writeReq)).resolves.toMatchObject({ task: "write" });
  });

  it("serves fixture entries by (surface:step), then surface:*, then *", async () => {
    const p = new ScriptedModelProvider({
      fixture: {
        "category:dest_country": { write: "especifico" },
        "category:*": { write: "superficie" },
        "*": { write: "global" },
      },
    });
    expect((await p.complete(writeReq)).text).toBe("especifico");
    expect((await p.complete({ ...writeReq, step: "otro" })).text).toBe("superficie");
    expect((await p.complete({ ...writeReq, surface: "understanding" })).text).toBe("global");
  });
});

describe("ScriptedModelProvider extraction: one piece of text answers one field", () => {
  const countrySpec = (name: string, role: string, isTarget: boolean) => ({ name, type: "multi_enum" as const, description: `${role}. List of countries (ISO 3166-1 alpha-2 country codes)`, isTarget });
  const lane = (clientText: string, targetRole: "Origin country" | "Destination country"): Record<string, unknown> => {
    const specs = [
      countrySpec("logistics_flows__origin_country", "Origin country", targetRole === "Origin country"),
      countrySpec("logistics_flows__destination_country", "Destination country", targetRole === "Destination country"),
    ];
    return { specs, clientText };
  };
  const run = async (over: Record<string, unknown>): Promise<Map<string, { status: string; value: unknown }>> => {
    const p = new ScriptedModelProvider();
    const out = await p.complete(extractReq(over as Partial<ExtractRequest>));
    return new Map(out.fields.map((f) => [f.name, f]));
  };

  it("a bare country answers only the field being asked, not the other end of the lane", async () => {
    const asked = await run(lane("Chile", "Origin country"));
    expect(asked.get("logistics_flows__origin_country")).toMatchObject({ status: "ok", value: ["CL"] });
    expect(asked.get("logistics_flows__destination_country")?.status).toBe("not_found");
    const dest = await run(lane("México", "Destination country"));
    expect(dest.get("logistics_flows__destination_country")).toMatchObject({ status: "ok", value: ["MX"] });
    expect(dest.get("logistics_flows__origin_country")?.status).toBe("not_found");
  });

  it.each([
    ["de Chile a México", "CL", "MX"],
    ["Salen desde Chile hacia México", "CL", "MX"],
    ["from Chile to Mexico", "CL", "MX"],
    ["We ship from Brazil into Chile", "BR", "CL"],
  ])("reads both ends of a lane told in one sentence: %s", async (text, from, to) => {
    const r = await run(lane(text, "Origin country"));
    expect(r.get("logistics_flows__origin_country")).toMatchObject({ status: "ok", value: [from] });
    expect(r.get("logistics_flows__destination_country")).toMatchObject({ status: "ok", value: [to] });
  });

  it("a role word with one country fills the matching field only when it is volunteered", async () => {
    const r = await run(lane("Salen desde Chile", "Destination country"));
    expect(r.get("logistics_flows__destination_country")?.status).toBe("not_found");
    expect(r.get("logistics_flows__origin_country")).toMatchObject({ status: "ok", value: ["CL"] });
  });

  it("a country volunteered while another field is asked still lands in a lone country field", async () => {
    const r = await run({
      clientText: "We want to enter Chile",
      specs: [
        { name: "objective", type: "string", description: "Objective", isTarget: true },
        { name: "destinations", type: "multi_enum", description: "Destination countries (ISO 3166-1 alpha-2 country codes)", isTarget: false },
      ],
    });
    expect(r.get("objective")?.status).toBe("ok");
    expect(r.get("destinations")).toMatchObject({ status: "ok", value: ["CL"] });
  });

  it("free text, yes/no and numbers are never copied into the fields that were not asked", async () => {
    const r = await run({
      clientText: "Sí",
      specs: [
        { name: "a", type: "boolean", description: "Is it needed", isTarget: true },
        { name: "b", type: "boolean", description: "Another yes/no", isTarget: false },
        { name: "c", type: "string", description: "Notes", isTarget: false },
      ],
    });
    expect(r.get("a")).toMatchObject({ status: "ok", value: true });
    expect(r.get("b")?.status).toBe("not_found");
    expect(r.get("c")?.status).toBe("not_found");
    const n = await run({
      clientText: "20 pallets",
      specs: [
        { name: "vol__value", type: "number", description: "Volume (number only)", isTarget: true },
        { name: "other", type: "number", description: "Orders per month", isTarget: false },
      ],
    });
    expect(n.get("vol__value")).toMatchObject({ status: "ok", value: 20 });
    expect(n.get("other")?.status).toBe("not_found");
  });
});

describe("ScriptedModelProvider phrasing (Voice Guide)", () => {
  interface Over { ack?: "none" | "recorded" | "corrected" | "confirmed" | "clarify"; recorded?: string | null; field: Partial<FieldBrief> & { fieldKey: string; label: string } }
  const field = (over: Over): WriteRequest => ({
    ...writeReq,
    intent: {
      kind: "ask_field",
      ack: over.ack ?? "none",
      nextOrdinal: 1,
      recorded: over.recorded ?? null,
      field: { helpText: null, type: "string", options: [], requirementLevel: "required", ...over.field },
    },
  });
  const write = async (req: WriteRequest): Promise<string> => ((await new ScriptedModelProvider().complete(req)) as { text: string }).text;

  it("asks the field's own question (bank), in the client's language, with one question mark", async () => {
    const es = await write(field({ field: { fieldKey: "logistics_warehousing_needed", label: "Dedicated warehousing needed?" } }));
    expect(es).toBe("¿Necesitas almacenamiento dedicado para este proyecto?");
    const en = await write({ ...field({ field: { fieldKey: "logistics_warehousing_needed", label: "x" } }), locale: "en" });
    expect(en).toBe("Do you need dedicated warehousing for this project?");
  });

  it("introduces a group once, then numbers the later items", async () => {
    const first = await write(field({ field: { fieldKey: "logistics_flows", subKey: "origin_country", itemIndex: 0, label: "Origin country", groupLabel: "Logistics flows" } }));
    expect(first).toBe("Describamos tus flujos de envío, uno a la vez. ¿Desde qué país salen los productos?");
    const second = await write(field({ field: { fieldKey: "logistics_flows", subKey: "origin_country", itemIndex: 1, label: "Origin country", groupLabel: "Logistics flows" } }));
    expect(second).toBe("Para el flujo 2, ¿desde qué país salen los productos?");
    const sub = await write(field({ field: { fieldKey: "logistics_flows", subKey: "destination_country", itemIndex: 1, label: "Destination country", groupLabel: "Logistics flows" } }));
    expect(sub).toBe("¿A qué país llegan?");
  });

  it("puts the reason after the question and keeps an acknowledgement short", async () => {
    const t = await write(field({ ack: "recorded", recorded: "No", field: { fieldKey: "logistics_hazardous_materials_flag", label: "Hazmat?" } }));
    expect(t).toMatch(/^(?:Anotado\.|Entendido\.|Gracias, ya lo tengo\.) ¿Alguno de tus envíos incluye materiales peligrosos o regulados\? Lo pregunto porque/);
    expect(t).not.toMatch(/Anotado: No/);
  });

  it("a clarification offers the options in one plain sentence", async () => {
    const t = await write({
      ...field({ ack: "clarify", field: { fieldKey: "logistics_operating_responsibility", label: "x", type: "enum", options: [{ value: "a", label: "Nosotros" }, { value: "b", label: "Un tercero" }] } }),
    });
    expect(t).toContain("Las opciones son Nosotros o Un tercero.");
    expect((t.match(/\?/g) ?? []).length).toBe(1);
  });

  it("a field without a bank entry gets a neutral single question from its label, never a list or a key", async () => {
    const t = await write(field({ field: { fieldKey: "some_new_field", label: "Preferred carrier", helpText: "Name one if you have it." } }));
    expect(t).toBe("¿Qué puedes indicarme sobre este punto: preferred carrier? Name one if you have it.");
    expect((t.match(/[?¿]/g) ?? []).length).toBe(2);
  });
});
