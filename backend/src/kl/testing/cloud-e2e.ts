import { Client, Pool } from "pg";
import { Conns } from "./kit";
import { buildWorld } from "./world";
import { randomUUID } from "node:crypto";
import { withAttestation } from "../db/attested-tx";
import { klAdmin } from "../service/admin-service";
import { buildProductWorld, composeAndApprove, composeAndSubmit } from "./product-world";
import { attestedOf, run } from "./world";

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
    const phase = env.KL_E2E_PHASE ?? "ALL";
    if (phase === "ALL") {
      const world = await buildWorld(k);
      const pw = await buildProductWorld({ world, pools: p, productKey: "e2e_synthetic" });
      const { editionId, renderJobId } = await composeAndApprove(pw, "2026.10", "2026-10-15");
      process.stdout.write(`${JSON.stringify({ editionId, renderJobId, productKey: pw.productKey })}\n`);
    } else if (phase === "A") {
      // Edición en aprobación con vista previa solicitada; el PO real (si se indica) recibe SOLO lectura (KL_REVIEWER) en esta base de ensayo.
      const world = await buildWorld(k);
      const pw = await buildProductWorld({ world, pools: p, productKey: "e2e_synthetic" });
      const editionId = await composeAndSubmit(pw, "2026.10", "2026-10-15");
      const previewJobId = (await run(world, world.editor, ["SELECT kl.request_preview($1) AS id", [editionId]]))[0]?.id as string;
      if (env.KL_E2E_PO_ID && env.KL_E2E_PO_EMAIL) await run(world, world.admin, ["SELECT kl.grant_role($1, $2, 'KL_REVIEWER', false, ARRAY[]::text[])", [env.KL_E2E_PO_ID, env.KL_E2E_PO_EMAIL]]);
      const pick = (x: { id: string; email: string }) => ({ id: x.id, email: x.email });
      process.stdout.write(`${JSON.stringify({ editionId, previewJobId, productKey: pw.productKey, editorial: pick(world.editorial) })}\n`);
    } else if (phase === "B") {
      // Aprobación por una persona distinta (revisor editorial) de la edición ya comprobada en vista previa.
      const st = JSON.parse(env.KL_E2E_STATE ?? "{}") as { editionId: string; editorial: { id: string; email: string } };
      const renderJobId = await withAttestation(p.app, attestedOf(st.editorial), randomUUID(), (tx) => klAdmin.approveEdition(tx, st.editionId));
      process.stdout.write(`${JSON.stringify({ editionId: st.editionId, renderJobId })}\n`);
    } else if (phase === "C") {
      // Retirada de una edición publicada (estado público «revoked»); la hace el revisor editorial, persona distinta de quien compuso.
      const st = JSON.parse(env.KL_E2E_STATE ?? "{}") as { editionId: string; editorial: { id: string; email: string } };
      // La retirada exige la concesión «edition.revoke» (KL_ADMIN): se usa al administrador de prueba de esta base, no al PO real.
      const adm = (await owner.query<{ id: string; email: string }>("SELECT pr.principal_id AS id, pr.auth_identity AS email FROM kl.role_grant rg JOIN kl.principal pr ON pr.principal_id = rg.admin_user_id WHERE rg.role = 'KL_ADMIN' AND rg.revoked_at IS NULL AND pr.auth_identity LIKE '%@synthetic.test' LIMIT 1")).rows[0];
      if (!adm) throw new Error("no hay administrador de prueba en la base de ensayo");
      await withAttestation(p.app, attestedOf(adm), randomUUID(), (tx) => klAdmin.revokeEdition(tx, st.editionId, "ensayo M1: verificación del estado público revocado"));
      process.stdout.write(`${JSON.stringify({ editionId: st.editionId, revoked: true })}\n`);
    } else throw new Error(`KL_E2E_PHASE desconocida: ${phase}`);
  } finally {
    await p.closeAll();
    await k.closeAll();
  }
}

/* istanbul ignore next */
if (require.main === module) main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
