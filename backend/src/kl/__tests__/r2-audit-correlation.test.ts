import { randomUUID } from "node:crypto";
import { Db } from "../../db/database";
import { recordAudit } from "../../operations/audit";
import { withAttestation } from "../db/attested-tx";
import { CorrelationIncomplete, correlateAudit } from "../audit/correlation";
import { klAdmin } from "../service/admin-service";
import { ApiHarness, startApiHarness } from "../testing/api-harness";
import { describeKl } from "../testing/env";
import { expectSqlState } from "../testing/kit";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describeKl("R2 · correlación de auditoría entre kl.audit_event y admin_audit_event (B5, X30)", () => {
  let h: ApiHarness;
  const GRACE = 120;
  const run = (over: Partial<Parameters<typeof correlateAudit>[0]> = {}) => correlateAudit({ platform: h.platform, kl: h.klApp, graceMs: GRACE, ...over });
  const admin = () => h.users.padmin as NonNullable<(typeof h.users)[string]>;
  const platformAudit = (action: string, outcome: "ALLOWED" | "DENIED" | "FAILED", requestId: string) =>
    recordAudit(h.platform, { actor: { type: "ADMIN_USER", adminUserId: admin().id }, action, outcome, requestId, now: new Date() });
  const reports = async () => (await h.owner.query("SELECT report_id, status, kl_only, admin_only, window_from, window_to FROM kl.audit_correlation_report ORDER BY report_id")).rows;

  beforeAll(async () => {
    h = await startApiHarness();
    await h.mkUser("psin", "ADMIN"); // sin concesiones de KL
  });
  afterAll(() => h.close());

  it("ejecución limpia: operaciones reales por la API tienen su par en las dos bases y el reporte sale clean", async () => {
    await h.mkUser("peditor", "ADMIN");
    await h.send("post", "padmin", "/role-grants", { adminUserId: h.users.peditor?.id, role: "KL_EDITOR" }).expect(201);
    await h.get("peditor", "/me").expect(200);
    await h.send("post", "peditor", "/jobs", { kind: "review_now", payload: { publication_key: "inegi.enoe" } }).expect(202);
    await h.get("padmin", "/audit").expect(200); // lectura: sin par esperado en KL
    await h.send("post", "peditor", "/role-grants", { adminUserId: h.users.padmin?.id, role: "KL_EDITOR" }).expect(403); // DENIED: sin par esperado
    await sleep(GRACE + 80);
    const r = await run();
    expect(r).toMatchObject({ skipped: null, status: "clean", klOnly: [], adminOnly: [] });
    expect(r.klChecked).toBeGreaterThanOrEqual(3); // arranque, concesión y job
    expect(r.platformChecked).toBeGreaterThanOrEqual(5);
    expect((await reports()).map((x) => x.status)).toEqual(["clean"]);
  });

  it("X30: un evento de KL sin par en admin_audit_event y una acción ALLOWED sin cambio en KL aparecen en el reporte", async () => {
    // (a) cambio confirmado en KL, pero el registro de acceso en la base principal "falló"
    const orphanKl = randomUUID();
    await withAttestation(h.klApp, { adminUserId: admin().id, email: admin().email, role: "ADMIN", sessionId: randomUUID() }, orphanKl, (tx) => klAdmin.setRamCadence(tx, "none", "huérfano"));
    // (b) acción de escritura registrada como ALLOWED en la principal que no dejó cambio en KL
    const orphanPlatform = randomUUID();
    await platformAudit("kl.job.enqueue", "ALLOWED", orphanPlatform);
    // controles que NO deben marcarse: lectura ALLOWED, DENIED y FAILED sin cambio en KL
    await platformAudit("kl.me.read", "ALLOWED", randomUUID());
    await platformAudit("kl.role_grant.grant", "DENIED", randomUUID());
    await platformAudit("kl.job.enqueue", "FAILED", randomUUID());
    await sleep(GRACE + 80);
    const r = await run();
    expect(r.status).toBe("discrepancies");
    expect(r.klOnly.map((x) => x.requestId)).toEqual([orphanKl]);
    expect(r.klOnly[0]?.actions).toEqual(["kl.ram.cadence"]);
    expect(r.adminOnly).toEqual([{ requestId: orphanPlatform, action: "kl.job.enqueue" }]);
    const saved = (await reports()).at(-1);
    expect(saved?.status).toBe("discrepancies");
    expect(saved?.kl_only).toEqual([{ requestId: orphanKl, actions: ["kl.ram.cadence"] }]);
    expect(saved?.admin_only).toEqual([{ requestId: orphanPlatform, action: "kl.job.enqueue" }]);
    // el reporte aparece en Governance & Settings (API de lectura) para un KL_ADMIN y no para quien no tiene permisos
    const listed = await h.get("padmin", "/audit-correlation").expect(200);
    expect(listed.body.items[0]).toMatchObject({ status: "discrepancies" });
    await h.get("psin", "/audit-correlation").expect(403);
  });

  it("las ventanas no se traslapan ni se repite un hallazgo; la siguiente corrida solo ve lo nuevo", async () => {
    await sleep(GRACE + 60);
    const again = await run();
    expect(again.status).toBe("clean");
    expect(again.klOnly).toEqual([]);
    const all = await reports();
    for (let i = 1; i < all.length; i++) expect(new Date(all[i].window_from).getTime()).toBe(new Date(all[i - 1].window_to).getTime());
    // la base lo impone: una ventana que se traslapa con un reporte anterior se rechaza
    await expectSqlState(h.klApp.query("SELECT kl.record_correlation_report($1, $2, 0, 0, '[]'::jsonb, '[]'::jsonb)", [new Date(Date.now() - 3_600_000), new Date(Date.now() - 1000)]), "BV409");
  });

  it("la ejecución solo corre en una instancia a la vez (bloqueo consultivo)", async () => {
    const holder = await h.klApp.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(7306003)");
      expect((await run()).skipped).toBe("locked");
    } finally {
      await holder.query("SELECT pg_advisory_unlock(7306003)");
      holder.release();
    }
  });

  it("par entre ventanas: un cambio de KL al final de una ventana y su registro de acceso al inicio de la siguiente no es discrepancia", async () => {
    const req = randomUUID();
    const t0 = new Date(Date.now() - 60_000);
    await h.owner.query("BEGIN");
    await h.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
    await h.owner.query("INSERT INTO kl.audit_event (at, actor_principal_id, request_id, session_ref, action) VALUES ($1, $2, $3, repeat('a', 64), 'kl.border.case')", [t0, admin().id, req]);
    await h.owner.query("COMMIT");
    await recordAudit(h.platform, { actor: { type: "ADMIN_USER", adminUserId: admin().id }, action: "kl.border.case", outcome: "ALLOWED", requestId: req, now: new Date(t0.getTime() + 60) });
    // la ventana termina entre ambos (to = t0 + 30 ms)
    const at = new Date(t0.getTime() + 30 + GRACE);
    const r = await run({ now: () => at, graceMs: GRACE });
    expect(r.skipped === "window_too_small" || r.klOnly.length === 0).toBe(true);
    expect(r.klOnly.map((x) => x.requestId)).not.toContain(req);
    expect(r.adminOnly.map((x) => x.requestId)).not.toContain(req);
  });

  it("fallas parciales: sin la base principal o sin KL no se escribe ningún reporte y no hay falsos «limpio»", async () => {
    const before = (await reports()).length;
    const failingPlatform: Db = { query: (async () => { throw new Error("connect ECONNREFUSED"); }) as Db["query"], transaction: (async () => { throw new Error("x"); }) as Db["transaction"] };
    await sleep(GRACE + 60);
    await expect(run({ platform: failingPlatform })).rejects.toMatchObject({ side: "platform" });
    await expect(run({ platform: failingPlatform })).rejects.toBeInstanceOf(CorrelationIncomplete);
    expect((await reports()).length).toBe(before);
    // y la discrepancia que ocurre durante la falla se detecta cuando vuelve la conexión (la ventana no avanzó)
    const orphan = randomUUID();
    await platformAudit("kl.job.enqueue", "ALLOWED", orphan);
    await sleep(GRACE + 80);
    const r = await run();
    expect(r.adminOnly.map((x) => x.requestId)).toContain(orphan);
  });

  it("POST /audit-correlation/run: solo KL_ADMIN; su propio acceso deja par en KL y no se marca; los reportes no se pueden alterar", async () => {
    await h.send("post", "psin", "/audit-correlation/run").expect(403);
    await sleep(GRACE + 60);
    const res = await h.send("post", "padmin", "/audit-correlation/run").expect((r) => expect([201, 202]).toContain(r.status));
    expect(res.body).toHaveProperty("skipped");
    expect((await h.klAudit("kl.audit_correlation.run")).some((e) => e.request_id === res.headers["x-request-id"])).toBe(true);
    await expectSqlState(h.owner.query("DELETE FROM kl.audit_correlation_report"), "BV403");
    await expectSqlState(
      (async () => {
        await h.owner.query("BEGIN");
        try {
          await h.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
          await h.owner.query("UPDATE kl.audit_correlation_report SET status = 'clean'");
        } finally {
          await h.owner.query("ROLLBACK");
        }
      })(),
      "BV601",
    );
  });
});
