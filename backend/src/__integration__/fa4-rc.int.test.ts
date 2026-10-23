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

    it("YEV email (v2): two private actions from ONE token, no mailto, no PDF, footer legal links, Premium only with ALL THREE conditions", async () => {
      const t = await start();
      await api().post("/api/fa4/session/result").set(auth(t));
      const send = async (premiumUrl: string | undefined, allowed: boolean | undefined) => {
        email.messages.length = 0;
        deps.config.premiumResourceUrl = premiumUrl ? { es: premiumUrl } : {}; deps.config.premiumCommercialContentAllowed = allowed;
        await client.query("DELETE FROM fa4_email_delivery WHERE template = 'fa4_result_link'");
        const r = await api().post("/api/fa4/session/result/email").set(auth(t));
        expect(r.status).toBe(200);
        return email.messages.at(-1)!;
      };
      const m = await send("https://fa.test/premium-es", true);
      expect(m.subject).toBe("Your Expansion View está listo. Descubre lo que sigue. | beeside");
      expect(m.html!).toContain("Ver mi Your Expansion View"); expect(m.html!).toContain("Explorar beeside Premium"); expect(m.html!).toContain("https://fa.test/premium-es");
      const yev = /href="(https:\/\/fa\.test\/fa4#r=[A-Za-z0-9_-]{43}&amp;view=result)"/.exec(m.html!)![1]!.replace(/&amp;/g, "&");
      const talk = /href="(https:\/\/fa\.test\/fa4#r=[^"]+contact=open[^"]*)"/.exec(m.html!)![1]!.replace(/&amp;/g, "&");
      expect(talk).toContain("origin=yev_email"); expect(yev.split("&")[0]).toBe(talk.split("&")[0]);          // SAME token, two actions
      expect(m.html!).not.toMatch(/mailto:|\.pdf|Policiescommercialnotices|noreply@|\{\{|<!--IF/i); expect(m.text!).not.toMatch(/\{\{|<!--IF|mailto:/);
      expect(m.html!).toContain("https://beeside.you/termsandconditions"); expect(m.html!).toContain("https://www.beeside.you/privacy");
      expect(m.text!).toContain("Hablar con beeside: https://fa.test/fa4#r=");
      expect(m.html!).not.toMatch(/Nórtica|Presencia/);                              // result content is never in the body
      expect(m.html!).toContain("Destino:"); expect(m.html!).toContain("México");        // declared destination (focus block)
      expect(m.replyTo).toBeUndefined();                                             // transport default → contact@beeside.you
      // Premium gate: every missing condition hides the whole block, CTA included
      for (const [url, allowed] of [[undefined, true], ["https://fa.test/premium-es", false], ["https://fa.test/premium-es", undefined], [undefined, false]] as const) {
        const x = await send(url, allowed);
        expect(x.html!).not.toMatch(/Explorar beeside Premium|Si decides continuar con beeside Premium|Porque expandirse/); expect(x.text!).not.toMatch(/Explorar beeside Premium|Si decides continuar con beeside Premium|Porque expandirse/);
        expect(x.html!).toContain("Hablar con beeside"); expect(x.html!).toContain("La información que nos compartiste no se comparte con proveedores en esta etapa.");   // always present
      }
      deps.config.premiumResourceUrl = { es: "https://fa.test/premium-es" }; deps.config.premiumCommercialContentAllowed = true;
    });

    it("Premium needs a REAL continuation too: URL + policy alone never enable it", async () => {
      const a = journeyA(); a.destinations = { list: [{ iso: "JP" }], open: false, sameInAll: true }; a.components = [{ ...a.components[0]!, destinations: ["JP"] }];   // a result without real value (D-050)
      const t = await start(a);
      deps.config.premiumResourceUrl = { es: "https://fa.test/premium-es" }; deps.config.premiumCommercialContentAllowed = true;
      const res = await api().post("/api/fa4/session/result").set(auth(t));
      expect(res.body.model.premium.shown).toBe(false);
      await api().post("/api/fa4/session/result/email").set(auth(t));
      expect(email.messages.at(-1)!.html!).not.toMatch(/Explorar beeside Premium/);
    });

    it("both private YEV links work in any order, repeatedly, while valid; revoked / expired access fails safely", async () => {
      const t = await start();
      await api().post("/api/fa4/session/result").set(auth(t));
      await api().post("/api/fa4/session/result/email").set(auth(t));
      const html = email.messages.at(-1)!.html!;
      const tok = /fa4#r=([A-Za-z0-9_-]{43})/.exec(html)![1]!;
      const exch = () => api().post("/api/fa4/links/continue").send({ token: tok });
      const a1 = await exch(); expect(a1.status).toBe(200); expect(a1.body.kind).toBe("YEV_LINK");        // open YEV
      const a2 = await exch(); expect(a2.status).toBe(200);                                                   // then Talk to beeside still works
      expect((await api().get("/api/fa4/session/result").set(auth(a2.body.sessionToken))).status).toBe(200);
      expect((await api().post("/api/fa4/session/contact").set(auth(a2.body.sessionToken)).send({ name: "Lucía", company: "Nórtica", email: "lucia@nortica.example", message: "Hola desde el correo", stage: "YEV", clientRequestId: "req-yev-0001" })).status).toBe(200);
      expect((await client.query("SELECT origin_stage FROM fa4_contact_request WHERE client_request_id = 'req-yev-0001'")).rows[0].origin_stage).toBe("YEV");
      // a newer YEV email supersedes the older private link (fails safely) while the new one works
      clock.now = new Date(clock.now.getTime() + 6 * 60_000);
      await api().post("/api/fa4/session/result/email").set(auth(t));
      expect((await exch()).status).toBe(404);
      const tok2 = /fa4#r=([A-Za-z0-9_-]{43})/.exec(email.messages.at(-1)!.html!)![1]!;
      expect((await api().post("/api/fa4/links/continue").send({ token: tok2 })).status).toBe(200);
      // expiry
      clock.now = new Date(clock.now.getTime() + 15 * 86_400_000);
      expect((await api().post("/api/fa4/links/continue").send({ token: tok2 })).status).toBe(404);
    });

    it("scanner-safe resume: GET/HEAD of the link never consumes it; the real continuation does, once", async () => {
      const t = await start();
      await api().post("/api/fa4/session/finish-later").set(auth(t));
      const tok = /fa4#r=([A-Za-z0-9_-]{43})/.exec(email.messages.at(-1)!.html!)![1]!;
      for (const verb of ["get", "head"] as const) {
        expect([404, 405]).toContain((await api()[verb]("/api/fa4/links/continue")).status);              // passive visits are no-ops
        await api()[verb](`/api/fa4/links/continue?token=${tok}`);
      }
      const real = await api().post("/api/fa4/links/continue").send({ token: tok });
      expect(real.status).toBe(200); expect(real.body.kind).toBe("RESUME");
      expect((await api().post("/api/fa4/links/continue").send({ token: tok })).status).toBe(404);          // single-use semantics kept
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

    it("internal email v2: FA locale (ES→ES, EN→EN) + «Idioma de FA», stage, destinations only when progress is shared, Reply-To = the person", async () => {
      const t = await start();
      await api().post("/api/fa4/session/contact").set(auth(t)).send({ ...body, shareProgress: true, clientRequestId: "req-loc-0001" });
      let m = email.messages.at(-1)!;
      expect(m.html!).toContain("Idioma de FA"); expect(m.html!).toContain("Español"); expect(m.html!).toContain("Etapa"); expect(m.html!).toContain("Discovery"); expect(m.html!).toContain("México");
      expect(m.subject).toBe("Hablar con beeside — Nórtica Envases — Lucía"); expect(m.replyTo).toBe("lucia@nortica.example"); expect(m.to).toBe("contact@beeside.you");
      expect(m.html!).not.toMatch(/SOURCEABLE|REVIEW|DEPENDENT|termsandconditions/);               // no internal states, no public legal footer
      await api().post("/api/fa4/session/contact").set(auth(t)).send({ ...body, clientRequestId: "req-loc-0002" });
      expect(email.messages.at(-1)!.html!).not.toContain("Destino(s)");                              // not shared → not included
      const en = await start(journeyNortica("en"));
      await api().post("/api/fa4/session/contact").set(auth(en)).send({ ...body, stage: "YEV", clientRequestId: "req-loc-0003" });
      m = email.messages.at(-1)!;
      expect(m.subject).toBe("Talk to beeside — Nórtica Envases — Lucía"); expect(m.html!).toContain("FA language"); expect(m.html!).toContain("English"); expect(m.html!).toContain("YEV"); expect(m.text!).toContain("Stage: YEV");
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

    it("Subject header injection: CR/LF, controls, U+2028/9 and encoded-words in name/company never reach a header", async () => {
      const t = await start();
      const evil = [
        "Eve\r\nBcc: attacker@evil.example", "Eve\u2028Bcc: x@y.z", "=?utf-8?B?QmNjOiB4QHkuego=?=", "Eve\u0085Cc: a@b.c", "Eve\u0000\u0007\u202Ebidi", "A".repeat(500),
      ];
      let i = 0;
      for (const n of evil) {
        await api().post("/api/fa4/session/contact").set(auth(t)).send({ ...body, name: n, company: n, clientRequestId: `req-inj-000${i++}` });
        const m = email.messages.at(-1)!;
        // eslint-disable-next-line no-control-regex
        expect(m.subject).not.toMatch(/[\u0000-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E]|=\?|\?=/);
        expect(m.subject.length).toBeLessThan(160); expect(m.to).toBe("contact@beeside.you");
      }
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
      for (const n of ["help_clicked", "project_created", "step_reached", "yev_previewed", "yev_delivered", "yev_email_requested", "yev_email_sent", "premium_continuation_requested"]) expect(names).toContain(n);
      const gen = (await client.query("SELECT props, catalog_version FROM fa4_event WHERE name='yev_previewed'")).rows[0];
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
