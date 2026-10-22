import { Pool } from "pg";
import request from "supertest";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { Answers } from "@beeside/fa-public-engine";
import { Db, createPoolDb } from "../db/database";
import { createApp } from "../index";
import { CaptureEmailTransport } from "../fa/email/email-adapter";
import { seedCatalogIfEmpty } from "../fa4/repository";
import { deliverDueFa4Emails, findIdleProjects, sweepIdleContinuations } from "../fa4/email";
import { Fa4Deps } from "../fa4/routes";

/**
 * DSC-36 — inactivity and continuity, under REAL commits and the least-privilege runtime role (same setup as fa4-v1-delivery).
 * Time is simulated with explicit `now` values and by setting `fa4_project.updated_at` (the «period» of the idle rule).
 */
const adminUrl = process.env.TEST_RUNTIME_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const describeRt = adminUrl && runtimeUrl ? describe : describe.skip;
const legal = { termsVersion: "T", termsUrl: { es: "https://t", en: "https://t" }, privacyVersion: "P", privacyUrl: { es: "https://p", en: "https://p" } };
let n = 0; const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;
const MIN = 60_000;

describeRt("DSC-36 — idle continuation", () => {
  const admin = new Pool({ connectionString: adminUrl }); const rt = new Pool({ connectionString: runtimeUrl, max: 8 });
  const adminDb: Db = createPoolDb(admin); const rtDb: Db = createPoolDb(rt);
  const mail = new CaptureEmailTransport();
  let closedTest: { emailDomains: string[]; emailAddresses?: string[] } | undefined; let quota = 100; let cooldown = 5;
  const limits = () => ({ cooldownMinutes: cooldown, recipientDailyQuota: quota });
  const deps = (): Fa4Deps => ({ db: rtDb, email: mail, emailDispatch: "inline",
    config: { appBaseUrl: "https://fa.test", closedTest, legalMode: closedTest ? "closed-test" : "final", sessionTtlHours: 24, resumeLinkDays: 30, emailCooldownMinutes: cooldown, emailRecipientDailyQuota: quota, resumeProjectsPerRequest: 3, legal: { ...legal, privacyVersion: closedTest ? "CLOSED-TEST-NOT-LEGAL" : "P" }, now: () => new Date(), emailConfirmWaitMs: 2000, contactAddress: "contact@beeside.you" } });
  const app = () => request(createApp({ fa4: deps() }));
  const q = async (sql: string, v: unknown[] = []) => (await admin.query(sql, v)).rows;
  const auth = (t: string) => ({ "X-Fa4-Session": t });
  const send = () => deliverDueFa4Emails({ db: rtDb, email: mail, config: { appBaseUrl: "https://fa.test", resumeLinkDays: 30, now: () => new Date(), closedTest, contactAddress: "contact@beeside.you" } as never });
  async function start(email?: string) {
    const a: Answers = JSON.parse(JSON.stringify(journeyNortica())); a.identity.email = email ?? `idle.${uniq()}@verify.example`;
    const r = await app().post("/api/fa4/sessions").send({ answers: a, step: "decision" }); expect(r.status).toBe(201);
    const pid = (await q("SELECT project_id FROM fa4_project WHERE email = $1", [a.identity.email]))[0].project_id as string;
    return { token: r.body.sessionToken as string, pid, email: a.identity.email };
  }
  const idleSince = (pid: string, minutes: number) => q("UPDATE fa4_project SET updated_at = $2 WHERE project_id = $1", [pid, new Date(Date.now() - minutes * MIN)]);
  const links = (pid: string) => q("SELECT delivery_id, status FROM fa4_email_delivery WHERE project_id = $1 AND template = 'fa4_resume_link' ORDER BY created_at", [pid]);
  const sweep = (at = new Date()) => sweepIdleContinuations(rtDb, at, limits());

  beforeAll(async () => { await seedCatalogIfEmpty(adminDb, SEED_CATALOG); });
  beforeEach(() => { mail.messages.length = 0; mail.failNext.length = 0; closedTest = undefined; quota = 100; cooldown = 5; });
  afterAll(async () => { await admin.end(); await rt.end(); });

  it("1 · a project idle 31 min (within 24 h) gets exactly ONE continuation link from the sweep; another sweep creates nothing", async () => {
    const { pid } = await start(); await idleSince(pid, 31);
    expect((await findIdleProjects(rtDb, new Date())).includes(pid)).toBe(true);
    await sweep(); expect(await links(pid)).toHaveLength(1);
    await sweep(); await sweep(); expect(await links(pid)).toHaveLength(1);
    expect((await findIdleProjects(rtDb, new Date())).includes(pid)).toBe(false);
  });
  it("1b · a project active within the last 30 min is left alone", async () => {
    const { pid } = await start(); await idleSince(pid, 10); await sweep(); expect(await links(pid)).toHaveLength(0);
  });
  it("2 · a project idle 25 h NEVER gets an automatic e-mail (24 h window: no mass send on activation)", async () => {
    const { pid } = await start(); await idleSince(pid, 25 * 60); await sweep(); expect(await links(pid)).toHaveLength(0);
  });
  it("3 · DELIVERED / INELIGIBLE / ANONYMIZED projects are never e-mailed", async () => {
    const d = await start(); expect((await app().post("/api/fa4/session/result/email").set(auth(d.token))).status).toBe(200);          // delivered
    const i = await start(); const a = await start();
    await idleSince(d.pid, 40); await idleSince(i.pid, 40); await idleSince(a.pid, 40);
    await q("UPDATE fa4_project SET status = 'INELIGIBLE' WHERE project_id = $1", [i.pid]);
    await q("SELECT fa4_anonymize_project($1, 'test', 'DSC-36')", [a.pid]);
    await idleSince(d.pid, 40); await idleSince(i.pid, 40);
    mail.messages.length = 0; await sweep();
    for (const p of [d.pid, i.pid, a.pid]) expect((await links(p)).length).toBe(0);
    expect((await app().post("/api/fa4/session/idle-continuation").set(auth(d.token))).body.error).toBe("NOT_APPLICABLE");
  });
  it("4 · a new save opens a new period: another automatic e-mail only after ANOTHER 30 min of inactivity", async () => {
    const { pid, token } = await start(); await idleSince(pid, 31); await sweep(); expect(await links(pid)).toHaveLength(1);
    const saved = (await app().get("/api/fa4/session").set(auth(token))).body.answers;
    expect((await app().put("/api/fa4/session").set(auth(token)).send({ answers: saved, step: "decision" })).status).toBe(200);          // the person comes back and edits
    await q("UPDATE fa4_project SET updated_at = $2 WHERE project_id = $1", [pid, new Date(Date.now() + 1000)]);                       // (the email above was «created» by this clock: the new period starts after it)
    await sweep(new Date(Date.now() + 10 * MIN)); expect(await links(pid)).toHaveLength(1);                                               // only 10 min later: nothing
    await sweep(new Date(Date.now() + 40 * MIN)); expect(await links(pid)).toHaveLength(2);                                               // 40 min after the new save: second link
  });
  it("5 · two sweeps at the same time (two worker replicas) → ONE e-mail", async () => {
    const { pid } = await start(); await idleSince(pid, 31);
    await Promise.all([sweep(), sweep(), sweep()]); expect(await links(pid)).toHaveLength(1);
  });
  it("6 · the tab's request and the worker's sweep at the same time → ONE e-mail", async () => {
    const { pid, token } = await start(); await idleSince(pid, 31);
    const [r] = await Promise.all([app().post("/api/fa4/session/idle-continuation").set(auth(token)), sweep(), sweep()]);
    expect([200, 202]).toContain(r.status); expect(await links(pid)).toHaveLength(1);
  });
  it("7 · the endpoint repeated (reloads), inside and outside the 5-min cooldown, returns the SAME delivery and sends nothing new", async () => {
    const { pid, token } = await start(); await idleSince(pid, 31);
    const first = await app().post("/api/fa4/session/idle-continuation").set(auth(token)); expect(first.status).toBe(200); expect(first.body.state).toBe("sent");
    const id = (await links(pid))[0].delivery_id; expect(mail.messages.filter((m) => m.template === "fa4_resume_link")).toHaveLength(1);
    for (let i = 0; i < 3; i++) expect((await app().post("/api/fa4/session/idle-continuation").set(auth(token))).status).toBe(200);        // inside the cooldown
    await q("UPDATE fa4_email_delivery SET created_at = created_at - interval '10 minutes' WHERE delivery_id = $1", [id]); await idleSince(pid, 31);   // the email is now older than the cooldown; the project still has no new change… and a created_at < updated_at would open a new period: keep it after
    await q("UPDATE fa4_email_delivery SET created_at = now() - interval '1 minute' WHERE delivery_id = $1", [id]);
    expect((await app().post("/api/fa4/session/idle-continuation").set(auth(token))).status).toBe(200);
    const rows = await links(pid); expect(rows).toHaveLength(1); expect(rows[0].delivery_id).toBe(id);
    expect(mail.messages.filter((m) => m.template === "fa4_resume_link")).toHaveLength(1);
  });
  it("8 · closed-test allowlist: an unauthorized recipient → CANCELLED, 403 RECIPIENT_NOT_AUTHORIZED, never retried by later sweeps, project untouched", async () => {
    closedTest = { emailDomains: [], emailAddresses: ["only.this@verify.example"] };
    const { pid, token } = await start(); await idleSince(pid, 31);
    const before = (await q("SELECT status, answers, step_key FROM fa4_project WHERE project_id = $1", [pid]))[0];
    const r = await app().post("/api/fa4/session/idle-continuation").set(auth(token));
    expect(r.status).toBe(403); expect(r.body.error).toBe("RECIPIENT_NOT_AUTHORIZED"); expect(JSON.stringify(r.body)).not.toContain("@");
    expect((await links(pid)).map((x) => x.status)).toEqual(["CANCELLED"]); expect(mail.messages).toHaveLength(0);
    await sweep(); await sweep(); await sweep(new Date(Date.now() + 5 * MIN)); expect(await links(pid)).toHaveLength(1);                   // not retried
    const after = (await q("SELECT status, answers, step_key FROM fa4_project WHERE project_id = $1", [pid]))[0]; expect(after).toEqual(before);
  });
  it("9 · a real SMTP failure: 502 generic, FAILED → (DEAD); the retry is the SAME delivery; the project is untouched", async () => {
    const { pid, token } = await start(); await idleSince(pid, 31);
    mail.failNext.push(new Error("smtp down"));
    const r = await app().post("/api/fa4/session/idle-continuation").set(auth(token)); expect(r.status).toBe(502); expect(r.body.error).toBe("EMAIL_NOT_SENT");
    const rows = await links(pid); expect(rows).toHaveLength(1); expect(["FAILED", "DEAD"]).toContain(rows[0].status);
    const reload = await app().post("/api/fa4/session/idle-continuation").set(auth(token)); expect(reload.status).toBe(502);              // a reload does NOT retry
    expect(mail.messages).toHaveLength(0);
    await q("UPDATE fa4_email_delivery SET status = 'DEAD' WHERE delivery_id = $1", [rows[0].delivery_id]);
    const retry = await app().post("/api/fa4/session/idle-continuation").set(auth(token)).send({ retry: true });                          // the person asks again
    expect(retry.status).toBe(200); const after = await links(pid); expect(after).toHaveLength(1); expect(after[0].delivery_id).toBe(rows[0].delivery_id);
    expect((await q("SELECT status FROM fa4_project WHERE project_id = $1", [pid]))[0].status).toBe("IN_PROGRESS");
  });
  it("10 · daily quota reached → 429 and no e-mail", async () => {
    quota = 0; const { pid, token } = await start(); await idleSince(pid, 31);
    expect((await app().post("/api/fa4/session/idle-continuation").set(auth(token))).status).toBe(429); expect(await links(pid)).toHaveLength(0);
  });
  it("11 · the e-mailed link opens the SAME project at the SAME step, once", async () => {
    const { pid, token, email } = await start(); await idleSince(pid, 31);
    await app().post("/api/fa4/session/idle-continuation").set(auth(token));
    const msg = mail.messages.filter((m) => m.template === "fa4_resume_link").at(-1)!; const tok = /#r=([A-Za-z0-9_-]+)/.exec(msg.ctaUrl ?? "")![1]!;
    const ex = await app().post("/api/fa4/links/continue").send({ token: tok }); expect(ex.status).toBe(200);
    const s = await app().get("/api/fa4/session").set(auth(ex.body.sessionToken)); expect(s.body.answers.identity.email).toBe(email); expect(s.body.step).toBe("decision");
    expect((await q("SELECT project_id FROM fa4_project WHERE email = $1", [email])).map((r) => r.project_id)).toEqual([pid]);
    expect((await app().post("/api/fa4/links/continue").send({ token: tok })).status).not.toBe(200);                                       // single use
  });
  it("13 · activity heartbeat: an ACTIVE tab (no save for 40 min) is never swept; without beats the sweep still finds it; never backwards, 1/min, only IN_PROGRESS, constant answer", async () => {
    const { token, pid } = await start(); await idleSince(pid, 40);
    expect((await findIdleProjects(rtDb, new Date())).includes(pid)).toBe(true);                   // no beat: idle by the worker's definition
    const beat = () => app().post("/api/fa4/session/activity").set(auth(token)).send({});
    const r = await beat(); expect(r.status).toBe(200); expect(r.body).toEqual({ ok: true });
    expect((await findIdleProjects(rtDb, new Date())).includes(pid)).toBe(false);                  // the beat moved updated_at to «now»
    await sweep(); expect(await links(pid)).toHaveLength(0);                                       // active person: no automatic e-mail
    const t1 = (await q("SELECT updated_at FROM fa4_project WHERE project_id=$1", [pid]))[0].updated_at as Date;
    const r2 = await beat(); expect(r2.body).toEqual({ ok: true });                                // within 60 s: nothing written, same answer
    expect(((await q("SELECT updated_at FROM fa4_project WHERE project_id=$1", [pid]))[0].updated_at as Date).getTime()).toBe(t1.getTime());
    await idleSince(pid, 31); await sweep(); expect(await links(pid)).toHaveLength(1);              // then inactivity (closed browser / asleep): the worker still protects the project
    const noAuth = await app().post("/api/fa4/session/activity").send({}); expect(noAuth.status).toBe(401);
  });
  it("12 · no log line and no response carries a token, a private URL or an address", async () => {
    const out: string[] = []; const spy = jest.spyOn(process.stdout, "write").mockImplementation(((c: unknown) => { out.push(String(c)); return true; }) as never);
    try {
      const { pid, token, email } = await start(); await idleSince(pid, 31);
      const r = await app().post("/api/fa4/session/idle-continuation").set(auth(token)); await sweep(); await send();
      const body = JSON.stringify(r.body) + JSON.stringify(r.headers);
      for (const s of [body, ...out]) { expect(s).not.toContain(email); expect(s).not.toMatch(/#r=|fa\.test|[A-Za-z0-9_-]{40,}/); }
    } finally { spy.mockRestore(); }
  });
});
