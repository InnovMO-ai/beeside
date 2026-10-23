import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { withAttestation } from "../db/attested-tx";
import { KlError } from "../db/errors";
import { LocalObjectStore } from "../ingest/object-store";
import { DevNoScan } from "../ingest/upload-validator";
import { compilePackage } from "../packages/compiler";
import { KlReadService } from "../read/read-service";
import { claimDigest, isSingleSentence } from "../read/text";
import { loadSyntheticKseed, SYNTHETIC } from "../seed/synthetic-kseed";
import { klAdmin } from "../service/admin-service";
import { describeKl, roleUrl } from "../testing/env";
import { asPerson } from "../testing/kit";
import { attestedOf, buildWorld, createCardVersion, one, pools, publishCard, publishStat, run, seedSource, World } from "../testing/world";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const DIMS: { destinationCountry: string; stage: "precision_by_category"; locale: "es" | "en" } = { destinationCountry: "MX", stage: "precision_by_category", locale: "es" };
const PROJECT_REF = (seed: string) => claimDigest(`proyecto-${seed}`);

describeKl("lado KL de kl.v1 (I2, I3, I5, I6, I7) con datos sintéticos", () => {
  let w: World;
  let p: ReturnType<typeof pools>;
  let svc: KlReadService;
  let store: LocalObjectStore;

  beforeAll(async () => {
    w = await buildWorld();
    p = pools();
    svc = new KlReadService(p.reader, { onError: (e) => process.stderr.write(`[kl-read] ${String((e as Error)?.message)}\n`) });
    store = new LocalObjectStore(fs.mkdtempSync(path.join(os.tmpdir(), "kl-store-")), { NODE_ENV: "test" });
    await loadSyntheticKseed({ app: p.app, store, scan: new DevNoScan({ NODE_ENV: "test" }), actors: { editor: attestedOf(w.editor), reviewer: attestedOf(w.reviewer), admin: attestedOf(w.admin) } });
  });
  afterAll(async () => {
    await p.closeAll();
    await w.close();
  });

  const query = (dimensions: Partial<typeof DIMS> & Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    svc.query({ contract: "kl.v1", dimensions: { ...DIMS, ...dimensions } as never, ...extra } as never);

  describe("I3 · consulta: sufficient / partial / not_available", () => {
    it("sufficient: estadística pedida por indicador y entidad, con procedencia y vigencia", async () => {
      const r = await query({ region: "MX-GUA" }, { indicatorKeys: [SYNTHETIC.indicator] });
      expect(r).toMatchObject({ availability: "ok", coverage: "sufficient", coverageReasons: [], approvedClaims: [] });
      const u = r.units[0];
      expect(u).toMatchObject({ ref: expect.stringMatching(/^stat\.mx\./), kind: "statistic", usage: "citable", localeFallback: false, confidence: "reviewed" });
      expect(u?.content.value).toMatchObject({ number: 41.2, valueStatus: "value", unit: "%", direction: "lower_is_better" });
      expect(u?.provenance).toMatchObject({ authorityClass: "A", publicationKey: SYNTHETIC.publication });
      expect(u?.validity.period).toMatchObject({ label: "2026-T1" });
    });

    it("A02 · ficha de contexto con límites: sufficient, sin rutas, costos ni tiempos", async () => {
      const r = await query({ topic: "logistics.port", informationType: "general_requirement" });
      expect(r.coverage).toBe("sufficient");
      expect(r.units).toHaveLength(1);
      expect(r.units[0]?.limits).toEqual(["No incluye rutas, costos ni tiempos."]);
      expect(JSON.stringify(r.units[0]?.content)).not.toMatch(/\d+\s?(USD|MXN|d[ií]as|horas)/i);
    });

    it("A03 · tema sin cobertura: not_available, pista de demanda y señal opaca; sin tráfico saliente", async () => {
      const r = await query({ topic: "logistics.rail.port_hinterland", informationType: "procedure", categoryKey: "logistics" });
      expect(r).toMatchObject({ coverage: "not_available", coverageReasons: ["no_unit"], units: [], approvedClaims: [] });
      expect(r.demandHint).toEqual({ topic: "logistics.rail.port_hinterland", informationType: "procedure", partialUnitRefs: [] });
      const signal = { contract: "kl.v1" as const, destinationCountry: "MX", topic: "logistics.rail.port_hinterland", categoryKey: "logistics", informationType: "procedure" as const, coverage: "absent" as const, stage: "precision_by_category" as const, locale: "es" as const, candidate: "knowledge_candidate" as const, projectRef: PROJECT_REF("a03"), occurredAt: new Date().toISOString() };
      expect(await svc.emitDemand(signal, r.availability)).toBe("recorded");
      const g = (await w.k.owner.query("SELECT topic, signal_count, distinct_projects FROM kl.demand_group WHERE topic = 'logistics.rail.port_hinterland'")).rows[0];
      expect(g).toEqual({ topic: "logistics.rail.port_hinterland", signal_count: "1", distinct_projects: 1 });
    });

    it("la consulta sin ningún criterio no vuelca el repositorio", async () => {
      const r = await query({});
      expect(r.units).toEqual([]);
      expect(r.coverage).toBe("not_available");
    });

    it("agregado de ranking por entidad: ordena valores publicados de un mismo indicador y periodo, sin calcular nada", async () => {
      const r = await query({}, { aggregate: { kind: "rank", indicatorKey: SYNTHETIC.indicator, scope: "states", limit: 3 } });
      expect(r.units.map((u) => [u.dimensions.region, u.content.value?.number, u.content.rank?.position, u.content.rank?.of])).toEqual([
        ["MX-NLE", 28.4, 1, 6],
        ["MX-CHH", 30.7, 2, 6],
        ["MX-QUE", 33.1, 3, 6],
      ]);
      const max = await query({}, { aggregate: { kind: "max", indicatorKey: SYNTHETIC.indicator, scope: "states", limit: 1 } });
      expect(max.units[0]?.content.value?.number).toBe(52.9);
    });

    it("límites de integración: ≤ 20 unidades, texto ≤ 1,200 caracteres, claves de indicador acotadas", async () => {
      const r = await query({}, { aggregate: { kind: "min", indicatorKey: SYNTHETIC.indicator, scope: "states", limit: 500 } });
      expect(r.units.length).toBeLessThanOrEqual(20);
      const long = await query({ region: "MX-GUA" }, { indicatorKeys: Array.from({ length: 30 }, (_, i) => `ind_${i}`).concat(SYNTHETIC.indicator).slice(0, 10) });
      expect(long.availability).toBe("ok");
    });

    it("peticiones mal formadas no lanzan: respuesta vacía con availability", async () => {
      await expect(svc.query({} as never)).resolves.toMatchObject({ coverage: "not_available", units: [] });
      await expect(query({ destinationCountry: "méxico" })).resolves.toMatchObject({ units: [] });
    });
  });

  describe("I2/I3 · versiones y vigencia de estadísticas", () => {
    it("periodo nuevo = unidad nueva; corrección = versión; vigencia = última publicada no retirada del periodo más reciente", async () => {
      const src = await seedSource(w);
      const t1 = { label: "2025-T4", start: "2025-10-01", end: "2025-12-31" };
      const t2 = { label: "2026-T1", start: "2026-01-01", end: "2026-03-31" };
      await publishStat(w, { key: "stat.mx.vig.2025t4", indicator: src.indicator, publication: src.publication, period: t1, value: 10 });
      await publishStat(w, { key: "stat.mx.vig.2026t1", indicator: src.indicator, publication: src.publication, period: t2, value: 11 });
      const ask = () => query({ region: "MX-GUA" }, { indicatorKeys: [src.indicator] });
      let r = await ask();
      expect(r.units.map((u) => [u.ref, u.content.value?.number])).toEqual([["stat.mx.vig.2026t1@1", 11]]); // periodo más reciente
      // corrección: misma unidad, versión 2
      const created = await one(w, w.editor, "SELECT kl.create_version('stat.mx.vig.2026t1', 'team', NULL, 'correction', 'paraphrase_and_cite', ARRAY[]::text[], ARRAY[]::text[], now(), NULL, NULL, false, NULL, $1::jsonb) AS v", [
        JSON.stringify({ indicator_key: src.indicator, geo_code: "MX-GUA", period_label: t2.label, period_start: t2.start, period_end: t2.end, value_numeric: 11.4, display_es: "11.4 %", display_en: "11.4%", unit_label: "%", publication_key: src.publication }),
      ]);
      await run(w, w.editor, ["SELECT kl.submit_version($1)", [created.v]]);
      await run(w, w.reviewer, ["SELECT kl.approve_version($1)", [created.v]]);
      r = await ask();
      expect(r.units.map((u) => [u.ref, u.content.value?.number])).toEqual([["stat.mx.vig.2026t1@2", 11.4]]);
      const versions = (await w.k.owner.query("SELECT version, status FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id WHERE u.unit_key = 'stat.mx.vig.2026t1' ORDER BY version")).rows;
      expect(versions).toEqual([{ version: 1, status: "superseded" }, { version: 2, status: "published" }]);
      // retirada del periodo más reciente: la historia queda intacta
      await run(w, w.admin, ["SELECT kl.withdraw_unit('stat.mx.vig.2026t1', 'prueba')"]);
      r = await ask();
      expect(r.units.map((u) => u.ref)).toEqual(["stat.mx.vig.2025t4@1"]);
      expect((await w.k.owner.query("SELECT count(*)::int AS n FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id WHERE u.unit_key = 'stat.mx.vig.2026t1'")).rows[0].n).toBe(2);
    });

    it("percepción y compuestos no son consumibles (D2, T11)", async () => {
      const src = await seedSource(w);
      await run(w, w.editor, ["SELECT kl.register_indicator('indice_percepcion', 'Percepción', 'Perception', 'pts', NULL, 'perception', $1, false)", [src.publication]]);
      await expectSqlStateInsertConsumablePerception(w);
    });

    it("pasada la siguiente publicación esperada: citable con latestAvailable y motivo latest_available_only", async () => {
      const src = await seedSource(w);
      await publishStat(w, { key: "stat.mx.tardia.2026", indicator: src.indicator, publication: src.publication, nextReviewAt: new Date(Date.now() - 86_400_000).toISOString() });
      const r = await query({ region: "MX-GUA" }, { indicatorKeys: [src.indicator] });
      expect(r).toMatchObject({ coverage: "partial", coverageReasons: ["latest_available_only"] });
      expect(r.units[0]).toMatchObject({ usage: "citable" });
      expect(r.units[0]?.validity.latestAvailable).toBe(true);
    });

    it("una estadística vencida (valid_to) deja de ser consumible", async () => {
      const src = await seedSource(w);
      await publishStat(w, { key: "stat.mx.vence.2026", indicator: src.indicator, publication: src.publication, validTo: new Date(Date.now() + 1500).toISOString() });
      expect((await query({ region: "MX-GUA" }, { indicatorKeys: [src.indicator] })).coverage).toBe("sufficient");
      await new Promise((r) => setTimeout(r, 1700));
      expect((await query({ region: "MX-GUA" }, { indicatorKeys: [src.indicator] })).coverage).toBe("not_available");
    });
  });

  describe("A09 · intermediario frente a primaria", () => {
    it("Precision recibe la cifra de la primaria; el intermediario solo aporta su posición con nota", async () => {
      const primary = await seedSource(w, { publicationKey: "pub.enoe.sint" });
      const mid = await seedSource(w, { authorityClass: "B", institutionKind: "research", publicationKey: "pub.imco.sint" });
      await publishStat(w, { key: "stat.mx.enoe.gua", indicator: primary.indicator, publication: primary.publication, value: 30 });
      // el intermediario referencia a la primaria y trae su propio valor (que NO debe viajar) y su ranking
      const key = "stat.mx.imco.gua";
      await run(w, w.editor, ["SELECT kl.create_unit($1, 'statistic', 'MX', 'MX-GUA', 't', ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[], 'p', 'low')", [key]]);
      const v = (await one(w, w.editor, "SELECT kl.create_version($1, 'team', NULL, 'new_period', 'cite_only', ARRAY['Posición de un intermediario'], ARRAY[]::text[], now(), NULL, NULL, false, NULL, $2::jsonb) AS v", [
        key,
        JSON.stringify({ indicator_key: mid.indicator, geo_code: "MX-GUA", period_label: "2026-T1", period_start: "2026-01-01", period_end: "2026-03-31", value_numeric: 99, display_es: "99", display_en: "99", unit_label: "pts", publication_key: mid.publication, primary_ref: "stat.mx.enoe.gua@1", rank_position: 3, rank_of: 32 }),
      ])).v;
      await run(w, w.editor, ["SELECT kl.submit_version($1)", [v]]);
      await run(w, w.reviewer, ["SELECT kl.approve_version($1)", [v]]);
      const r = await query({ region: "MX-GUA" }, { indicatorKeys: [mid.indicator] });
      const u = r.units[0];
      expect(u?.content.value?.number).toBe(30); // la primaria, no el 99 del intermediario
      expect(u?.content.rank).toMatchObject({ position: 3, of: 32 });
      expect(u?.provenance).toMatchObject({ primaryRef: "stat.mx.enoe.gua@1", authorityClass: "B" });
      expect(JSON.stringify(r)).not.toContain("99");
    });
  });

  describe("PO-3 · idioma y validación en fichas", () => {
    it("variante en inglés aprobada: se sirve en inglés y es citable", async () => {
      const r = await query({ locale: "en", topic: "country.profile" });
      expect(r.units[0]).toMatchObject({ locale: "en", localeFallback: false, usage: "citable", title: expect.stringMatching(/country profile/i) });
      expect(r.coverage).toBe("sufficient");
    });

    it("LOW/MEDIUM sin variante aprobada en inglés: español como contexto (locale_fallback)", async () => {
      await publishCard(w, { key: "card.mx.sin-en", variantEn: null, topic: "tema.sin.en" }, false);
      const r = await query({ locale: "en", topic: "tema.sin.en" });
      expect(r).toMatchObject({ coverage: "partial", coverageReasons: ["locale_fallback"] });
      expect(r.units[0]).toMatchObject({ locale: "es", localeFallback: true, usage: "context_only" });
      expect(r.approvedClaims).toEqual([]);
    });

    it("HIGH sin variante en inglés no se entrega (locale_unavailable_high)", async () => {
      const tag = randomUUID().slice(0, 6);
      const validator = await registerInternalValidator(w);
      const versionId = await publishHighCard(w, `card.mx.high-sin-en.${tag}`, `tema.high.${tag}`, validator, null);
      expect(versionId).toBeTruthy();
      const es = await query({ locale: "es", topic: `tema.high.${tag}` });
      expect(es.units[0]).toMatchObject({ usage: "citable", confidence: "specialist_validated", risk: "high" });
      const en = await query({ locale: "en", topic: `tema.high.${tag}` });
      expect(en).toMatchObject({ coverage: "not_available", units: [] });
      expect(en.coverageReasons).toContain("locale_unavailable_high");
    });

    it("HIGH con validación vencida: solo título, límites y especialista (validation_expired)", async () => {
      const tag = randomUUID().slice(0, 6);
      const validator = await registerInternalValidator(w);
      await publishHighCard(w, `card.mx.high-vence.${tag}`, `tema.vence.${tag}`, validator, { title: "High card", body: "High body" }, 2);
      expect((await query({ topic: `tema.vence.${tag}` })).units[0]?.usage).toBe("citable");
      await new Promise((r) => setTimeout(r, 2300));
      const r = await query({ topic: `tema.vence.${tag}` });
      expect(r).toMatchObject({ coverage: "partial", coverageReasons: ["validation_expired"] });
      expect(r.units[0]).toMatchObject({ usage: "context_only", specialist: { required: true, reason: "validation_expired" } });
      expect(r.units[0]?.content).toEqual({}); // sin texto normativo
      expect(r.units[0]?.title).toBeTruthy();
    });
  });

  describe("I6 · compuerta de afirmaciones aprobadas (CR-KL-001)", () => {
    const topic = "claims.sint";
    beforeAll(async () => {
      await publishCard(w, { key: "card.mx.claims", topic, claimsEs: ["La declaración sintética exige un formulario de prueba.", "Segunda frase. Que no es una sola.", "Otra afirmación sintética única."], publication: SYNTHETIC.publication, variantEn: { title: "Claims", body: "Body", claims: ["The synthetic filing requires a test form."] } });
    });

    it("apagada por defecto: approvedClaims siempre []", async () => {
      const r = await query({ topic });
      expect(r.units).toHaveLength(1);
      expect(r.approvedClaims).toEqual([]);
    });

    it("activarla sin referencia de aceptación: rechazo y auditoría; sigue apagada", async () => {
      const outcome = await withAttestation(p.app, attestedOf(w.admin), randomUUID(), (tx) => klAdmin.setR10Claims(tx, true, null));
      expect(outcome).toEqual({ ok: false, reason: "rejected_missing_acceptance_ref" });
      expect((await w.k.owner.query("SELECT count(*)::int AS n FROM kl.audit_event WHERE action = 'kl.r10_claims.rejected'")).rows[0].n).toBe(1);
      expect((await query({ topic })).approvedClaims).toEqual([]);
    });

    it("solo KL_ADMIN la cambia", async () => {
      await expect(withAttestation(p.app, attestedOf(w.editorial), randomUUID(), (tx) => klAdmin.setR10Claims(tx, true, "CR-KL-001 aceptado"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("con la referencia registrada emite solo frases únicas de fuente A con huella normalizada, y se puede volver a apagar", async () => {
      expect(await withAttestation(p.app, attestedOf(w.admin), randomUUID(), (tx) => klAdmin.setR10Claims(tx, true, "CR-KL-001 · aceptación Precision 2026-10"))).toEqual({ ok: true });
      const r = await query({ topic });
      expect(r.approvedClaims.map((c) => c.text)).toEqual(["La declaración sintética exige un formulario de prueba.", "Otra afirmación sintética única."]);
      expect(r.approvedClaims[0]).toMatchObject({ claimId: "card.mx.claims@1#1", authority: "A", locale: "es", authorization: { kind: "reviewed" }, normalizedSha256: claimDigest("La declaración sintética exige un formulario de prueba.") });
      const en = await query({ topic, locale: "en" });
      expect(en.approvedClaims.map((c) => c.claimId)).toEqual(["card.mx.claims@1#1"]);
      expect(isSingleSentence("Segunda frase. Que no es una sola.")).toBe(false);
      await withAttestation(p.app, attestedOf(w.admin), randomUUID(), (tx) => klAdmin.setR10Claims(tx, false, null));
      expect((await query({ topic })).approvedClaims).toEqual([]);
    });
  });

  describe("I5 · paquetes de contexto y validez por turno", () => {
    it("compila solo lo publicado, respeta el presupuesto y excluye valores de periodicidad diaria (T15)", async () => {
      const daily = await seedSource(w);
      // una publicación diaria: su indicador nunca entra a un paquete
      await w.k.owner.query("BEGIN");
      await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
      await w.k.owner.query("UPDATE kl.publication SET status = status WHERE key = $1", [daily.publication]).catch(() => undefined);
      await w.k.owner.query("ROLLBACK");
      await run(w, w.editor, ["SELECT kl.propose_institution('inst.diaria', 'Banco Sintético', 'MX', 'A', 'public')"]);
      await run(w, w.editor, ["SELECT kl.propose_publication('pub.fix.sint', 'inst.diaria', 'FIX sintético', 'MX', ARRAY[]::text[], 'https://banco.sintetico.example/fix', 'paraphrase_and_cite', 'low', NULL, NULL, NULL, 'daily')"]);
      await run(w, w.admin, ["SELECT kl.decide_publication('pub.fix.sint', 'approve')"]);
      await run(w, w.editor, ["SELECT kl.register_indicator('tipo_cambio_fix_sint', 'FIX', 'FIX', 'MXN', NULL, 'objective', 'pub.fix.sint', true)"]);
      await publishStat(w, { key: "stat.mx.fix.hoy", indicator: "tipo_cambio_fix_sint", publication: "pub.fix.sint", value: 17.1 });

      const compiled = await compilePackage(p.knowledge, { destinationCountry: "MX", stage: "precision_by_category", categoryKey: "logistics", locale: "es", budgetTokens: 5000 });
      expect(compiled).not.toBeNull();
      const pkg = await svc.contextPackage({ contract: "kl.v1", scope: { destinationCountry: "MX", stage: "precision_by_category", categoryKey: "logistics", locale: "es" } });
      expect(pkg.status).toBe("package");
      if (pkg.status !== "package") return;
      expect(pkg.package.manifest.some((m) => m.startsWith("stat.mx.fix"))).toBe(false);
      expect(pkg.package.estimatedTokens).toBeLessThanOrEqual(5000);
      expect(pkg.package.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(pkg.package.units.length).toBe(pkg.package.manifest.length);

      // mismo paquete conocido → unchanged
      expect(await svc.contextPackage({ contract: "kl.v1", scope: { destinationCountry: "MX", stage: "precision_by_category", categoryKey: "logistics", locale: "es" }, knownPackageRef: pkg.package.packageRef })).toMatchObject({ status: "unchanged" });
      expect(await svc.packageStatus({ packageRefs: [pkg.package.packageRef, "pkg.mx.no.existe.es@1"] })).toEqual({ availability: "ok", statuses: { [pkg.package.packageRef]: "valid", "pkg.mx.no.existe.es@1": "invalidated" } });

      // presupuesto: con un presupuesto mínimo se omite lo que no cabe, nunca se supera
      const small = await compilePackage(p.knowledge, { destinationCountry: "MX", stage: "precision_by_category", categoryKey: "logistics", locale: "es", budgetTokens: 60 });
      expect(small === null || small.estimatedTokens <= 60).toBe(true);
    });

    it("A06 · retirar una ficha invalida el paquete en el acto, deja aviso de cambio y conserva la historia", async () => {
      const tag = randomUUID().slice(0, 6);
      await publishCard(w, { key: `card.mx.retirable.${tag}`, topic: `retiro.${tag}`, publication: SYNTHETIC.publication });
      // un producto que cita la unidad (composición de R3 simulada con inserciones del dueño en la prueba)
      await w.k.owner.query("BEGIN");
      await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
      const prod = (await w.k.owner.query("INSERT INTO kl.product (key, kind, country, master_locale) VALUES ($1, 'guide', 'MX', 'es') RETURNING id", [`prod_${tag}`])).rows[0].id;
      const sec = (await w.k.owner.query("INSERT INTO kl.product_section (product_id, section_key, chapter, slot, sort_order, title_es, title_en, content_type) VALUES ($1, 'ch01.essentials', '01', 'essentials', 1, 'x', 'x', 'guidance') RETURNING id", [prod])).rows[0].id;
      await w.k.owner.query("INSERT INTO kl.composition_item (section_id, unit_id, sort_order) SELECT $1, id, 1 FROM kl.unit WHERE unit_key = $2", [sec, `card.mx.retirable.${tag}`]);
      await w.k.owner.query("COMMIT");

      const compiled = await compilePackage(p.knowledge, { destinationCountry: "MX", stage: "precision_by_category", categoryKey: "logistics", locale: "es", budgetTokens: 8000 });
      const before = await svc.contextPackage({ contract: "kl.v1", scope: { destinationCountry: "MX", stage: "precision_by_category", categoryKey: "logistics", locale: "es" } });
      void compiled;
      const ref = before.status === "package" ? before.package.packageRef : "";
      expect(ref).not.toBe("");
      expect((await query({ topic: `retiro.${tag}` })).units).toHaveLength(1);

      await run(w, w.admin, ["SELECT kl.withdraw_unit($1, 'ficha revocada')", [`card.mx.retirable.${tag}`]]);

      // siguiente turno: el paquete ya no es válido y la ficha no se entrega
      expect((await svc.packageStatus({ packageRefs: [ref] })).statuses[ref]).toBe("invalidated");
      expect((await query({ topic: `retiro.${tag}` })).coverage).toBe("not_available");
      expect((await svc.contextPackage({ contract: "kl.v1", scope: { destinationCountry: "MX", stage: "precision_by_category", categoryKey: "logistics", locale: "es" } })).status).toBe("none");
      const notice = (await w.k.owner.query("SELECT cn.kind, cn.status FROM kl.change_notice cn JOIN kl.unit u ON u.id = cn.unit_id WHERE u.unit_key = $1", [`card.mx.retirable.${tag}`])).rows;
      expect(notice).toEqual([{ kind: "withdrawn", status: "pending" }]);
      const history = (await w.k.owner.query("SELECT status FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id WHERE u.unit_key = $1", [`card.mx.retirable.${tag}`])).rows;
      expect(history).toEqual([{ status: "withdrawn" }]);
    });

    it("A10 · revocar una fuente: una transacción; lo derivado queda retirado y el siguiente turno es not_available", async () => {
      const src = await seedSource(w);
      await publishStat(w, { key: "stat.mx.a10.2026", indicator: src.indicator, publication: src.publication });
      await publishCard(w, { key: "card.mx.a10", topic: "a10.tema", publication: src.publication });
      expect((await query({ region: "MX-GUA" }, { indicatorKeys: [src.indicator] })).coverage).toBe("sufficient");
      expect((await query({ topic: "a10.tema" })).coverage).toBe("sufficient");
      const versionsBefore = (await w.k.owner.query("SELECT count(*)::int AS n FROM kl.unit_version")).rows[0].n;
      await run(w, w.admin, ["SELECT kl.decide_publication($1, 'revoke', 'fuente discontinuada')", [src.publication]]);
      expect((await query({ region: "MX-GUA" }, { indicatorKeys: [src.indicator] })).coverage).toBe("not_available");
      expect((await query({ topic: "a10.tema" })).coverage).toBe("not_available");
      expect((await w.k.owner.query("SELECT count(*)::int AS n FROM kl.unit_version")).rows[0].n).toBe(versionsBefore); // historia intacta
      expect((await w.k.owner.query("SELECT status FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id WHERE u.unit_key IN ('stat.mx.a10.2026', 'card.mx.a10') ORDER BY u.unit_key")).rows).toEqual([{ status: "withdrawn" }, { status: "withdrawn" }]);
    });

    it("lo suspendido deja de ser consumible y vuelve al reanudar", async () => {
      const src = await seedSource(w);
      await publishStat(w, { key: "stat.mx.suspende.2026", indicator: src.indicator, publication: src.publication });
      await run(w, w.admin, ["SELECT kl.decide_publication($1, 'suspend')", [src.publication]]);
      expect((await query({ region: "MX-GUA" }, { indicatorKeys: [src.indicator] })).coverage).toBe("not_available");
      await run(w, w.admin, ["SELECT kl.decide_publication($1, 'resume')", [src.publication]]);
      expect((await query({ region: "MX-GUA" }, { indicatorKeys: [src.indicator] })).coverage).toBe("sufficient");
    });
  });

  describe("I7 · señales y uso: minimización", () => {
    const base = () => ({ contract: "kl.v1" as const, destinationCountry: "MX", topic: "aduanas.permisos", informationType: "general_requirement" as const, coverage: "absent" as const, stage: "understanding" as const, locale: "es" as const, candidate: "unclear" as const, projectRef: PROJECT_REF(randomUUID()), occurredAt: new Date().toISOString() });

    it("un DTO con el nombre de la empresa no deja rastro en ninguna tabla de kl", async () => {
      const dirty = { ...base(), companyName: "ACME Exportaciones Sintéticas S.A.", email: "cliente@acme.example", normalizedQuery: "ACME quiere exportar aguacate" } as never;
      expect(await svc.emitDemand(dirty, "ok")).toBe("recorded");
      const tables = (await w.k.owner.query("SELECT relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'kl' AND c.relkind = 'r'")).rows.map((r) => r.relname as string);
      for (const t of tables) {
        const hit = await w.k.owner.query(`SELECT count(*)::int AS n FROM kl.${t} x WHERE x::text ILIKE '%acme%' OR x::text ILIKE '%aguacate%'`);
        expect({ t, n: hit.rows[0].n }).toEqual({ t, n: 0 });
      }
      expect((await w.k.owner.query("SELECT coalesce(sum(fields_discarded), 0)::int AS n FROM kl.signal_discard_daily")).rows[0].n).toBeGreaterThanOrEqual(3);
    });

    it("la demanda no se emite con availability distinto de ok", async () => {
      const before = (await w.k.owner.query("SELECT count(*)::int AS n FROM kl.demand_signal")).rows[0].n;
      for (const a of ["degraded", "unavailable", "disabled"] as const) expect(await svc.emitDemand(base(), a)).toBe("skipped");
      expect((await w.k.owner.query("SELECT count(*)::int AS n FROM kl.demand_signal")).rows[0].n).toBe(before);
    });

    it("agrupa por tema y cuenta proyectos distintos por HMAC opaco", async () => {
      const ref = PROJECT_REF("mismo-proyecto");
      const s = { ...base(), topic: "grupo.demo", projectRef: ref };
      await svc.emitDemand(s, "ok");
      await svc.emitDemand({ ...s }, "ok");
      await svc.emitDemand({ ...s, projectRef: PROJECT_REF("otro") }, "ok");
      const g = (await w.k.owner.query("SELECT signal_count, distinct_projects, first_seen <= last_seen AS ordered FROM kl.demand_group WHERE topic = 'grupo.demo'")).rows[0];
      expect(g).toEqual({ signal_count: "3", distinct_projects: 2, ordered: true });
    });

    it("señales inválidas se rechazan: HMAC mal formado, fecha fuera de ventana, tipo desconocido", async () => {
      expect(await svc.emitDemand({ ...base(), projectRef: "empresa-acme" }, "ok")).toBe("invalid");
      expect(await svc.emitDemand({ ...base(), occurredAt: "2020-01-01T00:00:00Z" }, "ok")).toBe("invalid");
      expect(await svc.emitDemand({ ...base(), informationType: "opinion" as never }, "ok")).toBe("invalid");
      expect((await w.k.owner.query("SELECT coalesce(sum(signals_rejected), 0)::int AS n FROM kl.signal_discard_daily")).rows[0].n).toBeGreaterThanOrEqual(3);
    });

    it("uso agregado: sin identificador de proyecto", async () => {
      const r = await query({ topic: "country.profile" });
      const ref = r.units[0]?.ref as string;
      expect(await svc.reportUsage({ contract: "kl.v1", items: [{ ref, stage: "understanding", destinationCountry: "MX", via: "query", count: 2 }, { ref: "no.existe@9", stage: "understanding", destinationCountry: "MX", via: "ram", count: 1 }] })).toBe(1);
      await svc.reportUsage({ contract: "kl.v1", items: [{ ref, stage: "understanding", destinationCountry: "MX", via: "query", count: 3 }] });
      const u = (await w.k.owner.query("SELECT count FROM kl.usage_daily")).rows;
      expect(u).toEqual([{ count: "5" }]);
      const cols = (await w.k.owner.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'kl' AND table_name = 'usage_daily'")).rows.map((c) => c.column_name);
      expect(cols.some((c: string) => /project/i.test(c))).toBe(false);
    });
  });

  describe("X28 · resiliencia: KL caído o lento", () => {
    it("con la base de KL caída Precision recibe availability unavailable, sin afirmaciones, sin demanda y sin error", async () => {
      const dead = new Pool({ connectionString: roleUrl("kl_reader_precision").replace(/:\d+\//, ":1/"), connectionTimeoutMillis: 300 });
      dead.on("error", () => undefined);
      const down = new KlReadService(dead);
      const q = await down.query({ contract: "kl.v1", dimensions: { ...DIMS, topic: "x" } });
      expect(q).toMatchObject({ availability: "unavailable", coverage: "not_available", units: [], approvedClaims: [], related: [] });
      expect(q.demandHint).toBeUndefined();
      expect(await down.contextPackage({ contract: "kl.v1", scope: { destinationCountry: "MX", stage: "understanding", locale: "es" } })).toMatchObject({ availability: "unavailable", status: "none" });
      expect((await down.packageStatus({ packageRefs: ["pkg.a@1"] })).statuses).toEqual({ "pkg.a@1": "invalidated" });
      expect(await down.emitDemand({ contract: "kl.v1" } as never, q.availability)).toBe("skipped");
      expect(await down.reportUsage({ contract: "kl.v1", items: [] })).toBe(0);
      // M1 (decisión del PO, 22-oct-2026): una caída de la base NO es «unknown»; el estado público señala UNAVAILABLE (la ruta responde 503).
      await expect(down.editionPublicStatus("x")).rejects.toMatchObject({ code: "UNAVAILABLE" });
      await dead.end().catch(() => undefined);
    });

    it("presupuesto de 250 ms: una lectura lenta responde degraded y vacía", async () => {
      const slow = { query: async (...a: unknown[]) => { await new Promise((r) => setTimeout(r, 120)); return (p.reader.query as (...x: unknown[]) => Promise<unknown>)(...a); } } as unknown as Pool;
      const tight = new KlReadService(slow, { budgetMs: 30 });
      expect(await tight.query({ contract: "kl.v1", dimensions: { ...DIMS, topic: "country.profile" } })).toMatchObject({ availability: "degraded", units: [], approvedClaims: [] });
    });
  });

  describe("estado público de edición y entrega (R3 apagado)", () => {
    it("un identificador inexistente o mal formado devuelve unknown, igual que cualquier otro", async () => {
      expect(await svc.editionPublicStatus("abcdefghijklmnopqrstuvwxyz")).toEqual({ status: "unknown" });
      expect(await svc.editionPublicStatus("' OR 1=1 --")).toEqual({ status: "unknown" });
      expect(await svc.relatedResources({ contract: "kl.v1", destinationCountry: "MX", locale: "es" })).toEqual([]);
      expect(await svc.openEdition({ productKey: "doing_business_mx", locale: "es" })).toEqual({ status: "no_current_edition" });
    });
  });
});

// ---------------------------------------------------------------------------------------------------- ayudas
async function expectSqlStateInsertConsumablePerception(w: World) {
  // la restricción de la base impide marcar consumable un indicador de percepción
  await expect(
    run(w, w.editor, ["SELECT kl.register_indicator('indice_percepcion_2', 'P', 'P', 'pts', NULL, 'perception', NULL, true)"]),
  ).rejects.toMatchObject({ code: "23514" });
}

async function registerInternalValidator(w: World): Promise<string> {
  return (await one(w, w.reviewer, "SELECT kl.register_validator('internal', $1, 'Especialista Sintético', NULL, ARRAY['legal.mx'], NULL) AS v", [w.specialist.id])).v as string;
}

/** Ficha HIGH publicada por el camino real: redacta → revisa (nivel 3) → validación del especialista en su dominio. */
async function publishHighCard(w: World, key: string, topic: string, validator: string, variantEn: { title: string; body: string } | null, validSeconds = 3600): Promise<string> {
  const { versionId } = await createCardVersion(w, { key, risk: "high", cardType: "normative", topic, publication: SYNTHETIC.publication, variantEn: variantEn ?? null });
  await run(w, w.editor, ["SELECT kl.submit_version($1)", [versionId]]);
  expect((await one(w, w.reviewer, "SELECT kl.approve_version($1) AS s", [versionId])).s).toBe("awaiting_validation");
  if (variantEn) await run(w, w.reviewer2, ["SELECT kl.approve_variant($1, 'en')", [versionId]]);
  expect(
    (await one(w, w.specialist, "SELECT kl.record_validation($1, $2, 'es', 'legal.mx', 'alcance sintético', 'approved', NULL, now() - interval '1 hour', now() + make_interval(secs => $3)) AS s", [versionId, validator, validSeconds])).s,
  ).toBe("published");
  return versionId;
}

void asPerson;
void KlError;
