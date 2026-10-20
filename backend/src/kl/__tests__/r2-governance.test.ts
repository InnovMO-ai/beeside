import { randomUUID } from "node:crypto";
import { describeKl } from "../testing/env";
import { asPerson, expectSqlState, grantTo, person, requireAs } from "../testing/kit";
import { buildWorld, createCardVersion, one, publishCard, run, seedSource, World } from "../testing/world";

describeKl("R2 · gobierno: concesiones, validadores, separación de funciones y dominio", () => {
  let w: World;
  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => w.close());
  const grantIdOf = async (userId: string, role: string) => (await w.k.owner.query("SELECT grant_id FROM kl.role_grant WHERE admin_user_id = $1 AND role = $2 AND revoked_at IS NULL", [userId, role])).rows[0]?.grant_id as string;
  const audit = async (action: string) => (await w.k.owner.query("SELECT actor_principal_id, entity_id, from_status, to_status, reason, request_id FROM kl.audit_event WHERE action = $1 ORDER BY event_id", [action])).rows;

  describe("concesiones y revocaciones", () => {
    it("toda concesión y revocación queda auditada con quién, a quién y por qué; el revocado pierde el permiso al instante", async () => {
      const p = await grantTo(w.k.app, w.admin, "gov-editor", "KL_EDITOR");
      await asPerson(w.k.app, p, () => w.k.app.query("SELECT 1"));
      const g = await grantIdOf(p.id, "KL_EDITOR");
      expect((await audit("kl.role_grant.grant")).some((e) => e.entity_id === g && e.actor_principal_id === w.admin.id && e.to_status === "KL_EDITOR")).toBe(true);
      expect(await requireAs(w.k.owner, p.id, "ADMIN", "content.author")).toBe("allowed");
      await run(w, w.admin, ["SELECT kl.revoke_role($1, 'cambio de funciones')", [g]]);
      expect((await audit("kl.role_grant.revoke")).some((e) => e.entity_id === g && e.reason === "cambio de funciones" && e.from_status === "KL_EDITOR")).toBe(true);
      expect(await requireAs(w.k.owner, p.id, "ADMIN", "content.author")).toBe("denied");
      // la historia no se borra: la concesión sigue ahí, revocada
      expect((await w.k.owner.query("SELECT revoked_by FROM kl.role_grant WHERE grant_id = $1", [g])).rows[0].revoked_by).toBe(w.admin.id);
    });

    it("rotación de KL_ADMIN sin quedarse sin gobierno: nadie se revoca a sí mismo, solo otro KL_ADMIN activo revoca", async () => {
      const second = await grantTo(w.k.app, w.admin, "gov-admin2", "KL_ADMIN");
      await asPerson(w.k.app, second, () => w.k.app.query("SELECT 1"));
      const first = await grantIdOf(w.admin.id, "KL_ADMIN");
      const secondGrant = await grantIdOf(second.id, "KL_ADMIN");
      await expectSqlState(run(w, w.admin, ["SELECT kl.revoke_role($1)", [first]]), "BV403"); // a sí mismo
      await run(w, second, ["SELECT kl.revoke_role($1, 'rotación')", [first]]); // el segundo revoca al primero
      await expectSqlState(run(w, second, ["SELECT kl.revoke_role($1)", [secondGrant]]), "BV403"); // el único que queda no se revoca a sí mismo
      await expectSqlState(run(w, w.admin, ["SELECT kl.revoke_role($1)", [secondGrant]]), "BV403"); // y el ex-administrador ya no puede
      // el primero vuelve solo si el segundo lo concede de nuevo (con una concesión nueva; la historia conserva la anterior)
      await run(w, second, ["SELECT kl.grant_role($1, $2, 'KL_ADMIN', false, '{}')", [w.admin.id, w.admin.email]]);
      expect((await w.k.owner.query("SELECT count(*)::int AS n FROM kl.role_grant WHERE admin_user_id = $1 AND role = 'KL_ADMIN'", [w.admin.id])).rows[0].n).toBe(2);
    });
  });

  describe("validadores y validación especializada", () => {
    it("registra un validador interno y uno externo; solo revisores registran y solo KL_ADMIN los desactiva", async () => {
      const internal = (await one(w, w.reviewer, "SELECT kl.register_validator('internal', $1, 'Interno Sintético', NULL, ARRAY['legal.mx'], NULL) AS v", [w.specialist.id])).v as string;
      const external = (await one(w, w.reviewer, "SELECT kl.register_validator('external', NULL, 'Externo Sintético', 'Despacho Sintético', ARRAY['fiscal.mx'], 'ENG-7') AS v")).v as string;
      await expectSqlState(run(w, w.editor, ["SELECT kl.register_validator('external', NULL, 'X', NULL, ARRAY['a'], NULL)"]), "BV403");
      await expectSqlState(run(w, w.reviewer, ["SELECT kl.set_validator_status($1, 'inactive')", [external]]), "BV403");
      await run(w, w.admin, ["SELECT kl.set_validator_status($1, 'inactive', 'contrato terminado')", [external]]);
      await expectSqlState(run(w, w.admin, ["SELECT kl.set_validator_status($1, 'inactive')", [external]]), "BV409");
      expect((await audit("kl.validator.status")).some((e) => e.entity_id === external && e.from_status === "active" && e.to_status === "inactive")).toBe(true);
      expect(internal).toBeTruthy();
      await expectSqlState(run(w, w.reviewer, ["SELECT kl.register_validator('internal', NULL, 'Sin usuario', NULL, ARRAY['a'], NULL)"]), "23514");
      await expectSqlState(run(w, w.reviewer, ["SELECT kl.register_validator('external', NULL, 'Sin dominios', NULL, ARRAY[]::text[], NULL)"]), "23514");
    });

    it("un validador inactivo no puede respaldar una validación; el especialista solo valida en su dominio", async () => {
      const src = await seedSource(w);
      const key = `card.mx.gov.${randomUUID().slice(0, 6)}`;
      const { versionId } = await createCardVersion(w, { key, risk: "high", cardType: "normative", topic: "gov.tema", publication: src.publication });
      await run(w, w.editor, ["SELECT kl.submit_version($1)", [versionId]]);
      await run(w, w.reviewer, ["SELECT kl.approve_version($1)", [versionId]]);
      const extInactive = (await one(w, w.reviewer, "SELECT kl.register_validator('external', NULL, 'Inactivo', NULL, ARRAY['legal.mx'], 'ENG-9') AS v")).v as string;
      await run(w, w.admin, ["SELECT kl.set_validator_status($1, 'inactive')", [extInactive]]);
      await expectSqlState(run(w, w.reviewer2, ["SELECT kl.record_validation($1, $2, 'es', 'legal.mx', 'alcance', 'approved', NULL, now(), now() + interval '3 months')", [versionId, extInactive]]), "BV403");
      const internal = (await one(w, w.reviewer, "SELECT kl.register_validator('internal', $1, 'Interno 2', NULL, ARRAY['legal.mx'], NULL) AS v", [w.specialist.id])).v as string;
      // el especialista usa un dominio que no es el suyo en su concesión → denegado por kl.require
      await expectSqlState(run(w, w.specialist, ["SELECT kl.record_validation($1, $2, 'es', 'fiscal.mx', 'alcance', 'approved', NULL, now(), now() + interval '3 months')", [versionId, internal]]), "BV403");
      expect((await one(w, w.specialist, "SELECT kl.record_validation($1, $2, 'es', 'legal.mx', 'alcance', 'approved', NULL, now(), now() + interval '3 months') AS s", [versionId, internal])).s).toBe("published");
    });

    it("un validador externo lo registra un revisor: nunca se vuelve principal", async () => {
      const before = (await w.k.owner.query("SELECT count(*)::int AS n FROM kl.principal")).rows[0].n;
      await run(w, w.reviewer, ["SELECT kl.register_validator('external', NULL, 'Otro Externo', 'Firma', ARRAY['legal.mx'], 'ENG-10')"]);
      expect((await w.k.owner.query("SELECT count(*)::int AS n FROM kl.principal")).rows[0].n).toBe(before);
    });
  });

  describe("cola de validación: un SPECIALIST_VALIDATOR solo ve su dominio", () => {
    it("lectura completa para quien tiene kl.read; solo su dominio para el validador; nada para quien no tiene permisos", async () => {
      const src = await seedSource(w);
      const mk = async (key: string, domain: string) => {
        const { versionId } = await createCardVersion(w, { key, risk: "high", cardType: "normative", topic: key, publication: src.publication, specialistCategory: domain });
        await run(w, w.editor, ["SELECT kl.submit_version($1)", [versionId]]);
        await run(w, w.reviewer, ["SELECT kl.approve_version($1)", [versionId]]);
        return { versionId, domain };
      };
      const legal = await mk(`card.mx.q.legal.${randomUUID().slice(0, 4)}`, "legal.mx");
      const fiscal = await mk(`card.mx.q.fiscal.${randomUUID().slice(0, 4)}`, "fiscal.mx");
      expect([legal.domain, fiscal.domain]).toEqual(["legal.mx", "fiscal.mx"]);

      const queue = async (who: Parameters<typeof asPerson>[1]) => asPerson(w.k.app, who, async () => (await w.k.app.query("SELECT unit_version_id, domain FROM kl.v_admin_validation_queue ORDER BY domain")).rows);
      const full = await queue(w.admin);
      expect(full.map((r) => r.domain)).toEqual(expect.arrayContaining(["legal.mx", "fiscal.mx"]));
      const mine = await queue(w.specialist); // concesión con dominio legal.mx
      expect(mine.map((r) => r.domain)).toEqual(["legal.mx"]);
      const none = await queue(person("sin-permisos"));
      expect(none).toEqual([]);
    });
  });

  describe("auditoría completa de decisiones", () => {
    it("fuentes, retiro, validadores, periodicidad, compuerta y roles dejan un evento con su actor", async () => {
      await publishCard(w, { key: "card.mx.auditada", topic: "audit.tema" });
      await run(w, w.admin, ["SELECT kl.withdraw_unit('card.mx.auditada', 'prueba de auditoría')"]);
      const rows = (await w.k.owner.query("SELECT action, actor_principal_id FROM kl.audit_event WHERE action IN ('kl.unit.withdraw', 'kl.version.approve', 'kl.version.create', 'kl.version.submit')")).rows;
      expect(rows.some((r) => r.action === "kl.unit.withdraw" && r.actor_principal_id === w.admin.id)).toBe(true);
      expect(rows.some((r) => r.action === "kl.version.approve" && r.actor_principal_id === w.reviewer.id)).toBe(true);
      // todos los eventos tienen actor, y los de peticiones humanas traen request_id y session_ref
      const orphan = await w.k.owner.query("SELECT count(*)::int AS n FROM kl.audit_event WHERE actor_principal_id IS NULL");
      expect(orphan.rows[0].n).toBe(0);
      const human = await w.k.owner.query("SELECT count(*)::int AS n FROM kl.audit_event e WHERE e.action LIKE 'kl.version.%' AND (e.request_id IS NULL OR e.session_ref IS NULL)");
      expect(human.rows[0].n).toBe(0);
    });
  });
});
