import { createHash, randomUUID } from "node:crypto";
import { Pool, PoolClient, QueryResultRow } from "pg";
import { KlError, translateDbError } from "./errors";

/**
 * Transacciones certificadas (CR-KL-002 §4.1): la certificación solo se emite dentro de la misma transacción y la
 * misma petición, después de que el backend resolvió la sesión del Control Center en la base principal (sin caché).
 */
export interface KlTx {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  readonly requestId: string;
}

export interface AttestedPrincipal {
  adminUserId: string;
  email: string;
  /** Rol de plataforma de la sesión certificada. */
  role: "ADMIN" | "SUPERVISOR";
  sessionId: string;
}

export const sessionRef = (sessionId: string): string => createHash("sha256").update(sessionId).digest("hex");

function wrap(client: PoolClient, requestId: string): KlTx {
  return {
    requestId,
    async query(text, values) {
      try {
        return await client.query(text, values);
      } catch (error) {
        throw translateDbError(error);
      }
    },
  };
}

async function connect(pool: Pool): Promise<PoolClient> {
  try {
    return await pool.connect();
  } catch (error) {
    throw translateDbError(error);
  }
}

/**
 * Abre una transacción en beeside_kl, emite kl.attest y ejecuta `fn`. Si la identidad no coincide con el principal
 * registrado, se confirma el evento kl.identity_mismatch y se rechaza. Cualquier otra falla revierte todo.
 */
export async function withAttestation<T>(pool: Pool, principal: AttestedPrincipal, requestId: string, fn: (tx: KlTx) => Promise<T>): Promise<T> {
  const client = await connect(pool);
  let mismatch = false;
  try {
    await client.query("BEGIN");
    const r = await client.query<{ attest: string }>("SELECT kl.attest($1, $2, $3, $4, $5) AS attest", [principal.adminUserId, principal.email, principal.role, sessionRef(principal.sessionId), requestId]);
    if (r.rows[0]?.attest !== "ok") {
      mismatch = true;
      await client.query("COMMIT"); // conserva el evento kl.identity_mismatch
      throw new KlError("IDENTITY_MISMATCH", "identity does not match the registered principal");
    }
    const out = await fn(wrap(client, requestId));
    await client.query("COMMIT");
    return out;
  } catch (error) {
    if (!mismatch) await client.query("ROLLBACK").catch(() => undefined);
    throw error instanceof KlError ? error : translateDbError(error);
  } finally {
    client.release();
  }
}

/** Transacción certificada de una cuenta de servicio (kl_agent o kl_knowledge); la identidad sale del rol de BD. */
export async function withServiceAttestation<T>(pool: Pool, fn: (tx: KlTx) => Promise<T>, requestId: string = randomUUID()): Promise<T> {
  const client = await connect(pool);
  try {
    await client.query("BEGIN");
    await client.query("SELECT kl.attest_service($1)", [requestId]);
    const out = await fn(wrap(client, requestId));
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error instanceof KlError ? error : translateDbError(error);
  } finally {
    client.release();
  }
}
