import express from "express";
import request from "supertest";
import { createConfigVersioningRouter } from "../config-versioning/router";
import {
  ConfigVersioningError,
  ConfigVersioningService,
  translateDbError,
} from "../config-versioning/service";

function fakeService(overrides: Partial<ConfigVersioningService> = {}): ConfigVersioningService {
  const notImplemented = () => Promise.reject(new Error("not expected in this test"));
  return {
    createDraft: jest.fn().mockResolvedValue(undefined),
    updateDraft: notImplemented,
    submitForPreview: notImplemented,
    returnToDraft: notImplemented,
    recordReview: notImplemented,
    publish: notImplemented,
    setCurrent: notImplemented,
    currentVersions: notImplemented,
    listVersions: notImplemented,
    getVersion: notImplemented,
    ...overrides,
  } as ConfigVersioningService;
}

function app(service: ConfigVersioningService, actor: string | null = "admin-1") {
  const instance = express();
  instance.use(express.json());
  instance.use(createConfigVersioningRouter({ service, resolveAdminActor: async () => actor }));
  return instance;
}

describe("config versioning router", () => {
  it("rejects unauthenticated requests before touching the service", async () => {
    const service = fakeService();
    const res = await request(app(service, null)).post("/config/question-bank/versions").send({ version: "v1", config: {} });
    expect(res.status).toBe(401);
    expect(service.createDraft).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown registry", async () => {
    const res = await request(app(fakeService())).get("/config/pricing/versions");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("UNKNOWN_REGISTRY");
  });

  it("validates the request body", async () => {
    const res = await request(app(fakeService())).post("/config/rules-engine/versions").send({ version: "v1", config: [] });
    expect(res.status).toBe(400);
  });

  it("passes registry, version, bundle and authenticated actor to the service", async () => {
    const service = fakeService();
    const res = await request(app(service, "admin-7"))
      .post("/config/snapshot-template/versions")
      .send({ version: "st-1", config: { schema_version: 1 } });
    expect(res.status).toBe(201);
    expect(service.createDraft).toHaveBeenCalledWith("SNAPSHOT_TEMPLATE", "st-1", { schema_version: 1 }, "admin-7");
  });

  it("maps a refused publication gate to 409 with its error code", async () => {
    const service = fakeService({
      publish: () => Promise.reject(new ConfigVersioningError("GATE_REFUSED", "publish refused: no review recorded")),
    });
    const res = await request(app(service)).post("/config/rules-engine/versions/re-2/publish");
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "GATE_REFUSED", message: "publish refused: no review recorded" });
  });

  it("translates the database SQLSTATE contract into service error codes", () => {
    const cases: Array<[string, string]> = [
      ["BV403", "FORBIDDEN"],
      ["BV404", "NOT_FOUND"],
      ["BV409", "INVALID_TRANSITION"],
      ["BV412", "GATE_REFUSED"],
      ["BV422", "VALIDATION_FAILED"],
      ["23505", "CONFLICT"],
    ];
    for (const [sqlstate, code] of cases) {
      const translated = translateDbError(Object.assign(new Error("db"), { code: sqlstate }));
      expect(translated).toBeInstanceOf(ConfigVersioningError);
      expect((translated as ConfigVersioningError).code).toBe(code);
    }
    const other = new Error("connection lost");
    expect(translateDbError(other)).toBe(other);
  });
});
