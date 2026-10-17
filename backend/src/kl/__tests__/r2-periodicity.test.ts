import { randomUUID } from "node:crypto";
import { workerPools } from "../db/pools";
import { compilePackage } from "../packages/compiler";
import { runCycle } from "../worker/kl-worker";
import { describeKl, roleUrl } from "../testing/env";
import { asService, expectDenied, expectSqlState } from "../testing/kit";
import { buildWorld, createCardVersion, one, pools, publishCard, publishStat, run, seedSource, World } from "../testing/world";

describeKl("R2 · periodicidad (PO-6), planificador sobre kl.job y acciones manuales", () => {
  let w: World;
  let p: ReturnType<typeof pools>;
  beforeAll(async () => {
    w = await buildWorld();
    p = pools();
  });
  afterAll(async () => {
    await p.closeAll();
    await w.close();
  });

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
  const q = async (sql: string, values: unknown[] = []) => (await w.k.owner.query(sql, values)).rows;
  const plan = () => asService(w.k.knowledge, async () => (await w.k.knowledge.query("SELECT kl.plan_due() AS r")).rows[0].r as Record<string, number>);
  const collectJobs = async (pub?: string) => q("SELECT job_id, status, payload->>'publication_key' AS pub FROM kl.job WHERE kind = 'collect' AND ($1::text IS NULL OR payload->>'publication_key' = $1) ORDER BY created_at", [pub ?? null]);
  const audit = async (action: string) => q("SELECT actor_principal_id, entity_id, from_status, to_status, reason FROM kl.audit_event WHERE action = $1 ORDER BY event_id", [action]);
  const effective = async (pub: string) => (await q("SELECT kl.effective_check_frequency(id)::text AS f FROM kl.publication WHERE key = $1", [pub]))[0]?.f as string;

  /** Un producto que cita una unidad de la fuente (la composición completa es de R3; aquí basta el vínculo). */
  const product = async (key: string, cadence: string, unitKeys: string[]) => {
    await run(w, w.admin, ["SELECT kl.create_product($1, 'MX', $2::kl.cadence)", [key, cadence]]);
    await owner(
      "INSERT INTO kl.product_section (product_id, section_key, chapter, slot, sort_order, title_es, title_en, content_type) SELECT id, 'ch01.essentials', '01', 'essentials', 1, 'x', 'x', 'data' FROM kl.product WHERE key = $1",
      [key],
    );
    for (const [i, u] of unitKeys.entries()) {
      await owner("INSERT INTO kl.composition_item (section_id, unit_id, sort_order) SELECT ps.id, u.id, $3 FROM kl.product_section ps JOIN kl.product pr ON pr.id = ps.product_id, kl.unit u WHERE pr.key = $1 AND u.unit_key = $2", [key, u, i + 1]);
    }
  };

  describe("calendario y enumerado", () => {
    it("kl.next_due: calendario de la Ciudad de México, fin de mes y none", async () => {
      const d = async (base: string, c: string) => (await q("SELECT kl.next_due($1::timestamptz, $2::kl.cadence) AS d", [base, c]))[0]?.d as Date | null;
      expect((await d("2026-01-31T18:00:00Z", "monthly"))?.toISOString()).toBe("2026-02-28T18:00:00.000Z");
      expect((await d("2026-10-16T18:00:00Z", "weekly"))?.toISOString()).toBe("2026-10-23T18:00:00.000Z");
      expect((await d("2026-10-16T18:00:00Z", "quarterly"))?.toISOString()).toBe("2027-01-16T18:00:00.000Z");
      expect((await d("2026-10-16T18:00:00Z", "semiannual"))?.toISOString()).toBe("2027-04-16T18:00:00.000Z");
      expect((await d("2026-10-16T18:00:00Z", "annual"))?.toISOString()).toBe("2027-10-16T18:00:00.000Z");
      expect(await d("2026-10-16T18:00:00Z", "none")).toBeNull();
    });
    it("no existe valor diario: ni en el enumerado ni en la frecuencia de una fuente", async () => {
      await expectSqlState(run(w, w.admin, ["SELECT kl.create_product('prod_diario', 'MX', 'daily'::kl.cadence)"]), "22P02");
      const src = await seedSource(w);
      await expectSqlState(run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'daily')", [src.publication]]), "BV422");
    });
  });

  describe("productos y fuentes: solo KL_ADMIN, con versión de configuración y auditoría", () => {
    it("crear producto y cambiar su periodicidad", async () => {
      await expectSqlState(run(w, w.editor, ["SELECT kl.create_product('prod_a', 'MX')"]), "BV403");
      await run(w, w.admin, ["SELECT kl.create_product('prod_a', 'MX')"]);
      const created = (await q("SELECT review_periodicity::text AS p, next_cycle_at > now() + interval '170 days' AS later FROM kl.product WHERE key = 'prod_a'"))[0];
      expect(created).toEqual({ p: "semiannual", later: true }); // Doing Business-style por defecto: semestral
      await expectSqlState(run(w, w.editor, ["SELECT kl.set_product_periodicity('prod_a', 'monthly')"]), "BV403");
      await expectSqlState(run(w, w.admin, ["SELECT kl.set_product_periodicity('prod_a', 'semiannual')"]), "BV409");
      await expectSqlState(run(w, w.admin, ["SELECT kl.set_product_periodicity('no_existe', 'monthly')"]), "BV404");
      await run(w, w.admin, ["SELECT kl.set_product_periodicity('prod_a', 'monthly', 'ciclo más corto')"]);
      expect((await q("SELECT version, value FROM kl.setting_version WHERE key = 'kl.product_cadence.prod_a' ORDER BY version")).map((r) => [r.version, r.value])).toEqual([[1, "semiannual"], [2, "monthly"]]);
      expect((await audit("kl.product.periodicity")).some((e) => e.from_status === "semiannual" && e.to_status === "monthly" && e.reason === "ciclo más corto" && e.actor_principal_id === w.admin.id)).toBe(true);
      await run(w, w.admin, ["SELECT kl.set_product_periodicity('prod_a', 'none')"]);
      expect((await q("SELECT next_cycle_at FROM kl.product WHERE key = 'prod_a'"))[0]?.next_cycle_at).toBeNull();
    });

    it("la frecuencia de una fuente crea versión de configuración y se rechaza si no cambia o si la fuente está revocada", async () => {
      const src = await seedSource(w);
      await expectSqlState(run(w, w.reviewer, ["SELECT kl.set_publication_frequency($1, 'weekly')", [src.publication]]), "BV403");
      await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'weekly', 'ventana semanal')", [src.publication]]);
      await expectSqlState(run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'weekly')", [src.publication]]), "BV409");
      await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'none')", [src.publication]]);
      const versions = await q("SELECT version, config->>'check_frequency' AS f FROM kl.publication_config_version pcv JOIN kl.publication p ON p.id = pcv.publication_id WHERE p.key = $1 ORDER BY version", [src.publication]);
      expect(versions.map((v) => [v.version, v.f])).toEqual([[1, "weekly"], [2, "none"]]);
      expect((await q("SELECT next_check_at FROM kl.publication WHERE key = $1", [src.publication]))[0]?.next_check_at).toBeNull();
      await run(w, w.admin, ["SELECT kl.decide_publication($1, 'revoke')", [src.publication]]);
      await expectSqlState(run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'monthly')", [src.publication]]), "BV409");
    });
  });

  describe("herencia y excepciones de periodicidad", () => {
    it("inherit toma la periodicidad más frecuente de los productos que citan la fuente; sin consumidores es none; un valor propio manda", async () => {
      const src = await seedSource(w);
      await publishStat(w, { key: "stat.mx.her.1", indicator: src.indicator, publication: src.publication });
      expect(await effective(src.publication)).toBe("none"); // nadie la usa
      await product("prod_q", "quarterly", ["stat.mx.her.1"]);
      expect(await effective(src.publication)).toBe("quarterly");
      await product("prod_m", "monthly", ["stat.mx.her.1"]);
      expect(await effective(src.publication)).toBe("monthly"); // la más frecuente
      await product("prod_n", "none", ["stat.mx.her.1"]);
      expect(await effective(src.publication)).toBe("monthly"); // none no cuenta
      await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'annual')", [src.publication]]);
      expect(await effective(src.publication)).toBe("annual"); // excepción propia
      await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'inherit')", [src.publication]]);
      expect(await effective(src.publication)).toBe("monthly");
      await run(w, w.admin, ["SELECT kl.set_product_periodicity('prod_m', 'weekly')"]);
      expect(await effective(src.publication)).toBe("weekly"); // el cambio del producto se hereda
      const sched = await q("SELECT effective_check_frequency::text AS e FROM kl.v_admin_publication_schedule WHERE key = $1", [src.publication]).catch(() => []);
      void sched;
    });

    it("la RAM solo obliga a revisar una fuente si KL_ADMIN fija una cadencia de RAM", async () => {
      const src = await seedSource(w);
      await publishCard(w, { key: `card.mx.ram.${randomUUID().slice(0, 4)}`, topic: "ram.tema", publication: src.publication });
      await compilePackage(p.knowledge, { destinationCountry: "MX", stage: "precision_by_category", categoryKey: "logistics", locale: "es", budgetTokens: 9000 });
      expect(await effective(src.publication)).toBe("none");
      await run(w, w.admin, ["SELECT kl.set_ram_cadence('quarterly', 'RAM al día')"]);
      expect(await effective(src.publication)).toBe("quarterly");
      await expectSqlState(run(w, w.editor, ["SELECT kl.set_ram_cadence('weekly')"]), "BV403");
      await run(w, w.admin, ["SELECT kl.set_ram_cadence('none')"]);
      expect(await effective(src.publication)).toBe("none");
    });
  });

  describe("planificador: calendario → kl.job, sin consultas externas", () => {
    it("una fuente nueva recibe fecha sin disparar consulta; al vencer encola un solo collect y avanza; no duplica", async () => {
      const src = await seedSource(w);
      await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'weekly')", [src.publication]]);
      expect(await collectJobs(src.publication)).toEqual([]);
      await owner("UPDATE kl.publication SET next_check_at = NULL WHERE key = $1", [src.publication]);
      const init = await plan();
      expect(init.initialized).toBeGreaterThanOrEqual(1);
      expect(await collectJobs(src.publication)).toEqual([]); // inicializar no consulta
      const first = (await q("SELECT next_check_at FROM kl.publication WHERE key = $1", [src.publication]))[0]?.next_check_at as Date;
      expect(first.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

      await owner("UPDATE kl.publication SET next_check_at = now() - interval '1 minute' WHERE key = $1", [src.publication]);
      expect((await plan()).publicationJobs).toBe(1);
      const jobs = await collectJobs(src.publication);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.status).toBe("queued");
      const next = (await q("SELECT next_check_at FROM kl.publication WHERE key = $1", [src.publication]))[0]?.next_check_at as Date;
      expect(next.getTime()).toBeGreaterThan(Date.now() + 6 * 86_400_000);

      // vence otra vez con el job aún pendiente: no se apila
      await owner("UPDATE kl.publication SET next_check_at = now() - interval '1 minute' WHERE key = $1", [src.publication]);
      expect((await plan()).publicationJobs).toBe(0);
      expect(await collectJobs(src.publication)).toHaveLength(1);
      expect((await audit("kl.planner.tick")).length).toBeGreaterThanOrEqual(1);
    });

    it("none no programa nada; revocada, suspendida o descontinuada nunca se programa y pierde su fecha", async () => {
      const a = await seedSource(w);
      await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'weekly')", [a.publication]]);
      await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'none')", [a.publication]]);
      await owner("UPDATE kl.publication SET next_check_at = now() - interval '1 day' WHERE key = $1", [a.publication]);
      await plan();
      expect(await collectJobs(a.publication)).toEqual([]);
      expect((await q("SELECT next_check_at FROM kl.publication WHERE key = $1", [a.publication]))[0]?.next_check_at).toBeNull();

      for (const decision of ["suspend", "revoke"]) {
        const s = await seedSource(w);
        await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'weekly')", [s.publication]]);
        await run(w, w.admin, ["SELECT kl.decide_publication($1, $2)", [s.publication, decision]]);
        await owner("UPDATE kl.publication SET next_check_at = now() - interval '1 day' WHERE key = $1", [s.publication]);
        await plan();
        expect(await collectJobs(s.publication)).toEqual([]);
        expect((await q("SELECT next_check_at FROM kl.publication WHERE key = $1", [s.publication]))[0]?.next_check_at).toBeNull();
      }
    });

    it("ciclo de producto: una sola revisión de las fuentes que cita y la fecha avanza; none no ciclo", async () => {
      const src = await seedSource(w);
      await publishStat(w, { key: "stat.mx.ciclo.1", indicator: src.indicator, publication: src.publication });
      await product("prod_ciclo", "quarterly", ["stat.mx.ciclo.1"]);
      await run(w, w.admin, ["SELECT kl.set_publication_frequency($1, 'none')", [src.publication]]); // la fuente no se programa sola: solo el ciclo del producto
      await owner("UPDATE kl.product SET next_cycle_at = now() - interval '1 hour' WHERE key = 'prod_ciclo'");
      const r = await plan();
      expect(r.productCycleJobs).toBe(1);
      expect((await collectJobs(src.publication)).map((j) => j.status)).toEqual(["queued"]);
      expect(((await q("SELECT next_cycle_at FROM kl.product WHERE key = 'prod_ciclo'"))[0]?.next_cycle_at as Date).getTime()).toBeGreaterThan(Date.now() + 80 * 86_400_000);
      expect((await plan()).productCycleJobs).toBe(0);
    });

    it("solo el rol de conocimiento planifica; kl_app y kl_agent no; collect y extraordinary no se encolan a mano", async () => {
      await expectDenied(asService(w.k.agent, () => w.k.agent.query("SELECT kl.plan_due()")));
      await expectDenied(w.k.app.query("SELECT kl.plan_due()"));
      await expectSqlState(asService(w.k.knowledge, () => w.k.knowledge.query("SELECT kl.enqueue_job('collect', '{\"publication_key\":\"x\"}')")), "BV403");
      await expectSqlState(run(w, w.admin, ["SELECT kl.enqueue_job('extraordinary_edition', '{\"product_key\":\"x\",\"reason_code\":\"abc\"}')"]), "BV403");
    });

    it("sin agentes los jobs de recolección esperan en cola: el worker los deja intactos aunque corra el mantenimiento", async () => {
      const wp = workerPools({ agentUrl: roleUrl("kl_agent"), knowledgeUrl: roleUrl("kl_knowledge") });
      try {
        const before = await q("SELECT count(*)::int AS n FROM kl.job WHERE kind IN ('collect', 'review_now') AND status = 'queued'");
        const r = await runCycle(wp);
        expect(r.maintenance).toBeDefined();
        const after = await q("SELECT count(*)::int AS n FROM kl.job WHERE kind IN ('collect', 'review_now') AND status = 'queued'");
        expect(after[0]?.n).toBe(before[0]?.n);
        expect((await q("SELECT count(*)::int AS n FROM kl.job WHERE kind IN ('collect', 'review_now') AND status <> 'queued'"))[0]?.n).toBe(0);
      } finally {
        await wp.close();
      }
    });
  });

  describe("«Revisar ahora» y edición extraordinaria", () => {
    it("check-now: KL_EDITOR o KL_ADMIN, con motivo, solo fuentes aprobadas, deduplicado y auditado", async () => {
      const src = await seedSource(w);
      await expectSqlState(run(w, w.reviewer, ["SELECT kl.check_now('publication', $1, 'motivo válido')", [src.publication]]), "BV403");
      await expectSqlState(run(w, w.editor, ["SELECT kl.check_now('publication', $1, '')", [src.publication]]), "BV422");
      await expectSqlState(run(w, w.editor, ["SELECT kl.check_now('publication', $1, 'ab')", [src.publication]]), "BV422");
      await expectSqlState(run(w, w.editor, ["SELECT kl.check_now('publication', 'no.existe', 'motivo válido')"]), "BV409");
      await expectSqlState(run(w, w.editor, ["SELECT kl.check_now('otro', $1, 'motivo válido')", [src.publication]]), "BV422");
      const ids = (await one(w, w.editor, "SELECT kl.check_now('publication', $1, 'cambio anunciado por la fuente') AS j", [src.publication])).j as string[];
      expect(ids).toHaveLength(1);
      const again = (await one(w, w.admin, "SELECT kl.check_now('publication', $1, 'segunda petición') AS j", [src.publication])).j as string[];
      expect(again).toEqual(ids); // se reutiliza el job pendiente
      expect((await q("SELECT kind, status, payload FROM kl.job WHERE job_id = $1", [ids[0]]))[0]).toEqual({ kind: "review_now", status: "queued", payload: { publication_key: src.publication } });
      const ev = await audit("kl.check_now");
      expect(ev.some((e) => e.reason === "cambio anunciado por la fuente" && e.actor_principal_id === w.editor.id && e.to_status === "1 new / 0 reused")).toBe(true);
      expect(ev.some((e) => e.reason === "segunda petición" && e.to_status === "0 new / 1 reused")).toBe(true);
      // una fuente suspendida o revocada no se revisa
      await run(w, w.admin, ["SELECT kl.decide_publication($1, 'suspend')", [src.publication]]);
      await expectSqlState(run(w, w.editor, ["SELECT kl.check_now('publication', $1, 'ya suspendida')", [src.publication]]), "BV409");
    });

    it("check-now de un producto: un review_now por fuente citada; sin fuentes se rechaza", async () => {
      const a = await seedSource(w);
      const b = await seedSource(w);
      await publishStat(w, { key: "stat.mx.cn.a", indicator: a.indicator, publication: a.publication });
      await publishStat(w, { key: "stat.mx.cn.b", indicator: b.indicator, publication: b.publication });
      await product("prod_cn", "monthly", ["stat.mx.cn.a", "stat.mx.cn.b"]);
      const ids = (await one(w, w.editor, "SELECT kl.check_now('product', 'prod_cn', 'revisión de fin de mes') AS j")).j as string[];
      expect(ids).toHaveLength(2);
      await run(w, w.admin, ["SELECT kl.create_product('prod_vacio', 'MX')"]);
      await expectSqlState(run(w, w.editor, ["SELECT kl.check_now('product', 'prod_vacio', 'sin fuentes')"]), "BV409");
      await expectSqlState(run(w, w.editor, ["SELECT kl.check_now('product', 'no_existe', 'sin producto')"]), "BV404");
    });

    it("edición extraordinaria: solo KL_ADMIN, con código y motivo, una pendiente por producto, auditada", async () => {
      await run(w, w.admin, ["SELECT kl.create_product('prod_ext', 'MX')"]);
      await expectSqlState(run(w, w.editor, ["SELECT kl.extraordinary_edition('prod_ext', 'reforma_dof', 'reforma publicada')"]), "BV403");
      await expectSqlState(run(w, w.admin, ["SELECT kl.extraordinary_edition('prod_ext', 'Código Inválido', 'reforma publicada')"]), "BV422");
      await expectSqlState(run(w, w.admin, ["SELECT kl.extraordinary_edition('prod_ext', 'reforma_dof', '')"]), "BV422");
      await expectSqlState(run(w, w.admin, ["SELECT kl.extraordinary_edition('no_existe', 'reforma_dof', 'reforma publicada')"]), "BV404");
      const id = (await one(w, w.admin, "SELECT kl.extraordinary_edition('prod_ext', 'reforma_dof', 'reforma publicada en el DOF') AS j")).j;
      expect((await q("SELECT kind, payload FROM kl.job WHERE job_id = $1", [id]))[0]).toEqual({ kind: "extraordinary_edition", payload: { product_key: "prod_ext", reason_code: "reforma_dof" } });
      await expectSqlState(run(w, w.admin, ["SELECT kl.extraordinary_edition('prod_ext', 'otra_reforma', 'segunda')"]), "BV409");
      expect((await audit("kl.extraordinary_edition")).some((e) => e.reason === "reforma_dof: reforma publicada en el DOF" && e.actor_principal_id === w.admin.id)).toBe(true);
    });
  });

  describe("validación: aviso y vencimiento respetan las reglas de actualización", () => {
    it("30 días antes avisa una sola vez; al vencer marca requires_review, invalida paquetes y avisa a los productos", async () => {
      const src = await seedSource(w);
      const key = `card.mx.valexp.${randomUUID().slice(0, 4)}`;
      const { versionId } = await createCardVersion(w, { key, risk: "high", cardType: "normative", topic: "valexp.tema", publication: src.publication });
      await run(w, w.editor, ["SELECT kl.submit_version($1)", [versionId]]);
      await run(w, w.reviewer, ["SELECT kl.approve_version($1)", [versionId]]);
      await run(w, w.reviewer2, ["SELECT kl.approve_variant($1, 'en')", [versionId]]);
      const validator = (await one(w, w.reviewer, "SELECT kl.register_validator('internal', $1, 'Interno', NULL, ARRAY['legal.mx'], NULL) AS v", [w.specialist.id])).v as string;
      expect((await one(w, w.specialist, "SELECT kl.record_validation($1, $2, 'es', 'legal.mx', 'alcance', 'approved', NULL, now() - interval '1 day', now() + interval '2 seconds') AS s", [versionId, validator])).s).toBe("published");
      await product("prod_val", "annual", [key]);
      await compilePackage(p.knowledge, { destinationCountry: "MX", stage: "precision_by_category", categoryKey: "logistics", locale: "es", budgetTokens: 9000 });
      const pkgBefore = (await q("SELECT count(*)::int AS n FROM kl.context_package WHERE status = 'active'"))[0]?.n as number;
      expect(pkgBefore).toBeGreaterThan(0);

      const maint = () => asService(w.k.knowledge, async () => (await w.k.knowledge.query("SELECT kl.expire_validations() AS r")).rows[0].r as { warned: number; expired: number });
      expect((await maint()).warned).toBeGreaterThanOrEqual(1);
      expect((await maint()).warned).toBe(0); // idempotente
      const notices = () => q("SELECT n.kind, n.status FROM kl.change_notice n JOIN kl.unit u ON u.id = n.unit_id WHERE u.unit_key = $1", [key]);
      expect(await notices()).toEqual([{ kind: "validation_expiring", status: "pending" }]);

      await new Promise((r) => setTimeout(r, 2300));
      const r = await maint();
      expect(r.expired).toBeGreaterThanOrEqual(1);
      expect((await q("SELECT sv.status, uv.requires_review FROM kl.specialist_validation sv JOIN kl.unit_version uv ON uv.id = sv.unit_version_id WHERE uv.id = $1", [versionId]))[0]).toEqual({ status: "expired", requires_review: true });
      expect((await q("SELECT count(*)::int AS n FROM kl.context_package WHERE status = 'active'"))[0]?.n).toBe(0); // el paquete que la contenía se invalidó
      expect((await maint()).expired).toBe(0);
      expect(await notices()).toHaveLength(1); // no se duplica el aviso
      await expectDenied(w.k.app.query("SELECT kl.expire_validations()"));
    });
  });
});
