import { Client } from "pg";
import request from "supertest";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { journeyA, journeyNortica } from "@beeside/fa-public-engine/testing";
import { Answers } from "@beeside/fa-public-engine";
import { createSavepointDb } from "../db/database";
import { createApp } from "../index";
import { CaptureEmailTransport } from "../fa/email/email-adapter";
import { deliverDueFa4Emails } from "../fa4/email";
import { purgeExpiredOrphanContacts } from "../fa4/retention";
import { latestMarketingConsent, seedCatalogIfEmpty } from "../fa4/repository";
import { Fa4Deps } from "../fa4/routes";

const url = process.env.TEST_DATABASE_URL;
const describeWithDb = url ? describe : describe.skip;

/** Presentation RC: truthful email states, the contact form, idempotency / retry, event capture. Real PostgreSQL, every test rolled back. */
describeWithDb("FA4 Presentation RC — delivery truthfulness, contact, events (PostgreSQL, rolled back)", () => {
  const client = new Client({ connectionString: url });
  const email = new CaptureEmailTransport();
  const clock = { now: new Date("2026-10-12T12:00:00Z") };
  const db = createSavepointDb(client);
  const deps: Fa4Deps = {
    db, email,
    config: {
      appBaseUrl: "https://fa.test", sessionTtlHours: 24, resumeLinkDays: 30, emailCooldownMinutes: 5, emailRecipientDailyQuota: 6, resumeProjectsPerRequest: 3, now: () => clock.now,
      contactAddress: "contact@beeside.you", premiumResourceUrl: { es: "https://fa.test/premium-es" }, emailConfirmWaitMs: 0,
      legal: { termsVersion: "T", termsUrl: { es: "https://t", en: "https://t" }, privacyVersion: "P", privacyUrl: { es: "https://p", en: "https://p" } },
    },
    emailDispatch: "inline",
  };
  const api = () => request(createApp({ fa4: deps }));
  const emailDeps = () => ({ db, email, config: { appBaseUrl: "https://fa.test", resumeLinkDays: 30, now: () => clock.now, contactAddress: "contact@beeside.you", premiumResourceUrl: deps.config.premiumResourceUrl } });

  beforeAll(() => client.connect());
  afterAll(() => client.end());
  beforeEach(async () => {
    email.messages.length = 0; email.idempotencyKeys.length = 0; email.failNext.length = 0;
    clock.now = new Date("2026-10-12T12:00:00Z"); deps.emailDispatch = "inline";
    await client.query("BEGIN");
    await seedCatalogIfEmpty(db, SEED_CATALOG);
  });
  afterEach(() => client.query("ROLLBACK"));

  async function start(a: Answers = journeyNortica()) {
    const res = await api().post("/api/fa4/sessions").send({ answers: a, step: "company" });
    expect(res.status).toBe(201);
    return res.body.sessionToken as string;
  }
  const auth = (t: string) => ({ "X-Fa4-Session": t });
  const deliveries = async () => (await client.query("SELECT template, status, attempts FROM fa4_email_delivery ORDER BY created_at")).rows;

  describe("queued ≠ sent", () => {
    it("save-and-continue-later reports `sent` only after the provider accepted it", async () => {
      const t = await start();
      const r = await api().post("/api/fa4/session/finish-later").set(auth(t));
      expect(r.status).toBe(200); expect(r.body.state).toBe("sent"); expect(r.body.ok).toBeUndefined();
      expect(email.messages).toHaveLength(1);
      expect((await deliveries())[0]).toMatchObject({ template: "fa4_resume_link", status: "SENT" });
    });

    it("provider failure → 502 EMAIL_NOT_SENT with no claim of delivery; the address is not leaked", async () => {
      const t = await start();
      email.failNext.push(new Error("smtp 550 lucia@nortica.example rejected"));
      const r = await api().post("/api/fa4/session/finish-later").set(auth(t));
      expect(r.status).toBe(502); expect(r.body.error).toBe("EMAIL_NOT_SENT");
      expect(JSON.stringify(r.body)).not.toMatch(/lucia@|state":"sent/);
      expect((await deliveries())[0].status).toBe("FAILED");
      expect(email.messages).toHaveLength(0);
    });

    it("retry after a failure re-attempts the SAME delivery (no duplicate email) and then reports sent", async () => {
      const t = await start();
      email.failNext.push(new Error("temporary"));
      expect((await api().post("/api/fa4/session/finish-later").set(auth(t))).status).toBe(502);
      const again = await api().post("/api/fa4/session/finish-later").set(auth(t));
      expect(again.status).toBe(200); expect(again.body.state).toBe("sent");
      expect(await deliveries()).toHaveLength(1);
      expect(email.messages).toHaveLength(1);
    });

    it("a DEAD delivery does not lock the person out: asking again makes one more attempt", async () => {
      const t = await start();
      await client.query("UPDATE fa4_email_delivery SET status='DEAD'");   // none yet
      email.failNext.push(new Error("x"));
      await api().post("/api/fa4/session/finish-later").set(auth(t));
      await client.query("UPDATE fa4_email_delivery SET status='DEAD', attempts=max_attempts");
      const again = await api().post("/api/fa4/session/finish-later").set(auth(t));
      expect(again.status).toBe(200);
      expect(email.messages).toHaveLength(1);
    });

    it("deferred mode (worker): the request says `pending` (202), never `sent`; the worker later sends and the status endpoint tells the truth", async () => {
      const t = await start(); deps.emailDispatch = "deferred";
      const r = await api().post("/api/fa4/session/finish-later").set(auth(t));
      expect(r.status).toBe(202); expect(r.body.state).toBe("pending"); expect(email.messages).toHaveLength(0);
      expect((await api().get("/api/fa4/session/email-status?kind=resume").set(auth(t))).body.state).toBe("pending");
      expect(await deliverDueFa4Emails(emailDeps())).toEqual({ sent: 1, failed: 0, dead: 0 });
      expect((await api().get("/api/fa4/session/email-status?kind=resume").set(auth(t))).body.state).toBe("sent");
    });

    it("an expired lease (crashed sender) is recovered; dead after bounded attempts", async () => {
      const t = await start(); deps.emailDispatch = "deferred";
      await api().post("/api/fa4/session/finish-later").set(auth(t));
      await client.query("UPDATE fa4_email_delivery SET status='SENDING', attempts=1, lease_until=$1", [new Date(clock.now.getTime() - 1000)]);
      expect((await deliverDueFa4Emails(emailDeps())).sent).toBe(1);
      const t2 = await start(journeyA()); await api().post("/api/fa4/session/finish-later").set(auth(t2));
      email.failNext.push(...Array.from({ length: 5 }, () => new Error("down")));
      let dead = 0;
      for (let i = 0; i < 6; i++) { clock.now = new Date(clock.now.getTime() + 3 * 3_600_000); dead += (await deliverDueFa4Emails(emailDeps())).dead; }
      expect(dead).toBe(1);
      expect((await client.query("SELECT status FROM fa4_email_delivery WHERE status='DEAD'")).rowCount).toBe(1);
    });

    it("YEV email: result link is the primary CTA, Premium resource is the secondary one only when configured", async () => {
      const t = await start();
      await api().post("/api/fa4/session/result").set(auth(t));
      const r = await api().post("/api/fa4/session/result/email").set(auth(t));
      expect(r.status).toBe(200); expect(r.body.state).toBe("sent");
      const m = email.messages.at(-1)!;
      expect(m.ctaLabel).toBe("Ver mi Your Expansion View"); expect(m.ctaUrl).toMatch(/#r=[A-Za-z0-9_-]{43}&view=result$/);
      expect(m.secondaryCtaUrl).toBe("https://fa.test/premium-es"); expect(m.secondaryCtaLabel).toBe("Conoce cómo puede ayudarte Premium");
      expect(m.body).not.toMatch(/Nórtica|Presencia|México/);               // the YEV content is never in the body
      delete deps.config.premiumResourceUrl;
      const t2 = await start(journeyA());
      await api().post("/api/fa4/session/result").set(auth(t2));
      await api().post("/api/fa4/session/result/email").set(auth(t2));
      expect(email.messages.at(-1)!.secondaryCtaUrl).toBeUndefined();        // absent URL = no secondary link, no failure
      deps.config.premiumResourceUrl = { es: "https://fa.test/premium-es" };
    });

    it("the YEV email is not marketing consent", async () => {
      const t = await start();
      await api().post("/api/fa4/session/result").set(auth(t));
      await api().post("/api/fa4/session/result/email").set(auth(t));
      const pid = (await client.query("SELECT project_id FROM fa4_project")).rows[0].project_id;
      expect(await latestMarketingConsent(db, pid)).toBe(false);
      expect((await client.query("SELECT count(*)::int n FROM fa4_marketing_consent")).rows[0].n).toBe(1);
    });
  });

  describe("Hablar con beeside", () => {
    const body = { name: "Lucía", company: "Nórtica Envases", email: "lucia@nortica.example", message: "¿Podemos hablar de la logística?", shareProgress: false, clientRequestId: "req-0001-abcd" };

    it("delivers to contact@beeside.you with Reply-To = the person, reports sent only when accepted", async () => {
      const t = await start();
      const r = await api().post("/api/fa4/session/contact").set(auth(t)).send(body);
      expect(r.status).toBe(200); expect(r.body.state).toBe("sent");
      const m = email.messages.at(-1)!;
      expect(m.to).toBe("contact@beeside.you"); expect(m.replyTo).toBe("lucia@nortica.example"); expect(m.body).toContain("logística");
      expect(m.body).not.toContain("Avance compartido");                       // progress is shared only when asked
      expect(m.ctaUrl).toBe("");
    });

    it("share-progress adds a plain summary (no internal states) to this message only", async () => {
      const t = await start();
      await api().post("/api/fa4/session/contact").set(auth(t)).send({ ...body, shareProgress: true });
      const m = email.messages.at(-1)!;
      expect(m.body).toContain("Avance compartido"); expect(m.body).toMatch(/MX/); expect(m.body).not.toMatch(/SOURCEABLE|REVIEW|DEPENDENT|capabilit/i);
    });

    it("failure is reported as failure (502) and the same form can be sent again once; a double click never creates two messages", async () => {
      const t = await start();
      email.failNext.push(new Error("smtp down"));
      expect((await api().post("/api/fa4/session/contact").set(auth(t)).send(body)).status).toBe(502);
      expect((await api().post("/api/fa4/session/contact").set(auth(t)).send(body)).status).toBe(200);
      expect((await api().post("/api/fa4/session/contact").set(auth(t)).send(body)).status).toBe(200);
      expect((await client.query("SELECT count(*)::int n FROM fa4_contact_request")).rows[0].n).toBe(1);
      expect(email.messages.filter((m) => m.to === "contact@beeside.you")).toHaveLength(1);
    });

    it("does not touch marketing consent, is validated, and needs a session", async () => {
      const t = await start();
      await api().post("/api/fa4/session/contact").set(auth(t)).send(body);
      expect((await client.query("SELECT count(*)::int n FROM fa4_marketing_consent")).rows[0].n).toBe(1);
      expect((await api().post("/api/fa4/session/contact").set(auth(t)).send({ ...body, message: "" })).status).toBe(400);
      expect((await api().post("/api/fa4/session/contact").set(auth(t)).send({ ...body, email: "nope", clientRequestId: "req-0002-abcd" })).status).toBe(400);
      expect((await api().post("/api/fa4/session/contact").send(body)).status).toBe(401);
    });

    it("is also available BEFORE Identity (cover): anonymous, no project, no progress even if asked", async () => {
      const r = await api().post("/api/fa4/contact").send({ ...body, company: "", shareProgress: true, clientRequestId: "req-anon-0001" });
      expect(r.status).toBe(200); expect(r.body.state).toBe("sent");
      const m = email.messages.at(-1)!;
      expect(m.to).toBe("contact@beeside.you"); expect(m.replyTo).toBe("lucia@nortica.example"); expect(m.body).not.toContain("Avance compartido"); expect(m.projectId).toBeNull();
      expect((await client.query("SELECT project_id FROM fa4_contact_request")).rows[0].project_id).toBeNull();
      email.failNext.push(new Error("down"));
      expect((await api().post("/api/fa4/contact").send({ ...body, clientRequestId: "req-anon-0002" })).status).toBe(502);
      expect((await api().post("/api/fa4/contact").send({ ...body, email: "bad", clientRequestId: "req-anon-0003" })).status).toBe(400);
    });

    it("retention: orphan (pre-project) contacts are irreversibly anonymized after 180 days; project-linked ones and recent ones are untouched; idempotent", async () => {
      const t = await start();
      await api().post("/api/fa4/contact").send({ ...body, clientRequestId: "req-ret-0001" });
      await api().post("/api/fa4/contact").send({ ...body, clientRequestId: "req-ret-0002" });
      await api().post("/api/fa4/session/contact").set(auth(t)).send({ ...body, clientRequestId: "req-ret-0003" });
      await client.query("UPDATE fa4_contact_request SET created_at = $1 WHERE client_request_id = 'req-ret-0001'", [new Date(clock.now.getTime() - 181 * 86_400_000)]);
      await client.query("UPDATE fa4_contact_request SET created_at = $1 WHERE client_request_id = 'req-ret-0002'", [new Date(clock.now.getTime() - 179 * 86_400_000)]);
      await client.query("UPDATE fa4_contact_request SET created_at = $1 WHERE client_request_id = 'req-ret-0003'", [new Date(clock.now.getTime() - 400 * 86_400_000)]);
      expect(await purgeExpiredOrphanContacts(db, clock.now)).toBe(1);
      expect(await purgeExpiredOrphanContacts(db, clock.now)).toBe(0);
      const rows = Object.fromEntries((await client.query("SELECT client_request_id, name, email, message FROM fa4_contact_request")).rows.map((r) => [r.client_request_id, r]));
      expect(JSON.stringify(rows["req-ret-0001"])).not.toMatch(/Lucía|nortica|logística/); expect(rows["req-ret-0001"].message).toBe("anonymized");
      expect(rows["req-ret-0002"].message).toContain("logística");          // 179 days: still inside the period
      expect(rows["req-ret-0003"].message).toContain("logística");          // linked to a project: follows the project's rules
      expect((await client.query("SELECT count(*)::int n FROM fa4_marketing_consent")).rows[0].n).toBe(1);   // never marketing
    });

    it("header injection in the name cannot add headers or recipients", async () => {
      const t = await start();
      await api().post("/api/fa4/session/contact").set(auth(t)).send({ ...body, name: "Eve\r\nBcc: attacker@evil.example", clientRequestId: "req-0003-abcd" });
      const m = email.messages.at(-1)!;
      expect(m.subject).not.toMatch(/[\r\n]/); expect(m.to).toBe("contact@beeside.you");
    });
  });

  describe("event capture", () => {
    const visit = "0b6e7a3c-3d7e-4d49-9a43-0f0a3b9a2d11";
    it("accepts anonymous pre-Identity events with no project, no PII", async () => {
      expect((await api().post("/api/fa4/events").send({ name: "visit", visitId: visit })).status).toBe(204);
      expect((await api().post("/api/fa4/events").send({ name: "language_selected", visitId: visit, props: { locale: "en" } })).status).toBe(204);
      const rows = (await client.query("SELECT name, project_id, visit_id, props FROM fa4_event ORDER BY occurred_at")).rows;
      expect(rows.map((r) => r.name)).toEqual(["visit", "language_selected"]);
      expect(rows.every((r) => r.project_id === null && r.visit_id === visit)).toBe(true);
    });
    it("rejects unknown names, free text and extra properties silently (never breaks the UI)", async () => {
      for (const b of [{ name: "email_typed", visitId: visit }, { name: "visit", visitId: "nope" }, { name: "visit", visitId: visit, props: { who: "lucia@x.com" } }, { name: "step_viewed", visitId: visit, step: "lucia@x.com" }])
        expect((await api().post("/api/fa4/events").send(b)).status).toBe(204);
      expect((await client.query("SELECT count(*)::int n FROM fa4_event")).rows[0].n).toBe(0);
    });
    it("links to the project when a session is present and derives the funnel on the server", async () => {
      const t = await start();
      await api().post("/api/fa4/events").set(auth(t)).send({ name: "help_clicked", visitId: visit });
      await api().put("/api/fa4/session").set(auth(t)).send({ answers: journeyNortica(), step: "destinations" });
      await api().post("/api/fa4/session/result").set(auth(t));
      await api().post("/api/fa4/session/result/email").set(auth(t));
      await api().post("/api/fa4/session/continue").set(auth(t));
      const names = (await client.query("SELECT name FROM fa4_event ORDER BY occurred_at, event_id")).rows.map((r) => r.name);
      for (const n of ["help_clicked", "project_created", "step_reached", "result_generated", "yev_email_requested", "yev_email_sent", "premium_continuation_requested"]) expect(names).toContain(n);
      const gen = (await client.query("SELECT props, catalog_version FROM fa4_event WHERE name='result_generated'")).rows[0];
      expect(gen.props.destinations).toEqual(["MX"]); expect(gen.catalog_version).toBe(SEED_CATALOG.version);
      expect(JSON.stringify(gen.props)).not.toMatch(/Nórtica|lucia/);
    });
    it("marketing opt-in is recorded as an event only when it changes", async () => {
      const a = journeyNortica(); a.identity.marketingConsent = true;
      await start(a);
      const n = (await client.query("SELECT count(*)::int n FROM fa4_event WHERE name='marketing_opt_in_changed'")).rows[0].n;
      expect(n).toBe(1);
    });
  });
});
