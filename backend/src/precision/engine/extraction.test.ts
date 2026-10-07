import { coerceValue, extractFields, type FieldSpec } from "./extraction";
import type { FetchLike, GatewayConfig } from "./gateway";

const CONFIG: GatewayConfig = {
  chain: [{ provider: "primary", model: "extractor-model", endpoint: "https://primary.example/v1/chat", apiKeyEnvVar: "P_KEY" }],
  timeoutMs: 5000,
};
const ENV = { P_KEY: "p-secret" };

function jsonResponse(payload: unknown) {
  return { status: 200, ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) };
}
function textResponse(content: string) {
  return { status: 200, ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}
function httpErrorResponse(status: number) {
  return { status, ok: false, json: async () => ({}) };
}

describe("coerceValue", () => {
  it("passes through a matching string", () => {
    expect(coerceValue("string", "Mexico City")).toEqual({ ok: true, value: "Mexico City" });
  });

  it("safely coerces a number to a string", () => {
    expect(coerceValue("string", 42)).toEqual({ ok: true, value: "42" });
  });

  it("parses a numeric string to a number", () => {
    expect(coerceValue("number", "123.5")).toEqual({ ok: true, value: 123.5 });
  });

  it("refuses to coerce a non-numeric string to a number", () => {
    expect(coerceValue("number", "about a hundred")).toEqual({ ok: false });
  });

  it("normalizes a boolean-like string", () => {
    expect(coerceValue("boolean", "TRUE")).toEqual({ ok: true, value: true });
  });

  it("refuses an ambiguous boolean string", () => {
    expect(coerceValue("boolean", "maybe")).toEqual({ ok: false });
  });

  it("accepts an ISO date string", () => {
    expect(coerceValue("date", "2026-10-03")).toEqual({ ok: true, value: "2026-10-03" });
  });

  it("refuses a non-ISO date string rather than guessing the format", () => {
    expect(coerceValue("date", "10/03/2026")).toEqual({ ok: false });
  });

  it("matches an enum value exactly", () => {
    expect(coerceValue("enum", "sole_proprietorship", ["sole_proprietorship", "corporation"])).toEqual({
      ok: true,
      value: "sole_proprietorship",
    });
  });

  it("normalizes enum casing to the canonical declared value", () => {
    expect(coerceValue("enum", "CORPORATION", ["sole_proprietorship", "corporation"])).toEqual({ ok: true, value: "corporation" });
  });

  it("refuses an enum value outside the declared set", () => {
    expect(coerceValue("enum", "partnership", ["sole_proprietorship", "corporation"])).toEqual({ ok: false });
  });
});

describe("extractFields — ok / not_found / unresolved three-state outcome", () => {
  const specs: FieldSpec[] = [
    { name: "entity_type", type: "enum", description: "Legal entity type", enumValues: ["corporation", "branch"] },
    { name: "employee_count", type: "number", description: "Number of employees" },
    { name: "incorporation_date", type: "date", description: "Date of incorporation" },
  ];

  it("resolves a field to status 'ok' with value/confidence/source when the model finds it", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        entity_type: { status: "found", value: "corporation", confidence: 0.9, source: "we are a corporation" },
        employee_count: { status: "not_found" },
        incorporation_date: { status: "not_found" },
      });
    const result = await extractFields(specs, "context text", CONFIG, { fetchImpl, env: ENV });
    const entityField = result.fields.find((f) => f.name === "entity_type");
    expect(entityField).toMatchObject({ status: "ok", value: "corporation", confidence: 0.9, source: "we are a corporation" });
    expect(result.attemptedRetry).toBe(false);
  });

  it("resolves a field to status 'not_found' when the model explicitly reports absence", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        entity_type: { status: "not_found" },
        employee_count: { status: "not_found" },
        incorporation_date: { status: "not_found" },
      });
    const result = await extractFields(specs, "context text", CONFIG, { fetchImpl, env: ENV });
    expect(result.fields.find((f) => f.name === "employee_count")).toMatchObject({ status: "not_found", value: null });
  });

  it("resolves a field to 'unresolved' when it is missing from the model's output entirely", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        entity_type: { status: "not_found" },
        // employee_count omitted entirely
        incorporation_date: { status: "not_found" },
      });
    const result = await extractFields(specs, "context text", CONFIG, { fetchImpl, env: ENV });
    const field = result.fields.find((f) => f.name === "employee_count");
    expect(field?.status).toBe("unresolved");
    expect(field?.reason).toContain("missing from model output");
  });

  it("resolves a field to 'unresolved' (never a guess) when the value can't be safely coerced", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        entity_type: { status: "found", value: "partnership" }, // not in the declared enum
        employee_count: { status: "not_found" },
        incorporation_date: { status: "not_found" },
      });
    const result = await extractFields(specs, "context text", CONFIG, { fetchImpl, env: ENV });
    const field = result.fields.find((f) => f.name === "entity_type");
    expect(field?.status).toBe("unresolved");
    expect(field?.value).toBeNull();
    expect(field?.reason).toContain("coerced");
  });
});

