import { randomUUID } from "node:crypto";
import { workerPools } from "../db/pools";
import { runCycle } from "../worker/kl-worker";
import { describeKl, roleUrl } from "../testing/env";
import { asService, expectSqlState } from "../testing/kit";
import { buildWorld, run, seedSource, World } from "../testing/world";

describeKl("R3 · jobs de recolección atrasados y activación controlada de agentes", () => {
  let w: World;
  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => w.close());

  const q = async (sql: string, values: unknown[] = []) => (await w.k.owner.query(sql, values)).rows;
  const owner = async (sql: string, values: unknown[] = []) => {
    await w.k.owner.query("BEGIN");
    try {
      await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
      const r = await w.k.owner.query(sql, values);
      await w.k.owner.query("COMMIT");
      return r.rows;
    } catch (e) {
      await w.k.owner.query("ROLLBACK");
      throw e;
    }
  };
  const SVC = "00000000-0000-4000-8000-0000000000a2";
  /** Encola con la función interna y envejece el job (dos sentencias: lo insertado por un CTE no lo ve el UPDATE de la misma sentencia). */
  const enqueue = async (kind: string, pub: string, ageHours = 0) => {
    await w.k.owner.query("BEGIN");
    try {
      await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
      const id = (await w.k.owner.query("SELECT kl._enqueue($1, jsonb_build_object('publication_key', $2::text), $3::uuid) AS id", [kind, pub, SVC])).rows[0].id as string;
      await w.k.owner.query("UPDATE kl.job SET created_at = now() - make_interval(hours => $2) WHERE job_id = $1", [id, ageHours]);
      await w.k.owner.query("COMMIT");
      return [{ job_id: id }];
    } catch (e) {
      await w.k.owner.query("ROLLBACK");
      throw e;
    }
  };
  const setAgents = (enabled: boolean) =>
    owner("INSERT INTO kl.setting_version (key, version, value, authored_by) SELECT 'kl.agents_enabled', coalesce(max(version), 0) + 1, to_jsonb($1::boolean), $2::uuid FROM kl.setting_version WHERE key = 'kl.agents_enabled'", [enabled, SVC]);
  const claimAgent = (limit = 50) => asService(w.k.agent, async () => (await w.k.agent.query("SELECT job_id, kind FROM kl.claim_jobs(ARRAY['collect', 'review_now'], $1, 60)", [limit])).rows);
  const triage = () => asService(w.k.knowledge, async () => (await w.k.knowledge.query("SELECT kl.triage_stale_jobs() AS r")).rows[0].r as Record<string, number>);
  const plan = () => asService(w.k.knowledge, async () => (await w.k.knowledge.query("SELECT kl.plan_due() AS r")).rows[0].r as Record<string, number>);

  it("la base no entrega jobs de agentes mientras kl.agents_enabled sea false, aunque haya cola y un worker con credenciales", async () => {
    await enqueue("collect", "pub.alfa");
    await enqueue("review_now", "pub.beta");
    expect(await claimAgent()).toEqual([]);
    expect((await q("SELECT count(*)::int AS n FROM kl.job WHERE kind IN ('collect', 'review_now') AND attempts > 0"))[0]?.n).toBe(0);
    // y la configuración no deja encenderlos en esta fase
    await expectSqlState(run(w, w.admin, ["SELECT kl.set_setting('kl.agents_enabled', 'true'::jsonb)"]), "BV403");
    await expectSqlState(run(w, w.admin, ["SELECT kl.set_setting('kl.jobs.stale_after_hours', '0'::jsonb)"]), "BV422");
    await expectSqlState(run(w, w.admin, ["SELECT kl.set_setting('kl.agents.max_batch', '11'::jsonb)"]), "BV422");
    await expectSqlState(run(w, w.editor, ["SELECT kl.set_setting('kl.agents.max_batch', '2'::jsonb)"]), "BV403");
  });

  it("activación controlada (simulada en la base de pruebas): lotes acotados, manuales primero, y nunca se entregan los atrasados", async () => {
    await q("SELECT 1");
    await owner("UPDATE kl.job SET status = 'obsolete', lease_until = NULL, leased_by = NULL, lease_token = NULL, error_code = 'test_cleanup' WHERE kind IN ('collect', 'review_now')");
    for (let i = 0; i < 8; i++) await enqueue("collect", `pub.lote${i}`);
    await enqueue("review_now", "pub.manual");
    await enqueue("collect", "pub.vieja", 200); // 200 h: atrasada
    await setAgents(true);
    const first = await claimAgent();
    expect(first).toHaveLength(3); // tope por llamada (kl.agents.max_batch = 3)
    expect(first[0]?.kind).toBe("review_now"); // la acción manual auditada va primero
    expect(first.map((j) => j.kind).filter((k) => k === "collect")).toHaveLength(2);
    await run(w, w.admin, ["SELECT kl.set_setting('kl.agents.max_batch', '5'::jsonb)"]);
    expect(await claimAgent()).toHaveLength(5);
    const recent = (await q("SELECT count(*)::int AS n FROM kl.job WHERE kind IN ('collect', 'review_now') AND status = 'queued' AND created_at >= now() - interval '48 hours'"))[0]?.n as number;
    expect(recent).toBe(1); // 9 recientes − 3 − 5
    const rest = await claimAgent();
    expect(rest).toHaveLength(1); // solo queda el reciente; el atrasado nunca se entrega
    expect((await q("SELECT status, attempts FROM kl.job WHERE payload->>'publication_key' = 'pub.vieja'"))[0]).toEqual({ status: "queued", attempts: 0 });
    await setAgents(false);
    expect(await claimAgent()).toEqual([]);
  });

  it("triage: descarta duplicados, fuentes no elegibles y atrasados; la fuente queda «vencida» y el planificador encola UNO nuevo", async () => {
    await owner("UPDATE kl.job SET status = 'obsolete', lease_until = NULL, leased_by = NULL, lease_token = NULL, error_code = 'test_cleanup' WHERE status IN ('queued', 'leased')");
    const ok = await seedSource(w);
    const susp = await seedSource(w);
    await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'weekly')", [ok.publication]]);
    await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'weekly')", [susp.publication]]);
    await run(w, w.admin, ["SELECT kl.decide_publication($1, 'suspend')", [susp.publication]]);
    // duplicados de una fuente vigente (solo se conserva el más reciente), una de fuente suspendida y una atrasada
    const d1 = (await enqueue("collect", ok.publication, 3))[0]?.job_id as string;
    const d2 = (await enqueue("collect", ok.publication, 2))[0]?.job_id as string;
    const d3 = (await enqueue("collect", ok.publication, 1))[0]?.job_id as string;
    const ineligible = (await enqueue("collect", susp.publication))[0]?.job_id as string;
    const staleSrc = await seedSource(w);
    await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'weekly')", [staleSrc.publication]]);
    const stale = (await enqueue("collect", staleSrc.publication, 100))[0]?.job_id as string;
    await owner("UPDATE kl.publication SET next_check_at = now() + interval '6 days' WHERE key = $1", [staleSrc.publication]);

    const r = await triage();
    expect(r).toMatchObject({ ineligible: 1, duplicates: 2, stale: 1, renewed: 1 });
    const state = async (id: string) => (await q("SELECT status, error_code FROM kl.job WHERE job_id = $1", [id]))[0];
    expect(await state(d1)).toEqual({ status: "obsolete", error_code: "duplicate" });
    expect(await state(d2)).toEqual({ status: "obsolete", error_code: "duplicate" });
    expect((await state(d3))?.status).toBe("queued");
    expect(await state(ineligible)).toEqual({ status: "obsolete", error_code: "source_not_eligible" });
    expect(await state(stale)).toEqual({ status: "obsolete", error_code: "stale" });
    // vigencia al día: la fuente atrasada queda vencida y el planificador encola exactamente un collect nuevo (no un lote de atrasados)
    expect(((await q("SELECT next_check_at <= now() AS due FROM kl.publication WHERE key = $1", [staleSrc.publication]))[0] as { due: boolean }).due).toBe(true);
    expect((await plan()).publicationJobs).toBeGreaterThanOrEqual(1);
    const fresh = await q("SELECT job_id FROM kl.job WHERE kind = 'collect' AND status = 'queued' AND payload->>'publication_key' = $1", [staleSrc.publication]);
    expect(fresh).toHaveLength(1);
    expect((await q("SELECT count(*)::int AS n FROM kl.audit_event WHERE action = 'kl.jobs.triage'"))[0]?.n).toBeGreaterThanOrEqual(1);
    await expect(triageAs(w, "kl_agent")).rejects.toMatchObject({ code: "42501" }); // solo el rol de conocimiento
  });

  it("tras una larga parada con muchas fuentes atrasadas: una sola pasada deja a lo sumo un collect reciente por fuente y el procesamiento sigue acotado", async () => {
    await owner("UPDATE kl.job SET status = 'obsolete', lease_until = NULL, leased_by = NULL, lease_token = NULL, error_code = 'test_cleanup' WHERE status IN ('queued', 'leased')");
    const pubs: string[] = [];
    for (let i = 0; i < 12; i++) {
      const s = await seedSource(w);
      await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'weekly')", [s.publication]]);
      pubs.push(s.publication);
      for (let d = 0; d < 3; d++) await enqueue("collect", s.publication, 100 + d * 24); // 3 atrasados por fuente
      await owner("UPDATE kl.publication SET next_check_at = now() - interval '30 days' WHERE key = $1", [s.publication]);
    }
    expect((await q("SELECT count(*)::int AS n FROM kl.job WHERE kind = 'collect' AND status = 'queued'"))[0]?.n).toBe(36);
    const t = await triage();
    expect(t).toMatchObject({ duplicates: 24, stale: 12, renewed: 12 }); // 3 por fuente: 2 duplicados y 1 atrasado
    const p = await plan();
    expect(p.publicationJobs).toBe(12); // uno por fuente, no 36
    const perPub = await q("SELECT payload->>'publication_key' AS p, count(*)::int AS n FROM kl.job WHERE kind = 'collect' AND status = 'queued' GROUP BY 1");
    expect(perPub).toHaveLength(12);
    expect(perPub.every((r) => r.n === 1)).toBe(true);
    // y aun activados, un worker procesa en lotes de 3
    await run(w, w.admin, ["SELECT kl.set_setting('kl.agents.max_batch', '3'::jsonb)"]);
    await setAgents(true);
    expect(await claimAgent()).toHaveLength(3);
    expect(await claimAgent()).toHaveLength(3);
    await setAgents(false);
    void pubs;
  });

  it("el mantenimiento del worker corre el triage junto con el planificador y las validaciones, sin red y sin tocar jobs de agentes recientes", async () => {
    const wp = workerPools({ agentUrl: roleUrl("kl_agent"), knowledgeUrl: roleUrl("kl_knowledge") });
    try {
      const attempts = async () => (await q("SELECT coalesce(sum(attempts), 0)::int AS n FROM kl.job WHERE kind IN ('collect', 'review_now')"))[0]?.n;
      const before = await attempts();
      const r = await runCycle(wp);
      expect(r.maintenance?.triage).toMatchObject({ ineligible: expect.any(Number), duplicates: expect.any(Number), stale: expect.any(Number) });
      // el planificador puede encolar los vencidos (uno por fuente), pero ningún job de agente se reclama ni se ejecuta
      expect(await attempts()).toBe(before);
    } finally {
      await wp.close();
    }
  });
});

async function triageAs(w: World, role: "kl_agent") {
  return asService(w.k[role === "kl_agent" ? "agent" : "knowledge"], () => w.k.agent.query("SELECT kl.triage_stale_jobs()"));
}
void randomUUID;
