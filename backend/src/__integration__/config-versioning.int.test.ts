import express from "express";
import request from "supertest";
import { Client } from "pg";
import { createConfigVersioningRouter } from "../config-versioning/router";
import { createConfigVersioningService } from "../config-versioning/service";

/**
 * Endpoint-level proof of the publication gates against a real PostgreSQL with all migrations
 * applied. Every test runs inside a transaction that is rolled back, so nothing persists.
 * Requires TEST_DATABASE_URL; skipped otherwise (the default CI unit run has no database).
 */
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDb = databaseUrl ? describe : describe.skip;

describeWithDb("config versioning endpoints (PostgreSQL, rolled back)", () => {
  const client = new Client({ connectionString: databaseUrl });
  let admin = "";
  let supervisor = "";

  // Everything runs inside one rolled-back transaction, so each service call gets its own savepoint:
  // a refused call (e.g. 409 gate) must not abort the transaction for the following requests —
  // the same isolation a real per-request pooled connection gives in production.
  const perRequest = {
    async query(text: string, values?: unknown[]) {
      await client.query("SAVEPOINT api_call");
      try {
        const result = await client.query(text, values);
        await client.query("RELEASE SAVEPOINT api_call");
        return result;
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT api_call");
        throw err;
      }
    },
  };

  const api = () => {
    const app = express();
    app.use(express.json());
    app.use(
      createConfigVersioningRouter({
        service: createConfigVersioningService(perRequest),
        // Test-only actor resolution; Phase 10 replaces this with SSO-backed authentication.
        resolveAdminActor: async (req) => req.header("x-test-admin") ?? null,
      }),
    );
    return app;
  };

  const bundle = (greeting: string) => ({
    schema_version: 1,
    locales: ["en", "es"],
    variables: ["preferred_name"],
    copy: { en: { greeting: `${greeting} {{preferred_name}}` }, es: { greeting: `Hola {{preferred_name}} (${greeting})` } },
  });

  beforeAll(() => client.connect());
  afterAll(() => client.end());

  beforeEach(async () => {
    await client.query("BEGIN");
    const created = await client.query(
      `INSERT INTO admin_user (role, auth_identity) VALUES
         ('ADMIN', 'int-admin@beeside.internal'), ('SUPERVISOR', 'int-supervisor@beeside.internal')
       RETURNING admin_user_id, role`,
    );
    for (const row of created.rows as Array<{ admin_user_id: string; role: string }>) {
      if (row.role === "ADMIN") admin = row.admin_user_id;
      else supervisor = row.admin_user_id;
    }
  });

  afterEach(() => client.query("ROLLBACK"));

  async function draftAndPreview(version: string, greeting: string) {
    const app = api();
    const created = await request(app).post("/config/snapshot-template/versions").set("x-test-admin", admin)
      .send({ version, config: bundle(greeting) });
    expect(created.status).toBe(201);
    const preview = await request(app).post(`/config/snapshot-template/versions/${version}/preview`).set("x-test-admin", admin);
    expect(preview.status).toBe(200);
    return preview.body as { change_kind: string };
  }

  it("refuses to publish an unreviewed logic/schema bundle, then publishes after a diff review", async () => {
    const preview = await draftAndPreview("int-st-1", "Hi");
    expect(preview.change_kind).toBe("LOGIC_SCHEMA");

    const refused = await request(api()).post("/config/snapshot-template/versions/int-st-1/publish").set("x-test-admin", admin);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("GATE_REFUSED");

    const approvalWithoutDiff = await request(api()).post("/config/snapshot-template/versions/int-st-1/reviews")
      .set("x-test-admin", admin).send({ decision: "APPROVED", diffReviewed: false });
    expect(approvalWithoutDiff.status).toBe(409);

    const review = await request(api()).post("/config/snapshot-template/versions/int-st-1/reviews")
      .set("x-test-admin", admin).send({ decision: "APPROVED", diffReviewed: true, notes: "diff reviewed" });
    expect(review.status).toBe(201);

    const published = await request(api()).post("/config/snapshot-template/versions/int-st-1/publish").set("x-test-admin", admin);
    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ status: "PUBLISHED", is_current: true });

    const current = await request(api()).get("/config/current").set("x-test-admin", admin);
    expect(current.body.SNAPSHOT_TEMPLATE).toBe("int-st-1");
  });

  it("publishes a content-only change with a lightweight approval and keeps the prior version immutable", async () => {
    await draftAndPreview("int-st-1", "Hi");
    await request(api()).post("/config/snapshot-template/versions/int-st-1/reviews").set("x-test-admin", admin)
      .send({ decision: "APPROVED", diffReviewed: true });
    await request(api()).post("/config/snapshot-template/versions/int-st-1/publish").set("x-test-admin", admin);

    const preview = await draftAndPreview("int-st-2", "Hello");
    expect(preview.change_kind).toBe("CONTENT");
    await request(api()).post("/config/snapshot-template/versions/int-st-2/reviews").set("x-test-admin", admin)
      .send({ decision: "APPROVED" });
    const published = await request(api()).post("/config/snapshot-template/versions/int-st-2/publish").set("x-test-admin", admin);
    expect(published.status).toBe(200);

    const editPublished = await request(api()).put("/config/snapshot-template/versions/int-st-1/config")
      .set("x-test-admin", admin).send({ config: bundle("Tampered") });
    expect(editPublished.status).toBe(409);
    expect(editPublished.body.error).toBe("INVALID_TRANSITION");
  });

  it("forbids a SUPERVISOR from publishing or changing configuration", async () => {
    await draftAndPreview("int-st-1", "Hi");
    const res = await request(api()).post("/config/snapshot-template/versions/int-st-1/publish").set("x-test-admin", supervisor);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("FORBIDDEN");
  });
});
