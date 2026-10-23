import { randomUUID } from "node:crypto";
import request from "supertest";
import { correlateAudit } from "../audit/correlation";
import { withAttestation } from "../db/attested-tx";
import { LocalObjectStore } from "../ingest/object-store";
import { renderEditionJob } from "../products/render/render-edition";
import { launchChromium, BrowserLike } from "../products/render/pdf";
import { createApp } from "../../index";
import { klAdmin } from "../service/admin-service";
import { ApiHarness, SESSION, startApiHarness } from "../testing/api-harness";
import { describeKl, roleUrl } from "../testing/env";
import { COPY, JOURNEY, LETTER } from "../testing/product-world";
import { Pool } from "pg";
import { klPool } from "../db/pools";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describeKl("R3 · KL Admin API de Knowledge Products (flujo completo por HTTP)", () => {
  let h: ApiHarness;
  let knowledge: Pool;
  let browser: BrowserLike;
  let store: LocalObjectStore;
  let app: ReturnType<typeof createApp>;
  const u = (l: string) => h.users[l] as NonNullable<(typeof h.users)[string]>;
  const as = (label: string) => ({ adminUserId: u(label).id, email: u(label).email, role: "ADMIN" as const, sessionId: randomUUID() });
  const grant = async (label: string, role: string, extra: object = {}) => {
    await h.mkUser(label, "ADMIN");
    await h.send("post", "padmin", "/role-grants", { adminUserId: u(label).id, role, ...extra }).expect(201);
    await h.get(label, "/me").expect(200);
  };
  // Llamadas directas de preparación (sin pasar por la API): dejan evento en KL y NO en la base principal; X30 debe reportar exactamente esas.
  const direct: string[] = [];
  const call = <T>(label: string, fn: Parameters<typeof withAttestation<T>>[3]) => {
    const requestId = randomUUID();
    direct.push(requestId);
    return withAttestation(h.klApp, as(label), requestId, fn);
  };
  let editionId = "";

  beforeAll(async () => {
    h = await startApiHarness();
    knowledge = klPool(roleUrl("kl_knowledge"), 2);
    browser = await launchChromium();
    store = new LocalObjectStore(fs.mkdtempSync(path.join(os.tmpdir(), "kl-api-")), { NODE_ENV: "test" });
    app = createApp({ kl: { platform: h.platform, session: SESSION, klApp: h.klApp, store, now: () => new Date() } });
    await grant("peditor", "KL_EDITOR");
    await grant("previewer", "KL_REVIEWER");
    await grant("peditorial", "KL_REVIEWER", { editorial: true });
    await h.mkUser("psup", "SUPERVISOR");
    await h.mkUser("pnone", "ADMIN");
  });
  afterAll(async () => {
    await browser.close();
    await knowledge.end();
    await h.close();
  });
  const send = (method: "post" | "put" | "delete" | "patch", label: string, p: string, body?: object) => request(app)[method](`/api/admin/kl${p}`).set("Cookie", `beeside_admin_session=${u(label).token}`).set({ "x-beeside-admin": "1", origin: SESSION.appOrigin }).send(body ?? {});
  const get = (label: string, p: string) => request(app).get(`/api/admin/kl${p}`).set("Cookie", `beeside_admin_session=${u(label).token}`);

  it("configuración y composición: catálogo, términos privados, bloques fijos, producto, secciones y piezas, cada uno con su rol", async () => {
    await call("padmin", (tx) => tx.query("SELECT kl.set_setting('kl.links.edition_verify', $1::jsonb)", [JSON.stringify("https://verify.sintetico.example/verificar/[edition-id]")]));
    await send("post", "peditor", "/catalog", { catalogVersion: "provisional-1", kind: "category", keys: ["logistics"] }).expect(403);
    await send("post", "padmin", "/catalog", { catalogVersion: "provisional-1", kind: "category", keys: ["logistics"] }).expect(201);
    await send("post", "padmin", "/catalog", { catalogVersion: "provisional-1", kind: "otro", keys: ["x"] }).expect(422);
    await send("post", "peditor", "/private-terms", { term: "Cliente Ficticio", kind: "client" }).expect(403);
    await send("post", "padmin", "/private-terms", { term: "Cliente Ficticio", kind: "client" }).expect(201);
    await send("post", "padmin", "/products", { key: "guia_api", country: "MX", reviewPeriodicity: "annual" }).expect(201);
    await send("put", "peditor", "/products/guia_api/config", { fixedBlocks: [], links: [] }).expect(403);
    await send("put", "padmin", "/products/guia_api/config", { fixedBlocks: [{ blockId: "founder_letter", version: "3.0" }, { blockId: "journey", version: "1.0" }, { blockId: "guide_copy", version: "1.0" }], links: ["kl.links.discovery_start", "kl.links.edition_verify"] }).expect(200);
    for (const [blockId, version, content] of [["founder_letter", "3.0", LETTER], ["journey", "1.0", JOURNEY], ["guide_copy", "1.0", COPY]] as const) {
      for (const locale of ["es", "en"] as const) {
        const reg = await send("post", "peditor", "/fixed-blocks", { blockId, version, locale, content: content[locale] }).expect(201);
        await send("post", "peditor", `/fixed-blocks/${reg.body.id}/approve`).expect(403); // el editor no aprueba
        await send("post", "peditorial", `/fixed-blocks/${reg.body.id}/approve`).expect(200);
      }
    }
    expect((await get("peditor", "/fixed-blocks").expect(200)).body.items).toHaveLength(6);

    // fuentes y piezas con las funciones de la base (la UI de edición de fichas llega después)
    await call("peditor", async (tx) => {
      await klAdmin.proposeInstitution(tx, { key: "inst.api3", name: "Instituto API", country: "MX", authorityClass: "A", kind: "public" });
      await klAdmin.proposePublication(tx, { key: "pub.api3", institutionKey: "inst.api3", title: "Publicación API", jurisdiction: "MX", officialUrl: "https://api3.sintetico.example/p", permittedUse: "paraphrase_and_cite", defaultContentRisk: "low" });
    });
    await send("post", "padmin", "/publications/pub.api3/decision", { decision: "approve" }).expect(200);
    await call("peditor", (tx) => klAdmin.registerIndicator(tx, { key: "indicador_api3", nameEs: "Indicador", nameEn: "Indicator", unit: "%", direction: null, nature: "objective", publicationKey: "pub.api3", consumable: true }));
    const stat = await call("peditor", async (tx) => {
      await tx.query("SELECT kl.create_unit('stat.mx.api3.1', 'statistic', 'MX', 'MX-GUA', 't', ARRAY['logistics'], ARRAY[]::text[], ARRAY[]::text[], 'provisional-1', 'low')");
      const id = (await tx.query<{ v: string }>("SELECT kl.create_version('stat.mx.api3.1', 'team', NULL, 'new_period', 'paraphrase_and_cite', ARRAY[]::text[], ARRAY[]::text[], now(), NULL, NULL, false, NULL, $1::jsonb) AS v", [JSON.stringify({ indicator_key: "indicador_api3", geo_code: "MX-GUA", period_label: "2026-T1", period_start: "2026-01-01", period_end: "2026-03-31", value_numeric: 12.5, display_es: "12,5 %", display_en: "12.5%", unit_label: "%", publication_key: "pub.api3" })])).rows[0]?.v as string;
      await klAdmin.submitVersion(tx, id);
      return id;
    });
    await call("previewer", (tx) => klAdmin.approveVersion(tx, stat));
    const card = await call("peditor", async (tx) => {
      const id = await klAdmin.createCardVersion(tx, { unitKey: "card.mx.api3.1", country: "MX", topicKey: "api3.tema", categoryKeys: ["logistics"], contentRisk: "medium", cardType: "guidance", titleEs: "Ficha API", bodyEs: "Texto sintético de la ficha.", claimsEs: ["Afirmación API."], primarySourcePublicationKey: "pub.api3", limitsEs: ["Alcance sintético."], limitsEn: ["Synthetic scope."], variantEn: { title: "API card", body: "Synthetic card text.", claims: ["API claim."] } });
      await klAdmin.submitVersion(tx, id);
      return id;
    });
    await call("previewer", (tx) => klAdmin.approveVersion(tx, card));
    const reviewer2 = await (async () => (await h.mkUser("previewer2", "ADMIN"), await h.send("post", "padmin", "/role-grants", { adminUserId: u("previewer2").id, role: "KL_REVIEWER" }).expect(201), await h.get("previewer2", "/me").expect(200)))();
    void reviewer2;
    await call("previewer2", (tx) => klAdmin.approveVariant(tx, card));

    await send("post", "peditor", "/products/guia_api/sections", { sectionKey: "ch01", chapter: "01", slot: "key_data", titleEs: "Datos", titleEn: "Data", contentType: "data", order: 1 }).expect(201);
    await send("post", "peditor", "/products/guia_api/sections", { sectionKey: "ch02", chapter: "02", slot: "how_it_works", titleEs: "Guía", titleEn: "Guide", contentType: "guidance", order: 2 }).expect(201);
    await send("post", "previewer", "/products/guia_api/sections", { sectionKey: "ch03", chapter: "03", slot: "x", titleEs: "x", titleEn: "x", contentType: "data" }).expect(403);
    await send("post", "peditor", "/products/guia_api/composition", { sectionKey: "ch01", unitKey: "stat.mx.api3.1", order: 1 }).expect(201);
    await send("post", "peditor", "/products/guia_api/composition", { sectionKey: "ch02", unitKey: "card.mx.api3.1", order: 1 }).expect(201);
    await send("post", "peditor", "/products/guia_api/composition", { sectionKey: "ch02", unitKey: "no.existe", order: 2 }).expect(404);
    const comp = await get("psup", "/composition").expect(200);
    expect(comp.body.items.map((r: { unit_key: string }) => r.unit_key).sort()).toEqual(["card.mx.api3.1", "stat.mx.api3.1"]);
  });

  it("ciclo de la edición por HTTP: abrir → controles → enviar → vista previa → aprobar → publicar; cada paso con su rol", async () => {
    await send("post", "previewer", "/editions", { productKey: "guia_api", code: "2026.1", cutoffDate: "2026-10-15" }).expect(403);
    await send("post", "peditor", "/editions", { productKey: "guia_api", code: "26", cutoffDate: "2026-10-15" }).expect(422);
    await send("post", "peditor", "/editions", { productKey: "guia_api", code: "2026.1", cutoffDate: "ayer" }).expect(422);
    const opened = await send("post", "peditor", "/editions", { productKey: "guia_api", code: "2026.1", cutoffDate: "2026-10-15" }).expect(201);
    editionId = opened.body.id;
    const controls = await get("peditor", `/editions/${editionId}/controls`).expect(200);
    expect(controls.body).toMatchObject({ ready: true });
    expect(controls.body.controls.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining(["PINNED_PUBLISHED", "SPECIALIST_VALIDATION", "LOCALE_PAIR", "CATALOG_KEYS", "NO_PRIVATE_DATA", "FIXED_BLOCKS", "LINKS_CONFIGURED"]));
    await get("pnone", `/editions/${editionId}/controls`).expect(403);
    await send("post", "peditor2x" in h.users ? "peditor" : "previewer", `/editions/${editionId}/submit`).expect(403);
    const submitted = await send("post", "peditor", `/editions/${editionId}/submit`).expect(200);
    expect(submitted.body.manifestSha256).toMatch(/^[0-9a-f]{64}$/);

    // vista previa: PDF de prueba con marca; descarga autenticada de revisión
    await send("post", "pnone", `/editions/${editionId}/preview`).expect(403);
    const prev = await send("post", "peditor", `/editions/${editionId}/preview`).expect(202);
    expect(prev.body.renderJobId).toBeTruthy();
    await get("peditor", `/editions/${editionId}/preview/es/pdf`).expect(404); // aún no se genera
    expect((await renderEditionJob({ knowledge, store, browser }, editionId, "preview")).kind).toBe("preview");
    const pdf = await get("peditor", `/editions/${editionId}/preview/es/pdf`).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on("data", (x) => c.push(x)); r.on("end", () => cb(null, Buffer.concat(c))); }).expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.headers["cache-control"]).toBe("private, no-store");
    await get("pnone", `/editions/${editionId}/preview/es/pdf`).expect(403);
    await request(app).get(`/api/admin/kl/editions/${editionId}/preview/es/pdf`).expect(401);
    await get("peditor", `/editions/${editionId}/preview/fr/pdf`).expect(404);

    // aprobación editorial
    await send("post", "peditor", `/editions/${editionId}/approve`).expect(403);
    await send("post", "previewer", `/editions/${editionId}/approve`).expect(403);
    await send("post", "psup", `/editions/${editionId}/approve`).expect(403);
    const approved = await send("post", "peditorial", `/editions/${editionId}/approve`).expect(202);
    expect(approved.body.renderJobId).toBeTruthy();
    await send("post", "peditorial", `/editions/${editionId}/approve`).expect(409);
    expect((await renderEditionJob({ knowledge, store, browser }, editionId, "final")).kind).toBe("final");
    const list = await get("psup", "/editions").expect(200);
    expect(list.body.items[0]).toMatchObject({ product_key: "guia_api", code: "2026.1", status: "published", renderings: 2 });
  });

  it("la edición publicada se despublica o se revoca solo con el rol y el motivo correspondientes; todo queda auditado", async () => {
    await send("post", "peditor", `/editions/${editionId}/unpublish`, { reason: "motivo" }).expect(403);
    await send("post", "peditorial", `/editions/${editionId}/revoke`, { reason: "motivo" }).expect(403); // revocar es de KL_ADMIN
    await send("post", "padmin", `/editions/${editionId}/revoke`, {}).expect(422);
    await send("post", "padmin", `/editions/${editionId}/revoke`, { reason: "contenido erróneo" }).expect(200);
    await send("post", "padmin", `/editions/${editionId}/revoke`, { reason: "otra vez" }).expect(409);
    expect((await get("psup", "/editions").expect(200)).body.items[0].status).toBe("revoked");
    expect((await h.klAudit("kl.edition.revoke")).length).toBe(1);
    expect((await h.adminAudit("kl.edition.revoke")).filter((e) => e.outcome === "DENIED")).toHaveLength(1);
  });

  it("X30 de punta a punta: toda acción de escritura de R3 tiene su par en las dos auditorías y la correlación sale limpia", async () => {
    await new Promise((r) => setTimeout(r, 200));
    const r = await correlateAudit({ platform: h.platform, kl: h.klApp, graceMs: 100 });
    expect(r.adminOnly).toEqual([]);
    // lo único sin par son las llamadas directas de preparación; todo lo que pasó por la API (decenas de acciones) tiene su par
    expect(r.klOnly.map((x) => x.requestId).sort()).toEqual([...direct].sort());
    expect(r.status).toBe("discrepancies");
    expect(r.platformChecked).toBeGreaterThan(30);
    await new Promise((res) => setTimeout(res, 200));
    const again = await correlateAudit({ platform: h.platform, kl: h.klApp, graceMs: 100 });
    expect(again.klOnly).toEqual([]);
  });
});
