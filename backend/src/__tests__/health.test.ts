import request from "supertest";
import { createApp } from "../index";

describe("GET /health", () => {
  it("returns 200 with service liveness payload", async () => {
    const app = createApp();
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("beeside-backend");
    expect(typeof res.body.timestamp).toBe("string");
  });

  it("reports the running NODE_ENV so environment identity is externally verifiable", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    const app = createApp();

    const res = await request(app).get("/health");

    expect(res.body.environment).toBe("test");
    process.env.NODE_ENV = previous;
  });
});
