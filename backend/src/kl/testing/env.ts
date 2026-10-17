import * as fs from "node:fs";
import * as path from "node:path";
import { Client } from "pg";
import { runMigrations } from "../db/runner";
import { rolesSql } from "./cluster";

/** Roles de KL (CR-KL-002 §8.1) y utilidades para abrir conexiones con cada uno. */
export type KlRole = "kl_owner" | "kl_app" | "kl_reader_precision" | "kl_agent" | "kl_knowledge";

/** `describe` que se omite sin clúster efímero (la CI de Discovery y Precision no lo tiene ni lo necesita). */
export const describeKl = ((name: string, fn: () => void) => (process.env.KL_TEST_PG_URL ? describe : describe.skip)(name, fn)) as typeof describe;

function superUrl(db: string): string {
  const u = new URL(process.env.KL_TEST_PG_URL as string);
  u.pathname = `/${db}`;
  return u.toString();
}

/** URL de un rol de KL hacia una base (el clúster efímero usa autenticación `trust`). */
export function roleUrl(role: KlRole | "postgres", db = "beeside_kl"): string {
  const u = new URL(process.env.KL_TEST_PG_URL as string);
  u.username = role;
  u.password = "";
  u.pathname = `/${db}`;
  return u.toString();
}

export async function connectAs(role: KlRole | "postgres", db = "beeside_kl"): Promise<Client> {
  const c = new Client({ connectionString: roleUrl(role, db) });
  await c.connect();
  return c;
}

export async function withSuper<T>(fn: (c: Client) => Promise<T>, db = "postgres"): Promise<T> {
  const c = new Client({ connectionString: superUrl(db) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Crea los roles (idempotente). Lo llama el globalSetup una vez por clúster. */
export async function bootstrapRoles(): Promise<void> {
  await withSuper((c) => c.query(rolesSql()));
}

/** Base `beeside_kl` nueva (borra la anterior) migrada con el runner de KL como `kl_owner`. */
export async function freshKlDatabase(options: { migrate?: boolean; dir?: string } = {}): Promise<void> {
  await withSuper(async (c) => {
    await c.query("DROP DATABASE IF EXISTS beeside_kl WITH (FORCE)");
    await c.query("CREATE DATABASE beeside_kl OWNER kl_owner");
  });
  if (options.migrate === false) return;
  await runMigrations({ connectionString: roleUrl("kl_owner"), ...(options.dir ? { dir: options.dir } : {}) });
}

const BEESIDE_MIGRATIONS = path.resolve(__dirname, "../../../db/migrations");

/** `beeside` efímera con las migraciones compartidas de la base `bc3f527`: solo para resolver sesiones del Control Center. */
export async function freshBeesideDatabase(): Promise<void> {
  await withSuper(async (c) => {
    await c.query("DROP DATABASE IF EXISTS beeside WITH (FORCE)");
    await c.query("CREATE DATABASE beeside");
  });
  await withSuper(async (c) => {
    const files = fs.readdirSync(BEESIDE_MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    for (const f of files) await c.query(fs.readFileSync(path.join(BEESIDE_MIGRATIONS, f), "utf8"));
  }, "beeside");
}

export { superUrl };
