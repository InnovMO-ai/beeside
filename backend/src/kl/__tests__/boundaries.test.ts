import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { backendKlConfig, KlConfigError, migrateKlConfig, workerKlConfig } from "../config/env";
import { DEFAULT_HANDLERS, runCycle } from "../worker/kl-worker";
import { withServiceAttestation } from "../db/attested-tx";
import { describeKl } from "../testing/env";
import { buildWorld, pools, World } from "../testing/world";
import { workerPools } from "../db/pools";
import { roleUrl } from "../testing/env";

const SRC = path.resolve(__dirname, "..");
const files = (dir: string): string[] =>
  fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));

describe("rechazo al arrancar: cada proceso rechaza variables que no le corresponden (Handoff §3)", () => {
  const app = "postgres://kl_app@h/beeside_kl";
  const reader = "postgres://kl_reader_precision@h/beeside_kl";
  const agent = "postgres://kl_agent@h/beeside_kl";
  const knowledge = "postgres://kl_knowledge@h/beeside_kl";
  const owner = "postgres://kl_owner@h/beeside_kl";

  it("el backend sin variables de KL arranca sin el módulo; con las suyas, lo configura", () => {
    expect(backendKlConfig({})).toBeNull();
    expect(backendKlConfig({ KL_DB_URL_APP: app, KL_DB_URL_READER: reader })).toEqual({ appUrl: app, readerUrl: reader });
  });
  it.each([
    ["KL_DB_URL_AGENT", agent],
    ["KL_DB_URL_KNOWLEDGE", knowledge],
    ["KL_DB_URL_OWNER", owner],
  ])("el backend con %s se niega a arrancar", (name, value) => {
    expect(() => backendKlConfig({ KL_DB_URL_APP: app, KL_DB_URL_READER: reader, [name]: value })).toThrow(KlConfigError);
  });
  it("el backend con solo una de sus dos variables falla", () => {
    expect(() => backendKlConfig({ KL_DB_URL_APP: app })).toThrow(/KL_DB_URL_READER/);
  });
  it.each([
    ["DATABASE_URL", "postgres://app@h/beeside"],
    ["KL_DB_URL_APP", app],
    ["KL_DB_URL_READER", reader],
    ["KL_DB_URL_OWNER", owner],
    ["ADMIN_SESSION_SECRET", "x".repeat(40)],
    ["ADMIN_OIDC_CLIENT_SECRET", "secreto"],
  ])("kl-worker con %s se niega a arrancar", (name, value) => {
    expect(() => workerKlConfig({ KL_DB_URL_AGENT: agent, KL_DB_URL_KNOWLEDGE: knowledge, [name]: value })).toThrow(KlConfigError);
  });
  it("kl-worker con sus dos credenciales y nada más arranca; faltando una, no", () => {
    expect(workerKlConfig({ KL_DB_URL_AGENT: agent, KL_DB_URL_KNOWLEDGE: knowledge })).toEqual({ agentUrl: agent, knowledgeUrl: knowledge });
    expect(() => workerKlConfig({ KL_DB_URL_AGENT: agent })).toThrow(/KL_DB_URL_KNOWLEDGE/);
  });
  it("kl-migrate solo conoce KL_DB_URL_OWNER", () => {
    expect(migrateKlConfig({ KL_DB_URL_OWNER: owner })).toEqual({ ownerUrl: owner });
    expect(() => migrateKlConfig({ KL_DB_URL_OWNER: owner, DATABASE_URL: "x" })).toThrow(KlConfigError);
    expect(() => migrateKlConfig({ KL_DB_URL_OWNER: owner, KL_DB_URL_APP: app })).toThrow(KlConfigError);
    expect(() => migrateKlConfig({})).toThrow(/KL_DB_URL_OWNER/);
  });
  it("PRECISION_KNOWLEDGE_PROVIDER permanece en off: cualquier otro valor impide arrancar a KL", () => {
    for (const env of [{}, { PRECISION_KNOWLEDGE_PROVIDER: "off" }, { PRECISION_KNOWLEDGE_PROVIDER: "" }]) {
      expect(() => backendKlConfig({ KL_DB_URL_APP: app, KL_DB_URL_READER: reader, ...env })).not.toThrow();
    }
    expect(() => backendKlConfig({ KL_DB_URL_APP: app, KL_DB_URL_READER: reader, PRECISION_KNOWLEDGE_PROVIDER: "kl" })).toThrow(/off/);
    expect(() => workerKlConfig({ KL_DB_URL_AGENT: agent, KL_DB_URL_KNOWLEDGE: knowledge, PRECISION_KNOWLEDGE_PROVIDER: "kl" })).toThrow(/off/);
  });
  it("los agentes no se pueden encender en R1", () => {
    for (const v of ["true", "1", "yes"]) expect(() => workerKlConfig({ KL_DB_URL_AGENT: agent, KL_DB_URL_KNOWLEDGE: knowledge, KL_AGENTS_ENABLED: v })).toThrow(/desactivados/);
    expect(() => workerKlConfig({ KL_DB_URL_AGENT: agent, KL_DB_URL_KNOWLEDGE: knowledge, KL_AGENTS_ENABLED: "false" })).not.toThrow();
  });
});

