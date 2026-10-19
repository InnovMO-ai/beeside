import { Client, Pool } from "pg";
import { Conns } from "./kit";
import { buildWorld } from "./world";
import { buildProductWorld, composeAndApprove } from "./product-world";

/**
 * Cargador de la base de ensayo `beeside_kl_e2e` (M1 opción b). Solo datos sintéticos y principales de prueba: crea al admin
 * inicial por `kl.bootstrap_admin`, concede roles y compone/aprueba una edición con personas distintas. Deja el job de render en la cola
 * `kl.job`; lo procesa el worker de Cloud Run (Chromium + GcsObjectStore). No toca `beeside_kl`.
 * Entrada: KL_E2E_URL_{OWNER,APP,READER,AGENT,KNOWLEDGE} (ya apuntadas a beeside_kl_e2e). Salida: una línea JSON con los ids.
 */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const u = (k: string): string => {
    const v = env[`KL_E2E_URL_${k}`];
    if (!v) throw new Error(`falta KL_E2E_URL_${k}`);
    if (!/\/beeside_kl_e2e(\?|$)/.test(v)) throw new Error(`KL_E2E_URL_${k} no apunta a beeside_kl_e2e`);
    return v;
  };
  const open = async (k: string): Promise<Client> => { const c = new Client({ connectionString: u(k) }); await c.connect(); return c; };
  const [owner, app, reader, agent, knowledge] = await Promise.all(["OWNER", "APP", "READER", "AGENT", "KNOWLEDGE"].map(open)) as [Client, Client, Client, Client, Client];
  const k: Conns = { owner, app, reader, agent, knowledge, closeAll: async () => void (await Promise.all([owner, app, reader, agent, knowledge].map((c) => c.end().catch(() => undefined)))) };
  const mkPool = (k2: string) => new Pool({ connectionString: u(k2), max: 3 });
  const p = { app: mkPool("APP"), reader: mkPool("READER"), knowledge: mkPool("KNOWLEDGE"), agent: mkPool("AGENT"), closeAll: async () => void 0 };
  p.closeAll = async () => void (await Promise.all([p.app, p.reader, p.knowledge, p.agent].map((x) => x.end().catch(() => undefined))));
  try {
    const world = await buildWorld(k);
    const pw = await buildProductWorld({ world, pools: p, productKey: "e2e_synthetic" });
    const { editionId, renderJobId } = await composeAndApprove(pw, "2026.10", "2026-10-15");
    process.stdout.write(`${JSON.stringify({ editionId, renderJobId, productKey: pw.productKey })}\n`);
  } finally {
    await p.closeAll();
    await k.closeAll();
  }
}

/* istanbul ignore next */
if (require.main === module) main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
