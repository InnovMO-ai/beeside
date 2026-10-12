import { FaError } from "../../../fa/services/errors";
import { ConversationInputError } from "../../conversation/types";
import { ApiError, ERROR_STATUS, classifyError, errorBody } from "../errors";

describe("Precision API error mapping", () => {
  it("maps known failures to stable codes", () => {
    expect(classifyError(new ConversationInputError("INVALID_INPUT", "x")).code).toBe("INVALID_INPUT");
    expect(classifyError(new ConversationInputError("NOT_WRITABLE", "x")).code).toBe("CONFLICT");
    expect(classifyError(new FaError("NOT_FOUND", "x")).code).toBe("NOT_FOUND");
    expect(classifyError(Object.assign(new Error("boom"), { code: "BV409" })).code).toBe("CONFLICT");
    expect(classifyError(Object.assign(new Error("boom"), { code: "BV404" })).code).toBe("NOT_FOUND");
    expect(classifyError(Object.assign(new Error("invalid uuid"), { code: "22P02" })).code).toBe("INVALID_INPUT");
    expect(classifyError(Object.assign(new Error("too big"), { type: "entity.too.large" })).code).toBe("INVALID_INPUT");
  });

  it("everything unknown is a generic, retryable failure that carries no detail", () => {
    for (const err of [new Error("password authentication failed for user beeside at 10.0.0.5:5432"), "raw string", null, { stack: "at x (/srv/app.js:1:1)" }]) {
      const e = classifyError(err);
      expect(e.code).toBe("TEMPORARILY_UNAVAILABLE");
      expect(e.retryable).toBe(true);
      expect(JSON.stringify(errorBody(e, "en"))).not.toMatch(/password|10\.0\.0\.5|stack|srv/);
    }
  });

  it("bodies are localized and have exactly error, message and retryable (support only when given)", () => {
    for (const code of Object.keys(ERROR_STATUS) as Array<keyof typeof ERROR_STATUS>) {
      const en = errorBody(new ApiError(code), "en");
      const es = errorBody(new ApiError(code), "es");
      expect(Object.keys(en).sort()).toEqual(["error", "message", "retryable"]);
      expect(en.message).not.toBe(es.message);
      expect(en.message).not.toMatch(/\b(PSM|FA|OH|PA|BV\d{3}|JSON|SQL)\b/);
    }
    expect(errorBody(new ApiError("UNAUTHENTICATED", false, { support: { email: "contact@beeside.you" } }), "en").support).toEqual({ email: "contact@beeside.you" });
  });

  it("status codes follow the client's contract", () => {
    expect(ERROR_STATUS).toMatchObject({ UNAUTHENTICATED: 401, PRECISION_READ_ONLY: 403, PRECISION_REVOKED: 403, NOT_FOUND: 404, INVALID_INPUT: 400, CONFLICT: 409, PREVIEW_STALE: 409, ACTIVATION_PENDING_RETRY_FIRST: 409, NOT_READY: 409, RATE_LIMITED: 429 });
  });
});
