import request from "supertest";
import { createApp } from "../../index";
import { createRateLimiter, MemoryRateLimitStore } from "../../security/rate-limit";
import { createPublicEditionRouter } from "../products/delivery";
import { KlReadService } from "../read/read-service";
import { KlError } from "../db/errors";

/** Montaje de /api/public/editions vía createApp (cambio compartido R3): ausente sin KL, con el limitador compartido y sin filtrar detalles. */
const readStub = { editionPublicStatus: async (id: string) => (id === "okokokokokokokokokokokokok" ? { status: "current", editionCode: "2026.1", publishedOn: "2026-10-15" } : { status: "unknown" }) } as unknown as KlReadService;
const limiter = () => createRateLimiter({ store: new MemoryRateLimitStore(), secret: "x".repeat(32), now: () => new Date(), log: () => undefined });

describe("montaje público de ediciones en createApp", () => {
  it("sin klPublic la ruta no existe (404 JSON) y el resto del backend no cambia", async () => {
    const app = createApp({});
    await request(app).get("/api/public/editions/okokokokokokokokokokokokok/status").expect(404);
    await request(app).get("/healthz").expect((r) => expect(r.status).toBeLessThan(500));
  });

  it("con klPublic responde solo estado, sin ruta de contenido, y aplica el limitador compartido", async () => {
    const shared = limiter();
    const app = createApp({ klPublic: createPublicEditionRouter(readStub, { limiter: shared }), security: { limiter: shared } });
    const ok = await request(app).get("/api/public/editions/okokokokokokokokokokokokok/status").expect(200);
    expect(Object.keys(ok.body).sort()).toEqual(["editionCode", "publishedOn", "status"]);
    expect(ok.headers["cache-control"]).toBe("no-store");
    await request(app).get("/api/public/editions/okokokokokokokokokokokokok").expect(404);
    await request(app).get("/api/public/editions/okokokokokokokokokokokokok/download").expect(404);
    let limited = 0;
    for (let i = 0; i < 70; i++) if ((await request(app).get("/api/public/editions/zz/status")).status === 429) limited += 1;
    expect(limited).toBeGreaterThan(0);
  });

  it("falla de la base de datos => 503 genérico (nunca «unknown» 200), sin detalle interno, no-store y Retry-After", async () => {
    const down = { editionPublicStatus: async () => { throw new KlError("UNAVAILABLE", "knowledge layer database unavailable: host 10.0.0.5"); } } as unknown as KlReadService;
    const app = createApp({ klPublic: createPublicEditionRouter(down, { limiter: limiter() }), security: { limiter: limiter() } });
    const res = await request(app).get("/api/public/editions/okokokokokokokokokokokokok/status").expect(503);
    expect(res.body).toEqual({ error: "UNAVAILABLE" });
    expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.5|unknown/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["retry-after"]).toBe("30");
    expect(res.headers["x-robots-tag"]).toBe("noindex");
  });

  it("un id desconocido sigue siendo 200 «unknown» (el contrato de éxito no cambia)", async () => {
    const app = createApp({ klPublic: createPublicEditionRouter(readStub, { limiter: limiter() }), security: { limiter: limiter() } });
    const res = await request(app).get("/api/public/editions/zzzzzzzzzzzzzzzzzzzzzzzzzz/status").expect(200);
    expect(res.body).toEqual({ status: "unknown" });
  });

  it("KlReadService.editionPublicStatus: error del pool => UNAVAILABLE; fila vacía => unknown; fila con estado => ese estado", async () => {
    const pool = (impl: () => Promise<unknown>) => new KlReadService({ query: impl } as never);
    await expect(pool(async () => { throw new Error("ECONNREFUSED"); }).editionPublicStatus("a".repeat(26))).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await pool(async () => ({ rows: [] })).editionPublicStatus("a".repeat(26))).toEqual({ status: "unknown" });
    expect(await pool(async () => ({ rows: [{ s: { status: "revoked", editionCode: "2026.1" } }] })).editionPublicStatus("a".repeat(26))).toEqual({ status: "revoked", editionCode: "2026.1" });
  });
});
