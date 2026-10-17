import { Client } from "pg";
import { describeKl, freshBeesideDatabase, freshKlDatabase, withSuper, roleUrl, passwordClause } from "../testing/env";

/**
 * Ensayo LOCAL del protocolo E1–E10 (Contratos de seguridad §8.3, condición G1) en el clúster efímero, con un rol ajeno a KL
 * que imita a `app` (sin SUPERUSER, CREATEROLE ni CREATEDB). NO sustituye la ejecución en el entorno destino (G1: la hace
 * Plataforma y guarda la evidencia): en Cloud SQL `cloudsqlsuperuser` puede tener ADMIN sobre roles creados por la API,
 * algo que este clúster no reproduce.
 */
describeKl("ensayo local de G1 · E1–E10", () => {
  const url = (user: string, db: string) => roleUrl(user, db);
  let app: Client;

  beforeAll(async () => {
    await freshBeesideDatabase();
    await freshKlDatabase();
    await withSuper(async (c) => {
      await c.query("DROP ROLE IF EXISTS app_sim");
      await c.query(`CREATE ROLE app_sim LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB${passwordClause()}`);
    });
    await withSuper((c) => c.query("GRANT ALL ON ALL TABLES IN SCHEMA public TO app_sim; GRANT ALL ON SCHEMA public TO app_sim"), "beeside");
    app = new Client({ connectionString: url("app_sim", "beeside") });
    await app.connect();
  });
  afterAll(async () => {
    await app.end();
  });

  const fails = async (sql: string) => {
    try {
      await app.query(sql);
    } catch (e) {
      return (e as { code: string }).code;
    }
    return "no-error";
  };

  it("E1: conectarse a beeside_kl → permission denied for database", async () => {
    const c = new Client({ connectionString: url("app_sim", "beeside_kl") });
    await expect(c.connect()).rejects.toMatchObject({ message: expect.stringMatching(/permission denied for database/) });
  });

  it.each(["kl_owner", "kl_app", "kl_reader_precision", "kl_agent", "kl_knowledge"])("E2–E6 sobre %s: grant, set role, alter/drop role, create role in role, alter database owner → error", async (role) => {
    expect(await fails(`GRANT ${role} TO app_sim`)).not.toBe("no-error"); // E2
    expect(await fails(`SET ROLE ${role}`)).toBe("42501"); // E3
    expect(await fails(`ALTER ROLE ${role} PASSWORD 'x'`)).toBe("42501"); // E4
    expect(await fails(`ALTER ROLE ${role} LOGIN`)).toBe("42501");
    expect(await fails(`DROP ROLE ${role}`)).toBe("42501");
    expect(await fails(`CREATE ROLE x_${role} IN ROLE ${role}`)).toBe("42501"); // E5
    expect(await fails(`CREATE ROLE y_${role} ADMIN ${role}`)).toBe("42501");
  });

  it("E6: ALTER DATABASE beeside_kl OWNER TO app → error", async () => {
    expect(await fails("ALTER DATABASE beeside_kl OWNER TO app_sim")).toBe("42501");
  });

  it("E7: pg_has_role(app, kl_*, MEMBER) es false para todos (recursivo)", async () => {
    for (const role of ["kl_owner", "kl_app", "kl_reader_precision", "kl_agent", "kl_knowledge"]) {
      const r = await app.query("SELECT pg_has_role('app_sim', $1, 'MEMBER') AS m", [role]);
      expect(r.rows[0].m).toBe(false);
    }
  });

  it("E8: ningún pg_auth_members con admin_option sobre los roles kl_* para app o cualquier superusuario creado por la API", async () => {
    const r = await app.query(
      `SELECT m.member::regrole::text AS member, r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
        WHERE r.rolname LIKE 'kl\\_%' AND m.admin_option AND m.member::regrole::text IN ('app_sim', 'cloudsqlsuperuser')`,
    );
    expect(r.rows).toEqual([]);
  });

  it("E9: la base y todos los objetos de beeside_kl pertenecen solo a kl_owner", async () => {
    const owner = new Client({ connectionString: roleUrl("kl_owner") });
    await owner.connect();
    try {
      const db = await owner.query("SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname = 'beeside_kl'");
      expect(db.rows[0].owner).toBe("kl_owner");
      const objs = await owner.query(
        `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'kl'
         UNION SELECT DISTINCT pg_get_userbyid(p.proowner) FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'kl'
         UNION SELECT DISTINCT pg_get_userbyid(n.nspowner) FROM pg_namespace n WHERE n.nspname = 'kl'
         UNION SELECT DISTINCT pg_get_userbyid(t.typowner) FROM pg_type t JOIN pg_namespace s ON s.oid = t.typnamespace WHERE s.nspname = 'kl'`,
      );
      expect(objs.rows.map((r) => r.owner)).toEqual(["kl_owner"]);
    } finally {
      await owner.end();
    }
  });

  it("E10 (inverso): cada rol kl_* intenta leer cualquier tabla de beeside → error de permiso", async () => {
    const tables = (await app.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename LIMIT 12")).rows.map((r) => r.tablename as string);
    expect(tables.length).toBeGreaterThan(0);
    for (const role of ["kl_owner", "kl_app", "kl_reader_precision", "kl_agent", "kl_knowledge"] as const) {
      const c = new Client({ connectionString: roleUrl(role, "beeside") });
      await c.connect(); // CONNECT en beeside lo decide Plataforma (revocar de PUBLIC); aquí se prueba que no hay lectura
      try {
        for (const t of tables) {
          await expect(c.query(`SELECT 1 FROM public."${t}" LIMIT 1`)).rejects.toMatchObject({ code: "42501" });
        }
      } finally {
        await c.end();
      }
    }
  });
});
