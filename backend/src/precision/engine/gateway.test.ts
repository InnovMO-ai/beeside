import {
  chat,
  chatJSON,
  gatewayConfigFromEnv,
  isGatewayConfigured,
  GatewayError,
  omitsTemperature,
  resetLearnedModelParams,
  type ChatMessage,
  type FetchLike,
  type GatewayConfig,
} from "./gateway";

function okResponse(content: string) {
  return { status: 200, ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

function httpErrorResponse(status: number) {
  return { status, ok: false, json: async () => ({}) };
}

const BASE_CONFIG: GatewayConfig = {
  chain: [
    { provider: "primary", model: "model-a", endpoint: "https://primary.example/v1/chat", apiKeyEnvVar: "P_KEY" },
    { provider: "secondary", model: "model-b", endpoint: "https://secondary.example/v1/chat", apiKeyEnvVar: "S_KEY" },
  ],
  timeoutMs: 5000,
};

const ENV = { P_KEY: "p-secret", S_KEY: "s-secret" };

const MESSAGES: ChatMessage[] = [{ role: "user", content: "hello" }];

describe("gatewayConfigFromEnv / isGatewayConfigured", () => {
  it("builds an empty chain when no targets are fully configured", () => {
    const config = gatewayConfigFromEnv({});
    expect(isGatewayConfigured(config)).toBe(false);
    expect(config.chain).toHaveLength(0);
  });

  it("includes only targets with model, endpoint, and api key all present", () => {
    const config = gatewayConfigFromEnv({
      PRECISION_GATEWAY_PRIMARY_MODEL: "m1",
      PRECISION_GATEWAY_PRIMARY_ENDPOINT: "https://x.example/v1",
      PRECISION_GATEWAY_PRIMARY_API_KEY: "key",
      PRECISION_GATEWAY_SECONDARY_MODEL: "m2",
      // missing endpoint/key for secondary -> excluded
    });
    expect(config.chain).toHaveLength(1);
    expect(config.chain[0]?.provider).toBe("primary");
  });

  it("falls back to the default timeout when the env value is not a valid number", () => {
    const config = gatewayConfigFromEnv({ PRECISION_GATEWAY_TIMEOUT_MS: "not-a-number" });
    expect(config.timeoutMs).toBe(20_000);
  });
});

describe("chat()", () => {
  it("returns a usable response from the first target with no prior attempts", async () => {
    const fetchImpl: FetchLike = async () => okResponse("hi there");
    const result = await chat(MESSAGES, BASE_CONFIG, {}, { fetchImpl, env: ENV });
    expect(result.content).toBe("hi there");
    expect(result.provider).toBe("primary");
    expect(result.attempts).toHaveLength(0);
  });

  it("falls back to the second target when the first returns an HTTP error", async () => {
    let call = 0;
    const fetchImpl: FetchLike = async () => {
      call += 1;
      return call === 1 ? httpErrorResponse(500) : okResponse("from secondary");
    };
    const result = await chat(MESSAGES, BASE_CONFIG, {}, { fetchImpl, env: ENV });
    expect(result.provider).toBe("secondary");
    expect(result.content).toBe("from secondary");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.errorCode).toBe("http_error");
  });

  it("throws GatewayError(not_configured) when the chain is empty", async () => {
    const empty: GatewayConfig = { chain: [], timeoutMs: 1000 };
    await expect(chat(MESSAGES, empty)).rejects.toMatchObject({ name: "GatewayError", kind: "not_configured" });
  });

  it("throws GatewayError(chain_exhausted) with every attempt recorded when all targets fail", async () => {
    const fetchImpl: FetchLike = async () => httpErrorResponse(503);
    try {
      await chat(MESSAGES, BASE_CONFIG, {}, { fetchImpl, env: ENV });
      throw new Error("expected chat() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GatewayError);
      const gatewayErr = err as GatewayError;
      expect(gatewayErr.kind).toBe("chain_exhausted");
      expect(gatewayErr.attempts).toHaveLength(2);
      expect(gatewayErr.attempts.map((a) => a.provider)).toEqual(["primary", "secondary"]);
    }
  });

  it("skips a target whose API key is missing from env, recording a not_configured attempt", async () => {
    const fetchImpl: FetchLike = async () => okResponse("from secondary only");
    const result = await chat(MESSAGES, BASE_CONFIG, {}, { fetchImpl, env: { S_KEY: "s-secret" } });
    expect(result.provider).toBe("secondary");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.errorCode).toBe("not_configured");
  });

  it("classifies an aborted/timed-out attempt as errorCode: timeout and still falls back", async () => {
    let call = 0;
    const fetchImpl: FetchLike = async () => {
      call += 1;
      if (call === 1) {
        const err = new Error("The operation timed out.");
        err.name = "TimeoutError";
        throw err;
      }
      return okResponse("second target answered");
    };
    const result = await chat(MESSAGES, BASE_CONFIG, {}, { fetchImpl, env: ENV });
    expect(result.provider).toBe("secondary");
    expect(result.attempts[0]?.errorCode).toBe("timeout");
  });

  it("classifies a response with no usable message content as invalid_response", async () => {
    const fetchImpl: FetchLike = async () => ({ status: 200, ok: true, json: async () => ({ choices: [] }) });
    await expect(chat(MESSAGES, BASE_CONFIG, {}, { fetchImpl, env: ENV })).rejects.toMatchObject({
      kind: "chain_exhausted",
    });
  });
});

describe("chatJSON()", () => {
  it("parses a usable JSON response", async () => {
    const fetchImpl: FetchLike = async () => okResponse('{"ok":true,"value":42}');
    const result = await chatJSON<{ ok: boolean; value: number }>(MESSAGES, BASE_CONFIG, {}, { fetchImpl, env: ENV });
    expect(result.data).toEqual({ ok: true, value: 42 });
    expect(result.provider).toBe("primary");
  });

  it("throws GatewayError(chain_exhausted) when the usable response is not valid JSON", async () => {
    const fetchImpl: FetchLike = async () => okResponse("not json at all");
    await expect(chatJSON(MESSAGES, BASE_CONFIG, {}, { fetchImpl, env: ENV })).rejects.toMatchObject({
      kind: "chain_exhausted",
    });
  });
});

describe("model parameter policy (temperature)", () => {
  const bodyOf = (init: { body?: string }) => JSON.parse(init.body ?? "{}") as Record<string, unknown>;
  const cfg = (model: string): GatewayConfig => ({ chain: [{ provider: "primary", model, endpoint: "https://primary.example/v1/chat", apiKeyEnvVar: "P_KEY" }], timeoutMs: 5000 });
  beforeEach(() => resetLearnedModelParams());

  it("never sends temperature to a model of the family that rejects it", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchLike = async (_u, init) => { seen.push(bodyOf(init)); return okResponse("ok"); };
    await chat(MESSAGES, cfg("claude-sonnet-5-5"), { temperature: 0, maxTokens: 8 }, { fetchImpl, env: ENV });
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty("temperature");
    expect(seen[0]).toMatchObject({ max_tokens: 8 });
  });

  it("sends temperature to other models, and honours the env override list", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchLike = async (_u, init) => { seen.push(bodyOf(init)); return okResponse("ok"); };
    await chat(MESSAGES, cfg("model-a"), { temperature: 0.2 }, { fetchImpl, env: ENV });
    expect(seen[0]).toMatchObject({ temperature: 0.2 });
    expect(omitsTemperature("custom-model", { PRECISION_GATEWAY_OMIT_TEMPERATURE: "x, custom-model" })).toBe(true);
    expect(omitsTemperature("custom-model", {})).toBe(false);
  });

  it("learns from an HTTP 400 that names temperature: retries once without it and remembers the model", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetchImpl: FetchLike = async (_u, init) => {
      const b = bodyOf(init); seen.push(b);
      if ("temperature" in b) return { status: 400, ok: false, json: async () => ({}), text: async () => '{"error":"temperature is deprecated for this model"}' };
      return okResponse("fine");
    };
    const r1 = await chat(MESSAGES, cfg("future-model"), { temperature: 0 }, { fetchImpl, env: ENV });
    expect(r1.content).toBe("fine");
    expect(seen).toHaveLength(2);
    await chat(MESSAGES, cfg("future-model"), { temperature: 0 }, { fetchImpl, env: ENV });
    expect(seen).toHaveLength(3); // second call goes straight without temperature
    expect(seen[2]).not.toHaveProperty("temperature");
  });

  it("does not retry a 400 that is not about temperature", async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => { calls++; return { status: 400, ok: false, json: async () => ({}), text: async () => "bad request" }; };
    await expect(chat(MESSAGES, cfg("model-a"), { temperature: 0 }, { fetchImpl, env: ENV })).rejects.toBeInstanceOf(GatewayError);
    expect(calls).toBe(1);
  });
});