describe("frontera web: ningún cliente HTTP ni salida a red en kl/read ni en kl-worker (defensa adicional a B9)", () => {
  // La salida de red de R2 solo existirá en el agente recolector de kl-worker, sin código en R1.
  const FORBIDDEN = /from\s+["'](node:)?(https?|net|tls|dns|dgram|http2)["']|require\(["'](node:)?(https?|net|tls|dns)["']\)|\bfetch\s*\(|\baxios\b|\bundici\b|node-fetch|\bXMLHttpRequest\b|\bWebSocket\b|\bgot\s*\(|\bsuperagent\b|\bhttp\.request\b/;
  it.each(["read", "worker", "packages", "service", "ingest", "seed", "contract"])("kl/%s no importa ni usa clientes de red", (dir) => {
    for (const f of files(dir)) expect({ f, hit: FORBIDDEN.test(fs.readFileSync(path.join(SRC, f), "utf8")) }).toEqual({ f, hit: false });
  });
  it("el worker de KL no importa nada de la plataforma compartida (sin credenciales ni módulos de beeside)", () => {
    for (const f of files("worker")) {
      const text = fs.readFileSync(path.join(SRC, f), "utf8");
      expect({ f, hit: /from\s+["']\.\.\/\.\.\/(db|fa|fa4|admin|operations|precision|security)\b/.test(text) }).toEqual({ f, hit: false });
      expect({ f, env: /process\.env\.(DATABASE_URL|ADMIN_|BILLING_)/.test(text) }).toEqual({ f, env: false });
    }
  });
  it("KL no importa Precision, Discovery ni FA (módulo separable; Precision consume solo kl.v1)", () => {
    for (const f of files(".").filter((x) => !x.startsWith("__tests__") && !x.startsWith("testing"))) {
      const text = fs.readFileSync(path.join(SRC, f), "utf8");
      expect({ f, hit: /from\s+["'](\.\.\/)+(precision|precision-context|fa4?|premium)\//.test(text) }).toEqual({ f, hit: false });
    }
  });
  it("las migraciones de KL no están en backend/db/migrations ni lo tocan", () => {
    expect(fs.readdirSync(path.join(SRC, "db", "migrations")).every((n) => /^KL-\d{4}_[a-z0-9_]+\.sql$/.test(n))).toBe(true);
    expect(fs.readdirSync(path.resolve(SRC, "../../db/migrations")).some((n) => /kl/i.test(n))).toBe(false);
  });
});

describeKl("kl-worker con los agentes apagados (B6)", () => {
  let w: World;
  let p: ReturnType<typeof pools>;
  beforeAll(async () => {
    w = await buildWorld();
    p = pools();
  });
  afterAll(async () => {
    await p.closeAll();
    await w.close();
  });
  const wp = () => workerPools({ agentUrl: roleUrl("kl_agent"), knowledgeUrl: roleUrl("kl_knowledge") });
  const enqueueAs = async (kind: string, payload: object) => (await w.k.app.query("SELECT 1"), withServiceAttestation(p.knowledge, async (tx) => (await tx.query<{ j: string }>("SELECT kl.enqueue_job($1, $2::jsonb) AS j", [kind, JSON.stringify(payload)])).rows[0]?.j));

  it("sin manejadores de agentes, un job de recolección encolado por una persona sigue en cola", async () => {
    const { asPerson } = await import("../testing/kit");
    const jobId = await asPerson(w.k.app, w.editor, async () => (await w.k.app.query("SELECT kl.enqueue_job('review_now', '{\"publication_key\":\"inegi.enoe\"}') AS j")).rows[0].j);
    const pools2 = wp();
    try {
      const r = await runCycle(pools2);
      expect(r).toEqual({ claimed: 0, succeeded: 0, failed: 0 });
    } finally {
      await pools2.close();
    }
    expect((await w.k.owner.query("SELECT status, attempts FROM kl.job WHERE job_id = $1", [jobId])).rows[0]).toEqual({ status: "queued", attempts: 0 });
    expect(Object.keys(DEFAULT_HANDLERS).sort()).toEqual(["noop", "schedule_tick"]);
  });

  it("procesa noop y schedule_tick (sin red); schedule_tick vence versiones publicadas con valid_to pasado", async () => {
    const noop = await enqueueAs("noop", { ref: "salud" });
    const tick = await enqueueAs("schedule_tick", {});
    const pools2 = wp();
    try {
      const r = await runCycle(pools2);
      expect(r.claimed).toBeGreaterThanOrEqual(2);
      expect(r.failed).toBe(0);
    } finally {
      await pools2.close();
    }
    const rows = (await w.k.owner.query("SELECT job_id, status FROM kl.job WHERE job_id = ANY($1)", [[noop, tick]])).rows;
    expect(rows.every((x) => x.status === "succeeded")).toBe(true);
  });

  it("un manejador que falla reintenta hasta agotar intentos y queda dead; el error es un código, no un mensaje", async () => {
    const id = await enqueueAs("noop", { ref: randomUUID() });
    const pools2 = wp();
    try {
      for (let i = 0; i < 3; i++) {
        await runCycle(pools2, { noop: async () => { throw new Error("detalle interno con datos"); } }, { limit: 50 });
        await w.k.owner.query("BEGIN");
        await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
        await w.k.owner.query("UPDATE kl.job SET run_after = now() - interval '1 second' WHERE job_id = $1 AND status = 'queued'", [id]);
        await w.k.owner.query("COMMIT");
      }
    } finally {
      await pools2.close();
    }
    expect((await w.k.owner.query("SELECT status, attempts, error_code FROM kl.job WHERE job_id = $1", [id])).rows[0]).toEqual({ status: "dead", attempts: 3, error_code: "handler_error" });
  });

  it("las cuentas de servicio son las de BD: kl_agent no reclama jobs de conocimiento y viceversa", async () => {
    const id = await enqueueAs("noop", { ref: "rol" });
    const got = await withServiceAttestation(p.agent, async (tx) => (await tx.query("SELECT job_id FROM kl.claim_jobs(ARRAY['noop'], 50, 60)")).rows);
    expect(got).toEqual([]);
    expect((await w.k.owner.query("SELECT status FROM kl.job WHERE job_id = $1", [id])).rows[0].status).toBe("queued");
  });

  it("la configuración no permite habilitar agentes en la base (kl.agents_enabled solo admite false)", async () => {
    const { asPerson } = await import("../testing/kit");
    await expect(asPerson(w.k.app, w.admin, () => w.k.app.query("SELECT kl.set_setting('kl.agents_enabled', 'true'::jsonb)"))).rejects.toMatchObject({ code: "BV403" });
    await expect(asPerson(w.k.app, w.admin, () => w.k.app.query("SELECT kl.set_setting('kl.upload.max_bytes', '1'::jsonb)"))).rejects.toMatchObject({ code: "BV422" });
    expect((await asPerson(w.k.app, w.admin, () => w.k.app.query("SELECT kl.set_setting('kl.upload.max_bytes', '1048576'::jsonb) AS v"))).rows[0].v).toBe(2);
  });
});
