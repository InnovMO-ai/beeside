import { randomUUID } from "node:crypto";
import { describeKl } from "../testing/env";
import { expectDenied, expectSqlState, requireAs, tx } from "../testing/kit";
import { buildWorld, createCardVersion, one, publishStat, run, seedSource, World } from "../testing/world";

describeKl("KL-0002/0003 · integridad del esquema §5", () => {
  let w: World;
  beforeAll(async () => {
    w = await buildWorld();
  });
  afterAll(() => w.close());

  const q = async (text: string, values: unknown[] = []) => (await w.k.owner.query(text, values)).rows;

  describe("estructura", () => {
    it("toda tabla de kl (salvo el journal) tiene guardas de DML, TRUNCATE y DELETE", async () => {
      const rows = await q(`
        SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
         WHERE s.nspname = 'kl' AND c.relkind = 'r' AND c.relname <> '__kl_migrations'
           AND (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = c.oid AND t.tgname IN ('kl_a_guard_dml', 'kl_a_no_truncate', 'kl_c_no_delete')) < 3`);
      expect(rows).toEqual([]);
    });

    it("existen las tablas de Design Spec §5 y las de CR-KL-002", async () => {
      const expected = [
        "institution", "publication", "publication_config_version", "source_exception", "indicator", "topic", "file_object", "ingest_batch", "extracted_row", "qa_report", "agent_run",
        "unit", "unit_version", "stat_value", "card_content", "card_locale_variant", "unit_link", "validator", "specialist_validation", "context_package", "package_member",
        "promotion_policy", "promotion_event", "demand_signal", "demand_group", "demand_decision", "usage_daily", "product", "product_section", "composition_item", "edition",
        "edition_rendering", "change_notice", "distribution_daily", "role_grant", "setting_version", "audit_event", "principal", "request_attestation", "permission_role", "job",
      ];
      const present = (await q("SELECT relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'kl' AND c.relkind = 'r'")).map((r) => r.relname);
      for (const t of expected) expect(present).toContain(t);
    });

    it("ninguna tabla de KL vive fuera del esquema kl y nada se crea en public", async () => {
      expect(await q("SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public' AND c.relkind IN ('r', 'v', 'f', 'S', 'm')")).toEqual([]);
      expect(await q("SELECT proname FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public'")).toEqual([]);
    });

    it("todas las columnas de actor son uuid con llave foránea a kl.principal (X01)", async () => {
      const actorColumns: Array<[string, string]> = [
        ["publication", "owner_user_id"], ["source_exception", "approved_by"], ["file_object", "uploaded_by"], ["ingest_batch", "uploaded_by"], ["unit_version", "authored_by"], ["unit_version", "approved_by"],
        ["card_locale_variant", "reviewed_by"], ["validator", "admin_user_id"], ["validator", "registered_by"], ["specialist_validation", "recorded_by"], ["demand_decision", "decided_by"],
        ["edition", "approved_by"], ["change_notice", "decided_by"], ["role_grant", "admin_user_id"], ["role_grant", "granted_by"], ["setting_version", "authored_by"],
        ["audit_event", "actor_principal_id"], ["job", "requested_by"], ["publication_config_version", "authored_by"], ["promotion_policy", "authored_by"], ["ingest_batch", "reviewed_by"], ["ingest_batch", "approved_by"],
        ["edition", "composed_by"], ["context_package", "compiled_by"], ["agent_run", "requested_by"],
      ];
      for (const [table, column] of actorColumns) {
        const r = await q(
          `SELECT format_type(a.atttypid, a.atttypmod) AS type,
                  EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f' AND k.confrelid = 'kl.principal'::regclass AND a.attnum = ANY (k.conkey)) AS fk
             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace s ON s.oid = c.relnamespace
            WHERE s.nspname = 'kl' AND c.relname = $1 AND a.attname = $2`,
          [table, column],
        );
        expect({ table, column, ...r[0] }).toEqual({ table, column, type: "uuid", fk: true });
      }
    });

    it("X01: un actor inexistente es rechazado por llave foránea en cada tabla", async () => {
      const ghost = randomUUID();
      const attempts: Array<[string, string, unknown[]]> = [
        ["role_grant", "INSERT INTO kl.role_grant (admin_user_id, role, granted_by) VALUES ($1, 'KL_EDITOR', $2)", [ghost, w.admin.id]],
        ["audit_event", "INSERT INTO kl.audit_event (actor_principal_id, action) VALUES ($1, 'kl.x')", [ghost]],
        ["setting_version", "INSERT INTO kl.setting_version (key, version, value, authored_by) VALUES ('kl.xx', 1, '1', $1)", [ghost]],
        ["job", "INSERT INTO kl.job (kind, max_attempts, requested_by) VALUES ('noop', 3, $1)", [ghost]],
        ["file_object", "INSERT INTO kl.file_object (sha256, detected_type, byte_length, storage_key, scan_result, uploaded_by, purpose) VALUES (repeat('a', 64), 'csv', 1, 'k', 'clean', $1, 'source_original')", [ghost]],
        ["validator", "INSERT INTO kl.validator (kind, display_name, domains, registered_by) VALUES ('external', 'x', ARRAY['d'], $1)", [ghost]],
      ];
      for (const [table, sql, values] of attempts) {
        await expectSqlState(
          tx(w.k.owner, async () => {
            await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
            await w.k.owner.query(sql, values);
          }),
          "23503",
        ).catch((e) => {
          throw new Error(`${table}: ${(e as Error).message}`);
        });
      }
    });

    it("kl_agent no recibe ninguna función de mutación de contenido; kl_app no recibe funciones de agente", async () => {
      const fn = async (role: string, name: string) => (await q("SELECT has_function_privilege($1, p.oid, 'EXECUTE') AS ok FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'kl' AND p.proname = $2", [role, name]))[0]?.ok;
      expect(await fn("kl_agent", "create_unit")).toBe(false);
      expect(await fn("kl_agent", "approve_version")).toBe(false);
      expect(await fn("kl_app", "claim_jobs")).toBe(false);
      expect(await fn("kl_app", "attest_service")).toBe(false);
      expect(await fn("kl_knowledge", "approve_version")).toBe(false);
      expect(await fn("kl_reader_precision", "attest")).toBe(false);
      expect(await fn("kl_reader_precision", "create_version")).toBe(false);
      expect(await fn("kl_reader_precision", "record_signal")).toBe(true);
      expect(await fn("kl_app", "bootstrap_admin")).toBe(false);
      expect(await fn("kl_owner", "bootstrap_admin")).toBe(true);
    });

    it("ningún rol de aplicación tiene privilegios sobre ninguna tabla; el lector solo ve las vistas permitidas", async () => {
      const tables = (await q("SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'kl' AND c.relkind = 'r'")).map((r) => r.relname as string);
      for (const role of ["kl_app", "kl_reader_precision", "kl_agent", "kl_knowledge"]) {
        for (const t of tables) {
          const p = await q("SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS any_priv", [role, `kl.${t}`]);
          expect({ role, t, any: p[0]?.any_priv }).toEqual({ role, t, any: false });
        }
      }
      const readerViews = (await q("SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'kl' AND c.relkind = 'v' AND has_table_privilege('kl_reader_precision', c.oid, 'SELECT')")).map((r) => r.relname);
      expect(readerViews.sort()).toEqual(["v_consumable", "v_consumable_card", "v_consumable_package", "v_consumable_stat", "v_edition_current", "v_flags", "v_package_status"]);
    });

    it("CONNECT: PUBLIC no se conecta; solo los cinco roles; el dueño de la base y de los objetos es kl_owner", async () => {
      const db = await q("SELECT datacl::text AS acl, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = 'beeside_kl'");
      expect(db[0]?.owner).toBe("kl_owner");
      expect(db[0]?.acl).not.toMatch(/^\{=/); // sin entrada para PUBLIC
      for (const role of ["kl_owner", "kl_app", "kl_reader_precision", "kl_agent", "kl_knowledge"]) {
        expect((await q("SELECT has_database_privilege($1, 'beeside_kl', 'CONNECT') AS ok", [role]))[0]?.ok).toBe(true);
      }
      const notOwned = await q("SELECT c.relname, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'kl' AND pg_get_userbyid(c.relowner) <> 'kl_owner'");
      expect(notOwned).toEqual([]);
      const fnNotOwned = await q("SELECT p.proname FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'kl' AND pg_get_userbyid(p.proowner) <> 'kl_owner'");
      expect(fnNotOwned).toEqual([]);
    });

    it("tiempos y límites por rol (§8.2)", async () => {
      const r = await q("SELECT rolname, rolconnlimit FROM pg_roles WHERE rolname LIKE 'kl\\_%' ORDER BY rolname");
      expect(r.every((x) => (x.rolconnlimit as number) > 0)).toBe(true);
      const s = await q("SELECT r.rolname, unnest(c.setconfig) AS cfg FROM pg_db_role_setting c JOIN pg_roles r ON r.oid = c.setrole WHERE r.rolname LIKE 'kl\\_%'");
      expect(s.map((x) => `${x.rolname}:${x.cfg}`)).toEqual(expect.arrayContaining(["kl_reader_precision:statement_timeout=1s", "kl_app:statement_timeout=30s"]));
    });

    it("no hay valor diario en el enumerado de periodicidad y la compuerta de afirmaciones nace apagada", async () => {
      const labels = (await q("SELECT unnest(enum_range(NULL::kl.cadence))::text AS l")).map((r) => r.l);
      expect(labels).toEqual(["weekly", "monthly", "quarterly", "semiannual", "annual", "none"]);
      expect((await q("SELECT r10_claims_enabled FROM kl.v_flags"))[0]?.r10_claims_enabled).toBe(false);
      await expectSqlState(w.k.owner.query("INSERT INTO kl.product (key, kind, country, master_locale, review_periodicity) VALUES ('x', 'guide', 'MX', 'es', 'daily')"), "22P02");
    });
  });

  describe("X03 · DML directo y lectura de tablas denegados a los roles de aplicación", () => {
    it.each(["app", "reader", "agent", "knowledge"] as const)("%s: permission denied en tablas de contenido", async (who) => {
      for (const t of ["unit", "unit_version", "stat_value", "publication", "demand_signal", "context_package", "edition", "file_object", "setting_version"]) {
        await expectDenied(w.k[who].query(`INSERT INTO kl.${t} DEFAULT VALUES`));
        await expectDenied(w.k[who].query(`UPDATE kl.${t} SET created_at = now()`));
        await expectDenied(w.k[who].query(`DELETE FROM kl.${t}`));
        await expectDenied(w.k[who].query(`SELECT 1 FROM kl.${t}`));
      }
    });
    it("el dueño tampoco escribe directo sin una mutación autorizada", async () => {
      await expectSqlState(w.k.owner.query("INSERT INTO kl.topic (key, label_es, label_en) VALUES ('t.x', 'x', 'x')"), "BV403");
    });
  });

  describe("máquinas de estado e inmutabilidad", () => {
    it("el contenido de una versión es inmutable; el estado solo cambia por transiciones permitidas", async () => {
      const src = await seedSource(w);
      const v = await publishStat(w, { key: "stat.mx.test.inmutable", indicator: src.indicator, publication: src.publication });
      const mutate = (sql: string, code: string) =>
        expectSqlState(
          tx(w.k.owner, async () => {
            await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
            await w.k.owner.query(sql, [v]);
          }),
          code,
        );
      await mutate("UPDATE kl.stat_value SET value_numeric = 99 WHERE unit_version_id = $1", "BV601");
      await mutate("UPDATE kl.unit_version SET content_sha256 = repeat('0', 64) WHERE id = $1", "BV601");
      await mutate("UPDATE kl.unit_version SET limits_es = ARRAY['otra'] WHERE id = $1", "BV601");
      await mutate("UPDATE kl.unit_version SET status = 'draft' WHERE id = $1", "BV409");
      await mutate("UPDATE kl.unit_version SET status = 'in_review' WHERE id = $1", "BV409");
      await mutate("DELETE FROM kl.unit_version WHERE id = $1", "BV601");
    });

    it("una versión solo nace en draft y solo pasa a revisión con contenido", async () => {
      await run(w, w.editor, ["SELECT kl.create_unit('card.mx.sin-contenido', 'card', 'MX', NULL, 'x', ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 'p', 'low')"]);
      await expectSqlState(
        tx(w.k.owner, async () => {
          await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
          await w.k.owner.query(
            "INSERT INTO kl.unit_version (unit_id, version, change_class, origin, permitted_use, authored_by, content_sha256, status) SELECT id, 1, 'new_period', 'team', 'cite_only', $1, repeat('a', 64), 'published' FROM kl.unit WHERE unit_key = 'card.mx.sin-contenido'",
            [w.editor.id],
          );
        }),
        "BV409",
      );
    });

    it("un estado de fuente no permitido se rechaza (revocada no vuelve a aprobada)", async () => {
      const src = await seedSource(w);
      await run(w, w.admin, ["SELECT kl.decide_publication($1, 'revoke', 'sintético')", [src.publication]]);
      await expectSqlState(run(w, w.admin, ["SELECT kl.decide_publication($1, 'approve', 'no debería')", [src.publication]]), "BV409");
    });
  });

  describe("X11 · doble intervención en la base, aun con roles acumulados", () => {
    it("autor ≠ aprobador de una versión", async () => {
      // un principal con KL_EDITOR + KL_REVIEWER
      const both = await (await import("../testing/kit")).grantTo(w.k.app, w.admin, "ambos", "KL_EDITOR");
      await run(w, w.admin, ["SELECT kl.grant_role($1, $2, 'KL_REVIEWER', false, '{}')", [both.id, both.email]]).catch(() => undefined);
      // un mismo principal no puede tener dos roles distintos por la restricción única (admin_user_id, role) solo si es el mismo rol: sí puede tener dos roles distintos
      const { versionId } = await createCardVersion(w, { key: "card.mx.doble-intervencion" }, both);
      await run(w, both, ["SELECT kl.submit_version($1)", [versionId]]);
      await expectSqlState(run(w, both, ["SELECT kl.approve_version($1)", [versionId]]), "BV403");
      // la base lo impone aunque la función se salte: trigger directo
      await expectSqlState(
        tx(w.k.owner, async () => {
          await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
          await w.k.owner.query("UPDATE kl.unit_version SET approved_by = authored_by WHERE id = $1", [versionId]);
        }),
        "BV403",
      );
    });

    it("quien sube una carga no la revisa ni la aprueba", async () => {
      const src = await seedSource(w);
      const fileId = (await one(w, w.editor, "SELECT kl.register_file_object($1, 'csv', 100, 'local/x.csv', 'not_required_dev', 'source_original') AS f", ["a".repeat(63) + "1"])).f;
      const batch = (await one(w, w.editor, "SELECT kl.create_ingest_batch('team', $1, '2026-T1', '2026-04-01', 'https://x.example', 'ODbL', $2) AS b", [src.publication, fileId])).b as string;
      await expectSqlState(
        tx(w.k.owner, async () => {
          await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
          await w.k.owner.query("UPDATE kl.ingest_batch SET reviewed_by = uploaded_by WHERE id = $1", [batch]);
        }),
        "BV403",
      );
    });

    it("la validación no la registra el autor y la firma la huella exacta", async () => {
      const src = await seedSource(w, { risk: "high" });
      const key = "stat.mx.test.validacion";
      await run(w, w.editor, ["SELECT kl.create_unit($1, 'statistic', 'MX', 'MX-GUA', $2, ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 'p', 'high')", [key, src.indicator]]);
      const vId = (await one(w, w.editor, "SELECT kl.create_version($1, 'team', NULL, 'new_period', 'cite_only', ARRAY[]::text[], ARRAY[]::text[], now(), NULL, NULL, false, NULL, $2::jsonb) AS v", [
        key, JSON.stringify({ indicator_key: src.indicator, geo_code: "MX-GUA", period_label: "2026", period_start: "2026-01-01", period_end: "2026-12-31", value_numeric: 1, display_es: "1", display_en: "1", unit_label: "%", publication_key: src.publication }),
      ])).v as string;
      expect((await one(w, w.editor, "SELECT kl.submit_version($1) AS l", [vId])).l).toBe(3);
      expect((await one(w, w.reviewer, "SELECT kl.approve_version($1) AS s", [vId])).s).toBe("awaiting_validation");
      const validator = (await one(w, w.reviewer, "SELECT kl.register_validator('internal', $1, 'Especialista Sintético', NULL, ARRAY['legal.mx'], NULL) AS v", [w.specialist.id])).v as string;
      // un revisor registra una huella equivocada: el trigger la rechaza
      await expectSqlState(
        tx(w.k.owner, async () => {
          await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
          await w.k.owner.query("INSERT INTO kl.specialist_validation (unit_version_id, content_sha256, locale, domain, scope_statement, verdict, validator_id, recorded_by, validated_at, expires_at) VALUES ($1, repeat('0', 64), 'es', 'legal.mx', 's', 'approved', $2, $3, now(), now() + interval '6 months')", [vId, validator, w.reviewer.id]);
        }),
        "BV409",
      );
      // validez de más de 12 meses → check
      await expectSqlState(run(w, w.specialist, ["SELECT kl.record_validation($1, $2, 'es', 'legal.mx', 'alcance', 'approved', NULL, now(), now() + interval '13 months')", [vId, validator]]), "23514");
      // validación correcta del especialista en su dominio → publica
      expect((await one(w, w.specialist, "SELECT kl.record_validation($1, $2, 'es', 'legal.mx', 'alcance', 'approved', NULL, now(), now() + interval '6 months') AS s", [vId, validator])).s).toBe("published");
    });

    it("el especialista fuera de su dominio no valida (BV403)", async () => {
      expect(await requireAs(w.k.owner, w.specialist.id, "ADMIN", "validation.validate", "fiscal.mx")).toBe("denied");
    });

    it("el aprobador editorial de una edición no es quien la compuso", async () => {
      await run(w, w.admin, ["SELECT 1"]);
      await w.k.owner.query("BEGIN");
      try {
        await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
        const prod = (await w.k.owner.query("INSERT INTO kl.product (key, kind, country, master_locale) VALUES ('doing_business_mx', 'guide', 'MX', 'es') RETURNING id")).rows[0].id;
        await expectSqlState(
          w.k.owner.query("INSERT INTO kl.edition (product_id, code, status, manifest, manifest_sha256, composed_by, approved_by) VALUES ($1, '2026.1', 'rendering', '{}'::jsonb, repeat('a', 64), $2, $2)", [prod, w.editorial.id]),
          "BV403",
        );
      } finally {
        await w.k.owner.query("ROLLBACK");
      }
    });
  });

  describe("fuentes comerciales (A04, base)", () => {
    it("una fuente comercial no se aprueba sin excepción vigente; con excepción sí, y vence", async () => {
      const tag = randomUUID().slice(0, 6);
      await run(w, w.editor, ["SELECT kl.propose_institution($1, 'Banco Sintético', 'MX', 'C', 'commercial')", [`banco.${tag}`]]);
      await run(w, w.editor, ["SELECT kl.propose_publication($1, $2, 'Informe bancario', 'MX', ARRAY[]::text[], 'https://banco.example/informe', 'cite_only', 'medium')", [`banco.informe.${tag}`, `banco.${tag}`]]);
      await expectSqlState(run(w, w.admin, ["SELECT kl.decide_publication($1, 'approve')", [`banco.informe.${tag}`]]), "BV409");
      await expectSqlState(run(w, w.admin, ["SELECT kl.add_source_exception($1, 'alcance', 'MX', 'cite_only', now() - interval '1 day')", [`banco.informe.${tag}`]]), "BV422");
      await run(w, w.admin, ["SELECT kl.add_source_exception($1, 'alcance', 'MX', 'cite_only', now() + interval '30 days')", [`banco.informe.${tag}`]]);
      expect((await one(w, w.admin, "SELECT kl.decide_publication($1, 'approve') AS s", [`banco.informe.${tag}`])).s).toBe("approved");
    });
  });
});
