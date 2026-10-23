import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { connectAs, KlRole } from "./env";

/** Utilidades de prueba: transacciones certificadas, personas sintéticas y aserciones de SQLSTATE. */
export interface Person {
  id: string;
  email: string;
}

export function person(label: string): Person {
  return { id: randomUUID(), email: `${label}.${randomUUID().slice(0, 8)}@synthetic.test` };
}

export const sessionRef = (seed: string = randomUUID()) => createHash("sha256").update(seed).digest("hex");

export async function tx<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    const out = await fn();
    await c.query("COMMIT");
    return out;
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** Certifica a una persona en la transacción actual (kl_app). Devuelve 'ok' o 'identity_mismatch'. */
export async function attest(c: Client, p: Person, platformRole: "ADMIN" | "SUPERVISOR" = "ADMIN", requestId: string = randomUUID()): Promise<string> {
  const r = await c.query<{ attest: string }>("SELECT kl.attest($1, $2, $3, $4, $5) AS attest", [p.id, p.email, platformRole, sessionRef(p.id), requestId]);
  return (r.rows[0] as { attest: string }).attest;
}

/** Ejecuta `fn` dentro de una transacción certificada de esa persona. */
export async function asPerson<T>(c: Client, p: Person, fn: () => Promise<T>, platformRole: "ADMIN" | "SUPERVISOR" = "ADMIN"): Promise<T> {
  return tx(c, async () => {
    const status = await attest(c, p, platformRole);
    if (status !== "ok") throw new Error(`attest: ${status}`);
    return fn();
  });
}

export async function asService<T>(c: Client, fn: () => Promise<T>): Promise<T> {
  return tx(c, async () => {
    await c.query("SELECT kl.attest_service($1)", [randomUUID()]);
    return fn();
  });
}

export async function expectSqlState(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (!caught) throw new Error(`se esperaba SQLSTATE ${code} y no hubo error`);
  // La capa TypeScript traduce BVnnn a KlError (FORBIDDEN, CONFLICT…): se acepta cualquiera de las dos formas del mismo error.
  const KL: Record<string, string> = { BV403: "FORBIDDEN", BV404: "NOT_FOUND", BV409: "CONFLICT", BV422: "INVALID", BV601: "IMMUTABLE" };
  const got = (caught as { code?: string }).code;
  expect(got === code || (KL[code] !== undefined && got === KL[code])).toBe(true);
}

export async function expectDenied(promise: Promise<unknown>): Promise<void> {
  return expectSqlState(promise, "42501");
}

/** Arranca un KL_ADMIN (B4) con kl_owner y devuelve a la persona. */
export async function bootstrapAdmin(owner: Client, label = "admin"): Promise<Person> {
  const p = person(label);
  await owner.query("SELECT kl.bootstrap_admin($1, $2, $3)", [p.id, p.email, randomUUID()]);
  return p;
}

/** Concede un rol humano a una persona nueva, actuando como `admin`. Devuelve a la persona. */
export async function grantTo(app: Client, admin: Person, label: string, role: string, opts: { editorial?: boolean; domains?: string[] } = {}): Promise<Person> {
  const target = person(label);
  await asPerson(app, admin, () => app.query("SELECT kl.grant_role($1, $2, $3, $4, $5)", [target.id, target.email, role, opts.editorial ?? false, opts.domains ?? []]));
  return target;
}

export interface Conns {
  owner: Client;
  app: Client;
  reader: Client;
  agent: Client;
  knowledge: Client;
  closeAll(): Promise<void>;
}

export async function openConns(): Promise<Conns> {
  const roles: Record<string, KlRole> = { owner: "kl_owner", app: "kl_app", reader: "kl_reader_precision", agent: "kl_agent", knowledge: "kl_knowledge" };
  const entries = await Promise.all(Object.entries(roles).map(async ([k, role]) => [k, await connectAs(role)] as const));
  const conns = Object.fromEntries(entries) as unknown as Conns;
  conns.closeAll = async () => {
    await Promise.all(entries.map(([, c]) => c.end().catch(() => undefined)));
  };
  return conns;
}

/**
 * Prueba de `kl.require` sin pasar por kl.attest: inserta la certificación directamente como kl_owner (solo en
 * pruebas) dentro de una transacción que siempre se revierte, y devuelve el resultado de kl.require.
 */
export async function requireAs(
  owner: Client,
  principalId: string,
  platformRole: "ADMIN" | "SUPERVISOR" | "SERVICE",
  permission: string,
  domain: string | null = null,
): Promise<"allowed" | "denied"> {
  await owner.query("BEGIN");
  try {
    await owner.query("SELECT set_config('kl.mutation_authorized', 'on', true)");
    await owner.query(
      "INSERT INTO kl.request_attestation (txid, principal_id, session_ref, platform_role, request_id, attested_at) VALUES (txid_current(), $1, $2, $3, $4, now())",
      [principalId, platformRole === "SERVICE" ? null : sessionRef(principalId), platformRole, randomUUID()],
    );
    await owner.query("SELECT set_config('kl.mutation_authorized', 'off', true)");
    await owner.query("SELECT kl.require($1, $2)", [permission, domain]);
    return "allowed";
  } catch (error) {
    if ((error as { code?: string }).code === "BV403") return "denied";
    throw error;
  } finally {
    await owner.query("ROLLBACK");
  }
}
