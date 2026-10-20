import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { asPerson, asService, attest, bootstrapAdmin, Conns, expectDenied, expectSqlState, grantTo, openConns, Person, person, requireAs, sessionRef, tx } from "../testing/kit";
import { describeKl, freshKlDatabase } from "../testing/env";

const AGENT = "00000000-0000-4000-8000-0000000000a1";
const KNOWLEDGE = "00000000-0000-4000-8000-0000000000a2";

describeKl("KL-0001 · identidad, certificación y autorización", () => {
  let k: Conns;
  let admin: Person;

  beforeAll(async () => {
    await freshKlDatabase();
    k = await openConns();
    admin = await bootstrapAdmin(k.owner);
  });
  afterAll(() => k.closeAll());

  const audit = async (action: string) => (await k.owner.query("SELECT * FROM kl.audit_event WHERE action = $1 ORDER BY event_id", [action])).rows;

  describe("X02 · kl.principal es inmutable y no se borra", () => {
    it("DELETE rechazado incluso para kl_owner con mutación autorizada", async () => {
      await expectSqlState(
        tx(k.owner, async () => {
          await k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
          await k.owner.query("DELETE FROM kl.principal WHERE principal_id = $1", [admin.id]);
        }),
        "BV601",
      );
    });
    it.each([
      ["principal_id", "principal_id = gen_random_uuid()"],
      ["kind", "kind = 'service', auth_identity = 'x@beeside.internal'"],
      ["auth_identity", "auth_identity = 'otro@synthetic.test'"],
      ["first_seen_at", "first_seen_at = now() - interval '1 day'"],
    ])("cambiar %s es rechazado por trigger", async (_c, set) => {
      await expectSqlState(
        tx(k.owner, async () => {
          await k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
          await k.owner.query(`UPDATE kl.principal SET ${set} WHERE principal_id = $1`, [admin.id]);
        }),
        "BV601",
      );
    });
    it("sin mutación autorizada ni el dueño puede escribir directo (BV403)", async () => {
      await expectSqlState(k.owner.query("UPDATE kl.principal SET active = false WHERE principal_id = $1", [admin.id]), "BV403");
      await expectSqlState(k.owner.query("TRUNCATE kl.principal CASCADE"), "BV601");
    });
  });

  describe("X03 · ningún rol de aplicación tiene DML ni lectura directa de tablas", () => {
    const tables = ["principal", "request_attestation", "role_grant", "audit_event", "permission_role", "job", "job_kind"];
    it.each(["app", "reader", "agent", "knowledge"] as const)("%s: permission denied en cada tabla", async (who) => {
      for (const t of tables) {
        await expectDenied(k[who].query(`INSERT INTO kl.${t} DEFAULT VALUES`));
        await expectDenied(k[who].query(`UPDATE kl.${t} SET created_at = now()`));
        await expectDenied(k[who].query(`DELETE FROM kl.${t}`));
        await expectDenied(k[who].query(`SELECT 1 FROM kl.${t}`));
      }
    });
  });

  describe("X04/X05 · sin certificación de ESTA transacción no hay operación sensible", () => {
    it("X04: llamar a una función de mutación sin kl.attest → BV403", async () => {
      await expectSqlState(k.app.query("SELECT kl.enqueue_job('review_now', '{\"publication_key\":\"inegi.enoe\"}')"), "BV403");
      await expectSqlState(k.app.query("SELECT kl.grant_role($1, 'x@synthetic.test', 'KL_EDITOR', false, '{}')", [randomUUID()]), "BV403");
    });
    it("X05: certificar en A y operar en B (misma conexión y principal) → BV403", async () => {
      await tx(k.app, () => attest(k.app, admin));
      await expectSqlState(tx(k.app, () => k.app.query("SELECT kl.enqueue_job('review_now', '{\"publication_key\":\"inegi.enoe\"}')")), "BV403");
    });
    it("una sola certificación por transacción", async () => {
      await expectSqlState(
        tx(k.app, async () => {
          await attest(k.app, admin);
          await attest(k.app, person("otro"));
        }),
        "BV403",
      );
    });
    it("un valor de sesión fijado por el llamador no sustituye a la certificación", async () => {
      await expectSqlState(
        tx(k.app, async () => {
          await k.app.query("SELECT set_config('kl.actor', $1, true), set_config('kl.mutation_authorized', 'on', true)", [admin.id]);
          await k.app.query("SELECT kl.enqueue_job('review_now', '{\"publication_key\":\"inegi.enoe\"}')");
        }),
        "BV403",
      );
    });
    it("la certificación queda registrada (solo inserción)", async () => {
      const n = await k.owner.query("SELECT count(*)::int AS n FROM kl.request_attestation WHERE principal_id = $1", [admin.id]);
      expect(n.rows[0].n).toBeGreaterThan(0);
      await expectSqlState(
        tx(k.owner, async () => {
          await k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
          await k.owner.query("DELETE FROM kl.request_attestation");
        }),
        "BV601",
      );
    });
  });

  describe("X06/X22 · conciliación solo desactiva; la certificación reactiva", () => {
    it("reconcile_principal desactiva, nunca reactiva", async () => {
      const p = await grantTo(k.app, admin, "recon", "KL_EDITOR");
      await asPerson(k.app, p, () => k.app.query("SELECT 1")); // activa el principal con su primera certificación
      expect((await k.app.query("SELECT kl.reconcile_principal($1, false) AS changed", [p.id])).rows[0].changed).toBe(true);
      expect((await k.owner.query("SELECT active, deactivation_source FROM kl.principal WHERE principal_id = $1", [p.id])).rows[0]).toEqual({ active: false, deactivation_source: "reconciliation" });
      expect((await k.app.query("SELECT kl.reconcile_principal($1, true) AS changed", [p.id])).rows[0].changed).toBe(false);
      expect((await k.owner.query("SELECT active FROM kl.principal WHERE principal_id = $1", [p.id])).rows[0].active).toBe(false);
      // un principal inactivo no autoriza aunque tenga concesión
      expect(await requireAs(k.owner, p.id, "ADMIN", "job.enqueue")).toBe("denied");
      // la certificación válida (sesión resuelta en la base principal) lo reactiva
      await asPerson(k.app, p, () => k.app.query("SELECT 1"));
      expect((await k.owner.query("SELECT active, deactivated_at FROM kl.principal WHERE principal_id = $1", [p.id])).rows[0]).toEqual({ active: true, deactivated_at: null });
      expect(await requireAs(k.owner, p.id, "ADMIN", "job.enqueue")).toBe("allowed");
      expect((await audit("kl.principal.deactivated")).some((e) => e.entity_id === p.id)).toBe(true);
    });
  });

  describe("X07 · identidad que no coincide", () => {
    it("rechaza, no certifica y deja kl.identity_mismatch", async () => {
      const victim = await grantTo(k.app, admin, "victima", "KL_EDITOR");
      await asPerson(k.app, victim, () => k.app.query("SELECT 1"));
      const status = await tx(k.app, async () => {
        const st = await attest(k.app, { id: victim.id, email: "impostor@synthetic.test" });
        return st;
      });
      expect(status).toBe("identity_mismatch");
      const events = await audit("kl.identity_mismatch");
      expect(events.some((e) => e.entity_id === victim.id)).toBe(true);
      // y sin certificación la operación falla
      await expectSqlState(
        tx(k.app, async () => {
          await attest(k.app, { id: victim.id, email: "impostor@synthetic.test" });
          await k.app.query("SELECT kl.enqueue_job('review_now', '{\"publication_key\":\"inegi.enoe\"}')");
        }),
        "BV403",
      );
    });
    it("un correo ya usado por otro principal tampoco se certifica; las identidades técnicas se rechazan", async () => {
      const other = person("dup");
      const holder = await grantTo(k.app, admin, "titular", "KL_EDITOR");
      expect(await tx(k.app, () => attest(k.app, { id: other.id, email: holder.email }))).toBe("identity_mismatch");
      await expectSqlState(tx(k.app, () => attest(k.app, { id: randomUUID(), email: "kl-agent@beeside.internal" })), "BV403");
    });
  });

  describe("X10 · una cuenta de servicio no aprueba, valida, concede, revoca ni publica", () => {
    const human = [
      "source.decide", "content.author", "content.approve_l2", "validation.validate", "validation.record_external", "demand.decide", "demand.decide_admin",
      "product.approve_change", "edition.approve", "edition.unpublish", "edition.revoke", "ram.propose_equivalence", "settings.write", "ram.auto_promotion", "roles.grant", "roles.revoke",
      "job.enqueue", "job.enqueue_extraordinary", "kl.read",
    ];
    it.each([AGENT, KNOWLEDGE])("servicio %s denegado en todos los permisos humanos", async (svc) => {
      for (const p of human) expect(await requireAs(k.owner, svc, "SERVICE", p, "legal.mx")).toBe("denied");
    });
    it("por el camino real: kl_knowledge certificado intenta encolar con permiso humano → BV403", async () => {
      await expectSqlState(asService(k.knowledge, () => k.knowledge.query("SELECT kl.enqueue_job('review_now', '{\"publication_key\":\"inegi.enoe\"}')")), "BV403");
    });
    it("un rol de BD que no es de servicio no puede certificar como servicio", async () => {
      await expectDenied(tx(k.app, () => k.app.query("SELECT kl.attest_service($1)", [randomUUID()])));
    });
    it("un humano no puede ejercer permisos de agente", async () => {
      expect(await requireAs(k.owner, admin.id, "ADMIN", "job.claim")).toBe("denied");
      expect(await requireAs(k.owner, admin.id, "ADMIN", "agent.collect")).toBe("denied");
    });
  });

  describe("X12 · concesión revocada", () => {
    it("deja de autorizar y la revocación es única", async () => {
      const ed = person("editor");
      const grantId = await asPerson(k.app, admin, async () => (await k.app.query("SELECT kl.grant_role($1, $2, 'KL_EDITOR', false, '{}') AS g", [ed.id, ed.email])).rows[0].g);
      await asPerson(k.app, ed, () => k.app.query("SELECT 1"));
      expect(await requireAs(k.owner, ed.id, "ADMIN", "job.enqueue")).toBe("allowed");
      await asPerson(k.app, admin, () => k.app.query("SELECT kl.revoke_role($1, 'baja')", [grantId]));
      expect(await requireAs(k.owner, ed.id, "ADMIN", "job.enqueue")).toBe("denied");
      await expectSqlState(asPerson(k.app, ed, () => k.app.query("SELECT kl.enqueue_job('review_now', '{\"publication_key\":\"inegi.enoe\"}')")), "BV403");
      await expectSqlState(asPerson(k.app, admin, () => k.app.query("SELECT kl.revoke_role($1)", [grantId])), "BV404");
    });
  });

  describe("X13/X15 · arranque de KL_ADMIN", () => {
    it("se niega si ya existe un KL_ADMIN no revocado", async () => {
      const p = person("segundo");
      await expectSqlState(tx(k.owner, () => k.owner.query("SELECT kl.bootstrap_admin($1, $2, $3)", [p.id, p.email, randomUUID()])), "BV403");
    });
    it("solo la ejecuta kl_owner y rechaza identidades técnicas", async () => {
      await expectDenied(tx(k.app, () => k.app.query("SELECT kl.bootstrap_admin($1, 'a@synthetic.test', $2)", [randomUUID(), randomUUID()])));
    });
    it("el arranque exitoso deja principal, concesión KL_ADMIN firmada por kl-bootstrap y auditoría con su request_id", async () => {
      const g = await k.owner.query("SELECT granted_by, role FROM kl.role_grant WHERE admin_user_id = $1 AND role = 'KL_ADMIN'", [admin.id]);
      expect(g.rows[0]).toEqual({ granted_by: "00000000-0000-4000-8000-0000000000a3", role: "KL_ADMIN" });
      const ev = (await audit("kl.bootstrap_admin"))[0];
      expect(ev.actor_principal_id).toBe("00000000-0000-4000-8000-0000000000a3");
      expect(ev.request_id).toMatch(/^[0-9a-f-]{36}$/);
    });
    it("rechaza una identidad técnica antes de escribir (en un entorno limpio)", async () => {
      await k.closeAll();
      await freshKlDatabase();
      const c = await (await import("../testing/env")).connectAs("kl_owner");
      try {
        await expectSqlState(tx(c, () => c.query("SELECT kl.bootstrap_admin($1, 'kl-agent@beeside.internal', $2)", [randomUUID(), randomUUID()])), "BV403");
        expect((await c.query("SELECT count(*)::int AS n FROM kl.role_grant WHERE role = 'KL_ADMIN'")).rows[0].n).toBe(0);
      } finally {
        await c.end();
      }
      k = await openConns();
      admin = await bootstrapAdmin(k.owner);
    });
  });

  describe("X16 · nadie se concede ni se revoca un rol a sí mismo", () => {
    it("auto-concesión rechazada", async () => {
      await expectSqlState(asPerson(k.app, admin, () => k.app.query("SELECT kl.grant_role($1, $2, 'KL_EDITOR', false, '{}')", [admin.id, admin.email])), "BV403");
    });
    it("auto-revocación rechazada, incluso para el único KL_ADMIN", async () => {
      const g = (await k.owner.query("SELECT grant_id FROM kl.role_grant WHERE admin_user_id = $1", [admin.id])).rows[0].grant_id;
      await expectSqlState(asPerson(k.app, admin, () => k.app.query("SELECT kl.revoke_role($1)", [g])), "BV403");
    });
    it("un segundo KL_ADMIN tampoco puede revocarse a sí mismo", async () => {
      const second = await grantTo(k.app, admin, "admin2", "KL_ADMIN");
      await asPerson(k.app, second, () => k.app.query("SELECT 1"));
      const g = (await k.owner.query("SELECT grant_id FROM kl.role_grant WHERE admin_user_id = $1", [second.id])).rows[0].grant_id;
      await expectSqlState(asPerson(k.app, second, () => k.app.query("SELECT kl.revoke_role($1)", [g])), "BV403");
    });
    it("las columnas de la concesión lo imponen también en la base (granted_by ≠ admin_user_id)", async () => {
      await expectSqlState(
        tx(k.owner, async () => {
          await k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
          await k.owner.query("INSERT INTO kl.role_grant (admin_user_id, role, granted_by) VALUES ($1, 'KL_EDITOR', $1)", [admin.id]);
        }),
        "23514",
      );
    });
    it("los roles de servicio no se conceden desde la aplicación", async () => {
      await expectSqlState(asPerson(k.app, admin, () => k.app.query("SELECT kl.grant_role($1, $2, 'SERVICE_AGENT', false, '{}')", [randomUUID(), "x@synthetic.test"])), "BV403");
    });
  });

  describe("X18 · payload de kl.job de lista blanca", () => {
    const enqueue = (payload: unknown) => asService(k.knowledge, () => k.knowledge.query("SELECT kl.enqueue_job('noop', $1::jsonb)", [JSON.stringify(payload)]));
    it("acepta solo claves de la lista y valores cortos sin texto libre", async () => {
      await expect(enqueue({ ref: "synthetic.001" })).resolves.toBeDefined();
    });
    it.each([
      ["clave fuera de la lista", { ref: "a", empresa: "ACME" }],
      ["texto libre del cliente", { ref: "Empresa Sintética S.A. de C.V. quiere exportar" }],
      ["valor demasiado largo", { ref: "a".repeat(121) }],
      ["objeto anidado", { ref: { x: 1 } }],
      ["arreglo", { ref: ["a"] }],
      ["nulo", { ref: null }],
    ])("rechaza: %s", async (_c, payload) => {
      await expectSqlState(enqueue(payload), "BV422");
    });
    it("rechaza un tipo desconocido y un payload que no es objeto", async () => {
      await expectSqlState(asService(k.knowledge, () => k.knowledge.query("SELECT kl.enqueue_job('exfiltrar', '{}')")), "BV422");
      await expectSqlState(asService(k.knowledge, () => k.knowledge.query("SELECT kl.enqueue_job('noop', '[]'::jsonb)")), "BV422");
    });
  });

  describe("X17 · cola con SKIP LOCKED y recuperación de arrendamientos", () => {
    let second: Client;
    beforeAll(async () => {
      second = await (await import("../testing/env")).connectAs("kl_knowledge");
    });
    afterAll(() => second.end());

    it("dos workers en paralelo no toman el mismo job; los arrendamientos vencidos se recuperan", async () => {
      await asService(k.knowledge, async () => {
        for (let i = 0; i < 6; i++) await k.knowledge.query("SELECT kl.enqueue_job('noop', $1::jsonb)", [JSON.stringify({ ref: `par.${i}` })]);
      });
      // el worker A toma 3 y mantiene su transacción abierta; el worker B toma 3 distintos sin esperar
      await k.knowledge.query("BEGIN");
      await k.knowledge.query("SELECT kl.attest_service($1)", [randomUUID()]);
      const a = (await k.knowledge.query("SELECT job_id FROM kl.claim_jobs(ARRAY['noop'], 3, 60)")).rows.map((r) => r.job_id);
      const b = await asService(second, async () => (await second.query("SELECT job_id FROM kl.claim_jobs(ARRAY['noop'], 3, 60)")).rows.map((r) => r.job_id));
      await k.knowledge.query("COMMIT");
      expect(a.length).toBe(3);
      expect(b.length).toBe(3);
      expect(new Set([...a, ...b]).size).toBe(6);

      // vence el arrendamiento de uno y se recupera, con un intento más
      const victim = a[0];
      await tx(k.owner, async () => {
        await k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
        await k.owner.query("UPDATE kl.job SET lease_until = now() - interval '1 minute' WHERE job_id = $1", [victim]);
      });
      const again = await asService(k.knowledge, async () => (await k.knowledge.query("SELECT job_id, attempts, lease_token FROM kl.claim_jobs(ARRAY['noop'], 5, 60)")).rows);
      const recovered = again.find((r) => r.job_id === victim);
      expect(recovered?.attempts).toBe(2);
      expect(again.filter((r) => r.job_id !== victim).every((r) => r.attempts === 1)).toBe(true);

      // completar libera el job; solo lo completa quien tiene el token de arrendamiento vigente
      await expectSqlState(asService(second, () => second.query("SELECT kl.complete_job($1, $2, 'succeeded')", [victim, randomUUID()])), "BV409");
      await expectSqlState(asService(second, () => second.query("SELECT kl.complete_job($1, $2, 'succeeded')", [victim, (a as unknown as string[])[0]])), "BV409");
      expect(await asService(k.knowledge, async () => (await k.knowledge.query("SELECT kl.complete_job($1, $2, 'succeeded') AS s", [victim, recovered?.lease_token])).rows[0].s)).toBe("succeeded");
    });

    it("un job que agota sus intentos queda dead; kl_agent no toma jobs ajenos a su rol", async () => {
      const id = await asService(k.knowledge, async () => (await k.knowledge.query("SELECT kl.enqueue_job('noop', '{\"ref\":\"muere\"}') AS j")).rows[0].j);
      expect(await asService(k.agent, async () => (await k.agent.query("SELECT job_id FROM kl.claim_jobs(ARRAY['noop'], 50, 60)")).rows)).toEqual([]);
      for (let i = 0; i < 3; i++) {
        await asService(k.knowledge, async () => {
          const got = (await k.knowledge.query("SELECT job_id, lease_token FROM kl.claim_jobs(ARRAY['noop'], 50, 60)")).rows;
          const mine = got.find((r) => r.job_id === id);
          if (mine) await k.knowledge.query("SELECT kl.complete_job($1, $2, 'failed', 'boom', 0)", [id, mine.lease_token]);
        });
      }
      expect((await k.owner.query("SELECT status, attempts, error_code FROM kl.job WHERE job_id = $1", [id])).rows[0]).toEqual({ status: "dead", attempts: 3, error_code: "boom" });
    });
  });

  describe("X08/X09 · matriz de permisos de Design Spec §7, por rol", () => {
    const ROLES = ["KL_ADMIN", "KL_REVIEWER", "KL_REVIEWER_EDITORIAL", "KL_EDITOR", "SPECIALIST_VALIDATOR", "SUPERVISOR"] as const;
    type R = (typeof ROLES)[number];
    // [permiso, dominio?, roles permitidos]
    const MATRIX: Array<[string, string | null, R[]]> = [
      ["kl.read", null, ["KL_ADMIN", "KL_REVIEWER", "KL_REVIEWER_EDITORIAL", "KL_EDITOR", "SUPERVISOR"]],
      ["kl.read_own_queue", "legal.mx", ["SPECIALIST_VALIDATOR"]],
      ["source.propose", null, ["KL_ADMIN", "KL_REVIEWER", "KL_REVIEWER_EDITORIAL", "KL_EDITOR"]],
      ["source.decide", null, ["KL_ADMIN"]],
      ["content.author", null, ["KL_EDITOR"]],
      ["content.approve_l2", null, ["KL_REVIEWER", "KL_REVIEWER_EDITORIAL"]],
      ["validation.validate", "legal.mx", ["SPECIALIST_VALIDATOR"]],
      ["validation.record_external", null, ["KL_REVIEWER", "KL_REVIEWER_EDITORIAL"]],
      ["demand.decide", null, ["KL_ADMIN", "KL_REVIEWER", "KL_REVIEWER_EDITORIAL"]],
      ["demand.decide_admin", null, ["KL_ADMIN"]],
      ["product.approve_change", null, ["KL_REVIEWER_EDITORIAL"]],
      ["edition.approve", null, ["KL_REVIEWER_EDITORIAL"]],
      ["edition.unpublish", null, ["KL_REVIEWER_EDITORIAL"]],
      ["edition.revoke", null, ["KL_ADMIN"]],
      ["ram.propose_equivalence", null, ["KL_EDITOR"]],
      ["settings.write", null, ["KL_ADMIN"]],
      ["ram.auto_promotion", null, ["KL_ADMIN"]],
      ["roles.grant", null, ["KL_ADMIN"]],
      ["roles.revoke", null, ["KL_ADMIN"]],
      ["job.enqueue", null, ["KL_ADMIN", "KL_EDITOR"]],
      ["job.enqueue_extraordinary", null, ["KL_ADMIN"]],
    ];
    const holders = new Map<R, Person>();

    beforeAll(async () => {
      const mk = async (label: string, role: string, opts: { editorial?: boolean; domains?: string[] } = {}) => {
        const p = await grantTo(k.app, admin, label, role, opts);
        await asPerson(k.app, p, () => k.app.query("SELECT 1"));
        return p;
      };
      holders.set("KL_ADMIN", await mk("m-admin", "KL_ADMIN"));
      holders.set("KL_REVIEWER", await mk("m-rev", "KL_REVIEWER"));
      holders.set("KL_REVIEWER_EDITORIAL", await mk("m-rev-ed", "KL_REVIEWER", { editorial: true }));
      holders.set("KL_EDITOR", await mk("m-editor", "KL_EDITOR"));
      holders.set("SPECIALIST_VALIDATOR", await mk("m-val", "SPECIALIST_VALIDATOR", { domains: ["legal.mx"] }));
      // SUPERVISOR de plataforma: sin concesión de KL, solo el platform_role certificado
      const sup = person("m-sup");
      await asPerson(k.app, sup, () => k.app.query("SELECT 1"), "SUPERVISOR");
      holders.set("SUPERVISOR", sup);
    });

    it.each(MATRIX)("%s", async (permission, domain, allowed) => {
      for (const role of ROLES) {
        const who = holders.get(role) as Person;
        const got = await requireAs(k.owner, who.id, role === "SUPERVISOR" ? "SUPERVISOR" : "ADMIN", permission, domain);
        expect({ role, got }).toEqual({ role, got: allowed.includes(role) ? "allowed" : "denied" });
      }
    });

    it("SUPERVISOR es solo lectura aunque tenga una concesión: el rol de plataforma no suma permisos de escritura", async () => {
      const sup = holders.get("SUPERVISOR") as Person;
      for (const [perm] of MATRIX.filter(([p]) => p !== "kl.read")) expect(await requireAs(k.owner, sup.id, "SUPERVISOR", perm, "legal.mx")).toBe("denied");
    });

    it("X09 · SPECIALIST_VALIDATOR fuera de su dominio o sin dominio → denegado", async () => {
      const v = holders.get("SPECIALIST_VALIDATOR") as Person;
      expect(await requireAs(k.owner, v.id, "ADMIN", "validation.validate", "legal.mx")).toBe("allowed");
      expect(await requireAs(k.owner, v.id, "ADMIN", "validation.validate", "fiscal.mx")).toBe("denied");
      expect(await requireAs(k.owner, v.id, "ADMIN", "validation.validate", null)).toBe("denied");
    });

    it("un permiso inexistente se rechaza", async () => {
      expect(await requireAs(k.owner, (holders.get("KL_ADMIN") as Person).id, "ADMIN", "todo.puede")).toBe("denied");
    });
  });

  it("sessionRef es un SHA-256 hexadecimal", () => {
    expect(sessionRef("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});
