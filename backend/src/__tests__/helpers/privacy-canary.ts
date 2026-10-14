/**
 * Canary completeness check for privacy erasure. A unique, recognisable string is planted in every client-entered value of a project;
 * after the erasure NO table of the database may still contain it — not only the tables we know hold client data. A new table that
 * stores client text without being registered therefore fails here even if nobody remembered to add it to the registry.
 */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(sql: string, params?: any[]): Promise<{ rows: any[] }>;
}

/** Tables (public schema) whose any row, rendered as text, contains one of the canaries. */
export async function tablesWithResidue(db: Queryable, canaries: string[]): Promise<string[]> {
  const patterns = canaries.map((c) => `%${c.replace(/[\\%_]/g, "\\$&")}%`);
  const { rows: tables } = await db.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1",
  );
  const hits: string[] = [];
  for (const { table_name } of tables) {
    const { rows } = await db.query(`SELECT count(*) AS n FROM "${table_name}" t WHERE t::text ILIKE ANY ($1::text[])`, [patterns]);
    if (Number(rows[0]?.n) > 0) hits.push(table_name);
  }
  return hits;
}
