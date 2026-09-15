import type { ClientBase, Pool, QueryResultRow } from "pg";

/** Minimal database abstraction used by services: single queries plus explicit transactions. */
export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

/** Production: pooled connections, one real transaction per `transaction()` call. */
export function createPoolDb(pool: Pool): Db {
  return {
    query: (text, values) => pool.query(text, values),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(clientDb(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

let savepointCounter = 0;

async function withSavepoint<T>(client: ClientBase, fn: () => Promise<T>): Promise<T> {
  const name = `sp_${++savepointCounter}`;
  await client.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`).catch(() => undefined);
    throw error;
  }
}

/** A transaction already open on one client: nested transactions become savepoints. */
function clientDb(client: ClientBase): Db {
  return {
    query: (text, values) => client.query(text, values),
    transaction: (fn) => withSavepoint(client, () => fn(clientDb(client))),
  };
}

/**
 * Tests: everything runs inside an outer transaction the test rolls back. Every query and every
 * transaction is isolated in a savepoint so a refused operation does not abort later requests —
 * the same isolation a real pooled connection gives each request in production.
 */
export function createSavepointDb(client: ClientBase): Db {
  const db: Db = {
    query: (text, values) => withSavepoint(client, () => client.query(text, values)),
    transaction: (fn) => withSavepoint(client, () => fn(clientDb(client))),
  };
  return db;
}