describe("extractFields — malformed output shape retry (single retry, shape only)", () => {
  const specs: FieldSpec[] = [{ name: "country", type: "string", description: "Destination country" }];

  it("retries once when the first response is not valid JSON, and succeeds on the second", async () => {
    let call = 0;
    const fetchImpl: FetchLike = async () => {
      call += 1;
      return call === 1 ? textResponse("not json at all") : jsonResponse({ country: { status: "found", value: "Mexico" } });
    };
    const result = await extractFields(specs, "context", CONFIG, { fetchImpl, env: ENV });
    expect(result.attemptedRetry).toBe(true);
    expect(result.fields[0]).toMatchObject({ status: "ok", value: "Mexico" });
    expect(call).toBe(2);
  });

  it("retries once when the first response parses to a non-object (array) shape", async () => {
    let call = 0;
    const fetchImpl: FetchLike = async () => {
      call += 1;
      return call === 1 ? jsonResponse(["unexpected", "array"]) : jsonResponse({ country: { status: "found", value: "Mexico" } });
    };
    const result = await extractFields(specs, "context", CONFIG, { fetchImpl, env: ENV });
    expect(result.attemptedRetry).toBe(true);
    expect(result.fields[0]?.status).toBe("ok");
  });

  it("stops after exactly one retry: still malformed on the second attempt yields unresolved, not a third call", async () => {
    let call = 0;
    const fetchImpl: FetchLike = async () => {
      call += 1;
      return textResponse("still not json");
    };
    const result = await extractFields(specs, "context", CONFIG, { fetchImpl, env: ENV });
    expect(result.attemptedRetry).toBe(true);
    expect(result.fields[0]).toMatchObject({ status: "unresolved" });
    expect(result.fields[0]?.reason).toContain("after one retry");
    expect(call).toBe(2);
  });
});

describe("extractFields — gateway unavailability is not treated as a shape problem", () => {
  const specs: FieldSpec[] = [{ name: "country", type: "string", description: "Destination country" }];

  it("does not retry when the whole chain fails on network/HTTP grounds (not a shape issue)", async () => {
    let call = 0;
    const fetchImpl: FetchLike = async () => {
      call += 1;
      return httpErrorResponse(500);
    };
    const result = await extractFields(specs, "context", CONFIG, { fetchImpl, env: ENV });
    expect(result.attemptedRetry).toBe(false);
    expect(result.fields[0]).toMatchObject({ status: "unresolved" });
    expect(result.fields[0]?.reason).toContain("gateway unavailable");
    expect(call).toBe(1);
  });

  it("reports unresolved for every requested field, never throwing, when the gateway has no configured targets", async () => {
    const unconfigured: GatewayConfig = { chain: [], timeoutMs: 1000 };
    const result = await extractFields(specs, "context", unconfigured);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0]?.status).toBe("unresolved");
  });
});
