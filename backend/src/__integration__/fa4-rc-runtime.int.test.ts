import { Pool } from "pg";
import request from "supertest";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { Db, createPoolDb } from "../db/database";
import { createApp } from "../index";
import { CaptureEmailTransport } from "../fa/email/email-adapter";
import { deliverDueFa4Emails } from "../fa4/email";
import { seedCatalogIfEmpty } from "../fa4/repository";
import { Fa4Deps } from "../fa4/routes";

/**
 * Presentation RC under REAL concurrency, REAL commits and the ACTUAL least-privilege runtime role (see fa4-verify for the setup).
 * Use a dedicated database; every test uses unique emails.
 */
const adminUrl = process.env.TEST_RUNTIME_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const describeRt = adminUrl && runtimeUrl ? describe : describe.skip;
const legal = { termsVersion: "T-1", termsUrl: { es: "https://fa.test/t", en: "https://fa.test/t" }, privacyVersion: "P-1", privacyUrl: { es: "https://fa.test/p", en: "https://fa.test/p" } };
let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

describeRt("FA4 Presentation RC — concurrency, idempotency and privileges (runtime role)", () => {
  const admin = new Pool({ connectionString: adminUrl });
  const rt = new Pool({ connectionString: runtimeUrl, max: 8 });
  const adminDb: Db = createPoolDb(admin);
  const rtDb: Db = createPoolDb(rt);
  const mail = new CaptureEmailTransport();
  const deps = (): Fa4Deps => ({
    db: rtDb, email: mail, emailDispatch: "inline",
    config: { appBaseUrl: "https://fa.test", sessionTtlHours: 24, resumeLinkDays: 30, emailCooldownMinutes: 5, emailRecipientDailyQuota: 6, resumeProjectsPerRequest: 3, legal, now: () => new Date(), emailConfirmWaitMs: 2000, contactAddress: "contact@beeside.you" },
  });
  const app = (d = deps()) => request(createApp({ fa4: d }));
  const q = async (sql: string, v: unknown[] = []) => (await admin.query(sql, v)).rows;
  async function start() {
    const a = journeyNortica(); a.identity.email = `rc.${uniq()}@verify.example`;
    const r = await app().post("/api/fa4/sessions").send({ answers: a, step: "company" });
    expect(r.status).toBe(201);
    const pid = (await q("SELECT project_id FROM fa4_project WHERE email = $1", [a.identity.email]))[0].project_id as string;
    return { token: r.body.sessionToken as string, pid, email: a.identity.email };
  }
  const auth = (t: string) => ({ "X-Fa4-Session": t });

  beforeAll(async () => { await seedCatalogIfEmpty(adminDb, SEED_CATALOG); });
  beforeEach(() => { mail.messages.length = 0; mail.failNext.length = 0; });
  afterAll(async () => { await admin.end(); await rt.end(); });

  it("five simultaneous clicks on 'save and continue later' create ONE delivery and send ONE email", async () => {
    const { token, pid } = await start();
    const rs = await Promise.all(Array.from({ length: 5 }, () => app().post("/api/fa4/session/finish-later").set(auth(token))));
    expect(rs.every((r) => r.status === 200 && r.body.state === "sent")).toBe(true);
    expect(await q("SELECT 1 FROM fa4_email_delivery WHERE project_id = $1", [pid])).toHaveLength(1);
    expect(mail.messages.filter((m) => m.projectId === pid)).toHaveLength(1);
  });

  it("two workers racing for the same due delivery send it once (lease + SKIP LOCKED); the transaction is not held during the send", async () => {
    const { token, pid } = await start();
    const d = deps(); d.emailDispatch = "deferred"; d.config.emailConfirmWaitMs = 0;
    expect((await app(d).post("/api/fa4/session/finish-later").set(auth(token))).status).toBe(202);
    let inFlightTxns = -1;
    const slow = { name: "slow", async send(m: Parameters<CaptureEmailTransport["send"]>[0], o?: Parameters<CaptureEmailTransport["send"]>[1]) {
      inFlightTxns = Number((await q("SELECT count(*) c FROM pg_stat_activity WHERE state = 'idle in transaction' AND datname = current_database() AND usename = 'rt'"))[0].c);
      await new Promise((r) => setTimeout(r, 150));
      return mail.send(m, o);
    } };
    const cfg = { appBaseUrl: "https://fa.test", resumeLinkDays: 30, now: () => new Date(), contactAddress: "contact@beeside.you" };
    const [a, b] = await Promise.all([deliverDueFa4Emails({ db: rtDb, email: slow, config: cfg }), deliverDueFa4Emails({ db: rtDb, email: slow, config: cfg })]);
    expect(a.sent + b.sent).toBeGreaterThanOrEqual(1);
    expect(mail.messages.filter((m) => m.projectId === pid)).toHaveLength(1);
    expect(inFlightTxns).toBe(0);
  });

  it("the same contact form submitted 4× at once is stored and delivered once", async () => {
    const { token, pid, email } = await start();
    const body = { name: "Lucía", company: "Nórtica", email, message: "Hola, necesito hablar con alguien.", shareProgress: false, clientRequestId: `cr-${uniq()}-abcdef` };
    const rs = await Promise.all(Array.from({ length: 4 }, () => app().post("/api/fa4/session/contact").set(auth(token)).send(body)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(await q("SELECT 1 FROM fa4_contact_request WHERE project_id = $1", [pid])).toHaveLength(1);
    expect(mail.messages.filter((m) => m.projectId === pid && m.to === "contact@beeside.you")).toHaveLength(1);
  });

  it("the runtime role writes events but can neither change, delete nor truncate them (append-only)", async () => {
    const { token } = await start();
    await app().post("/api/fa4/events").set(auth(token)).send({ name: "help_clicked", visitId: "0b6e7a3c-3d7e-4d49-9a43-0f0a3b9a2d11" });
    expect((await q("SELECT 1 FROM fa4_event WHERE name = 'help_clicked'")).length).toBeGreaterThan(0);
    await expect(rt.query("UPDATE fa4_event SET name = 'x'")).rejects.toThrow();
    await expect(rt.query("DELETE FROM fa4_event")).rejects.toThrow();
    await expect(rt.query("TRUNCATE fa4_event")).rejects.toThrow();
    await expect(admin.query("UPDATE fa4_event SET name = 'x'")).rejects.toThrow(/append-only/);
  });

  it("anonymization scrubs the contact message and keeps the (non-personal) event trail", async () => {
    const { token, pid, email } = await start();
    await app().post("/api/fa4/session/contact").set(auth(token)).send({ name: "Lucía", company: "Nórtica", email, message: "datos personales aquí", shareProgress: true, clientRequestId: `cr-${uniq()}-zzzzzz` });
    await admin.query("SELECT fa4_anonymize_project($1, 'dpo', 'test')", [pid]);
    const c = (await q("SELECT name, company, email, message FROM fa4_contact_request WHERE project_id = $1", [pid]))[0];
    expect(JSON.stringify(c)).not.toMatch(/Lucía|Nórtica|datos personales|verify\.example/);
    expect((await q("SELECT 1 FROM fa4_event WHERE project_id = $1", [pid])).length).toBeGreaterThan(0);
  });
});
