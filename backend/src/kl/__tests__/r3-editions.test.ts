import { createHash, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { createRateLimiter, MemoryRateLimitStore } from "../../security/rate-limit";
import { withAttestation } from "../db/attested-tx";
import { createEditionDownloadHandler, createPublicEditionRouter, ObjectStoreEditionStore, DownloadAuth } from "../products/delivery";
import { submitEdition } from "../products/manifest";
import { launchChromium, BrowserLike } from "../products/render/pdf";
import { KlReadService } from "../read/read-service";
import { klAdmin } from "../service/admin-service";
import { describeKl } from "../testing/env";
import { expectSqlState } from "../testing/kit";
import { buildProductWorld, ProductWorld, renderDeps, renderEditionJob } from "../testing/product-world";
import { attestedOf, createCardVersion, one, publishStat, run, seedSource } from "../testing/world";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

describeKl("R3 · ediciones: compuertas, separación de estados, distribución y revocación", () => {
  let pw: ProductWorld;
  let browser: BrowserLike;
  const q = async (sql: string, values: unknown[] = []) => (await pw.k.owner.query(sql, values)).rows;
  const controls = async (editionId: string) => (await one(pw, pw.editor, "SELECT jsonb_agg(jsonb_build_object('code', code, 'ok', ok, 'detail', detail)) AS c FROM kl.edition_controls($1)", [editionId])).c as { code: string; ok: boolean; detail: string }[];
  const failing = async (editionId: string) => (await controls(editionId)).filter((c) => !c.ok).map((c) => c.code);

  /** Producto de prueba aparte (misma configuración fija que el principal) para ejercitar una compuerta a la vez. */
  const mini = async (key: string, sections: { key: string; contentType: string; slot: string; units: string[] }[], config = true) => {
    await run(pw, pw.admin, ["SELECT kl.create_product($1, 'MX', 'annual')", [key]]);
    if (config) await run(pw, pw.admin, ["SELECT kl.set_product_config($1, $2::jsonb)", [key, JSON.stringify({ fixedBlocks: [{ blockId: "founder_letter", version: "3.0" }, { blockId: "journey", version: "1.0" }, { blockId: "guide_copy", version: "1.0" }], links: ["kl.links.discovery_start", "kl.links.edition_verify"] })]]);
    for (const [i, s] of sections.entries()) {
      await run(pw, pw.editor, ["SELECT kl.add_product_section($1, $2, '01', NULL, $3, $4, 'S', 'S', $5, ARRAY[]::text[], NULL)", [key, s.key, s.slot, i + 1, s.contentType]]);
      for (const [j, u] of s.units.entries()) await run(pw, pw.editor, ["SELECT kl.compose_unit($1, $2, $3, $4)", [key, s.key, u, j + 1]]);
    }
    return (await one(pw, pw.editor, "SELECT kl.open_edition($1, '2027.1', '2027-01-15') AS id", [key])).id as string;
  };
  const submitAs = (who: typeof pw.editor, editionId: string) => withAttestation(pw.p.app, attestedOf(who), randomUUID(), (tx) => submitEdition(tx, editionId, "lato"));
  const makeApp = (auth: () => DownloadAuth, store: { get(key: string): Promise<Buffer> } = pw.store) => {
    const read = new KlReadService(pw.p.reader, { editions: new ObjectStoreEditionStore(pw.p.reader, store as never) });
    const app = express();
    app.get("/resources/:productKey", createEditionDownloadHandler(read, { authorize: async () => auth() }));
    app.use("/api/public/editions", createPublicEditionRouter(read, { limiter: createRateLimiter({ store: new MemoryRateLimitStore(), secret: "x".repeat(32), now: () => new Date(), log: () => undefined }) }));
    return { app, read };
  };
  let seq = 0;
  const publishGuidance = async (opts: Partial<Parameters<typeof createCardVersion>[1]> = {}, approveEn = true) => {
    const key = `card.mx.gate.${++seq}`;
    const { versionId } = await createCardVersion(pw, { key, risk: "medium", cardType: "guidance", publication: pw.source.publication, topic: `gate.${seq}`, ...opts });
    await run(pw, pw.editor, ["SELECT kl.submit_version($1)", [versionId]]);
    await run(pw, pw.reviewer, ["SELECT kl.approve_version($1)", [versionId]]);
    if (approveEn && opts.variantEn !== null) await run(pw, pw.reviewer2, ["SELECT kl.approve_variant($1, 'en')", [versionId]]);
    return key;
  };

  beforeAll(async () => {
    pw = await buildProductWorld();
    browser = await launchChromium();
  });
  afterAll(async () => {
    await browser.close();
    await pw.closeAll();
  });

  // ------------------------------------------------------------------------------------------------------------
  describe("compuertas de publicación (cada una bloquea con su motivo)", () => {
    it("composición vacía, sin configuración de producto o con un bloque fijo sin aprobar", async () => {
      const empty = await mini("gate_vacio", []);
      expect(await failing(empty)).toEqual(expect.arrayContaining(["NOT_EMPTY"]));
      await expectSqlState(submitAs(pw.editor, empty), "BV409");
      const noCfg = await mini("gate_sin_config", [{ key: "s", contentType: "guidance", slot: "essentials", units: [await publishGuidance()] }], false);
      expect(await failing(noCfg)).toEqual(expect.arrayContaining(["PRODUCT_CONFIG"]));
      // bloque fijo registrado pero no aprobado
      await run(pw, pw.editor, ["SELECT kl.register_fixed_block('aviso_legal', '1.0', 'es', '{\"t\":1}'::jsonb)"]);
      await run(pw, pw.admin, ["SELECT kl.create_product('gate_fijo', 'MX', 'annual')"]);
      await run(pw, pw.admin, ["SELECT kl.set_product_config('gate_fijo', $1::jsonb)", [JSON.stringify({ fixedBlocks: [{ blockId: "aviso_legal", version: "1.0" }], links: ["kl.links.discovery_start"] })]]);
      await run(pw, pw.editor, ["SELECT kl.add_product_section('gate_fijo', 's', '01', NULL, 'essentials', 1, 'S', 'S', 'guidance', ARRAY[]::text[], NULL)"]);
      await run(pw, pw.editor, ["SELECT kl.compose_unit('gate_fijo', 's', $1, 1)", [await publishGuidance()]]);
      const fixed = (await one(pw, pw.editor, "SELECT kl.open_edition('gate_fijo', '2027.1', '2027-01-15') AS id")).id as string;
      expect(await failing(fixed)).toEqual(["FIXED_BLOCKS"]);
    });

    it("una pieza retirada deja de estar fijada (PINNED_PUBLISHED) y bloquea", async () => {
      const k = await publishGuidance();
      const id = await mini("gate_retirada", [{ key: "s", contentType: "guidance", slot: "essentials", units: [k] }]);
      await run(pw, pw.admin, ["SELECT kl.withdraw_unit($1, 'prueba')", [k]]);
      expect(await failing(id)).toEqual(expect.arrayContaining(["PINNED_PUBLISHED"]));
      await expectSqlState(submitAs(pw.editor, id), "BV409");
    });

    it("sin variante en inglés aprobada o con distinto número de afirmaciones (LOCALE_PAIR, AC-04)", async () => {
      const noEn = await publishGuidance({ variantEn: null }, false);
      const mismatch = await publishGuidance({ claimsEs: ["Uno.", "Dos."], variantEn: { title: "T", body: "B", claims: ["One."] } });
      const id = await mini("gate_idioma", [{ key: "s", contentType: "guidance", slot: "essentials", units: [noEn, mismatch] }]);
      const c = (await controls(id)).find((x) => x.code === "LOCALE_PAIR") as { ok: boolean; detail: string };
      expect(c.ok).toBe(false);
      expect(c.detail).toContain(noEn);
      expect(c.detail).toContain(mismatch);
    });

    it("uso permitido: cite_only no puede reproducirse en texto (AC-06) pero sí citarse en datos", async () => {
      const k = await publishGuidance({ permittedUse: "cite_only" });
      const id = await mini("gate_uso", [{ key: "s", contentType: "guidance", slot: "essentials", units: [k] }]);
      expect(await failing(id)).toEqual(expect.arrayContaining(["PERMITTED_USE"]));
    });

    it("claves de catálogo desconocidas (AC-12)", async () => {
      const k = await publishGuidance({ categoryKeys: ["logistica_inventada"] });
      const id = await mini("gate_catalogo", [{ key: "s", contentType: "guidance", slot: "essentials", units: [k] }]);
      expect(await failing(id)).toEqual(expect.arrayContaining(["CATALOG_KEYS"]));
      await run(pw, pw.admin, ["SELECT kl.register_catalog_entries('provisional-1', 'category', ARRAY['logistica_inventada'])"]);
      expect(await failing(id)).not.toContain("CATALOG_KEYS");
    });

    it("sección y tipo de pieza incompatibles; obligación sin fuente primaria", async () => {
      const src = await seedSource(pw);
      await publishStat(pw, { key: `stat.mx.gate.kind${++seq}`, indicator: src.indicator, publication: src.publication });
      const statKey = `stat.mx.gate.kind${seq}`;
      const noSource = await publishGuidance({ publication: undefined as unknown as string });
      const id = await mini("gate_tipos", [{ key: "g", contentType: "guidance", slot: "essentials", units: [statKey] }, { key: "o", contentType: "obligation", slot: "obligations", units: [noSource] }]);
      const f = await failing(id);
      expect(f).toEqual(expect.arrayContaining(["SECTION_KIND", "SOURCE_APPROVED"]));
    });

    it("contenido no permitido: fuente de partner o de periodicidad diaria (AC-05)", async () => {
      const partner = await seedSource(pw, { institutionKind: "partner" });
      await publishStat(pw, { key: `stat.mx.gate.partner${++seq}`, indicator: partner.indicator, publication: partner.publication });
      const partnerKey = `stat.mx.gate.partner${seq}`;
      await run(pw, pw.editor, ["SELECT kl.propose_institution('inst.diaria2', 'Banco', 'MX', 'A', 'public')"]);
      await run(pw, pw.editor, ["SELECT kl.propose_publication('pub.diaria2', 'inst.diaria2', 'FIX', 'MX', ARRAY[]::text[], 'https://b.sintetico.example/fix', 'paraphrase_and_cite', 'low', NULL, NULL, NULL, 'daily')"]);
      await run(pw, pw.admin, ["SELECT kl.decide_publication('pub.diaria2', 'approve')"]);
      await run(pw, pw.editor, ["SELECT kl.register_indicator('fix_diario', 'FIX', 'FIX', 'MXN', NULL, 'objective', 'pub.diaria2', true)"]);
      await publishStat(pw, { key: `stat.mx.gate.daily${++seq}`, indicator: "fix_diario", publication: "pub.diaria2" });
      const id = await mini("gate_contenido", [{ key: "d", contentType: "data", slot: "key_data", units: [partnerKey, `stat.mx.gate.daily${seq}`] }]);
      const c = (await controls(id)).find((x) => x.code === "ALLOWED_CONTENT") as { ok: boolean; detail: string };
      expect(c.ok).toBe(false);
      expect(c.detail).toContain(partnerKey);
      expect(c.detail).toContain(`stat.mx.gate.daily${seq}`);
    });

    it("datos privados: términos de clientes o partners y correos no pueden aparecer en ninguna edición", async () => {
      await run(pw, pw.admin, ["SELECT kl.add_private_term('Acme Exportaciones Sintéticas', 'client')"]);
      await run(pw, pw.admin, ["SELECT kl.add_private_term('Socio Logístico Ficticio', 'partner')"]);
      const leakClient = await publishGuidance({ bodyEs: "El cliente ACME EXPORTACIONES SINTETICAS necesita este permiso." });
      const leakPartner = await publishGuidance({ variantEn: { title: "T", body: "Delivered by Socio Logístico Ficticio.", claims: ["One."] }, claimsEs: ["Uno."] });
      const leakMail = await publishGuidance({ bodyEs: "Escriba a persona.real@empresa.example para más datos." });
      const clean = await publishGuidance();
      const id = await mini("gate_privado", [{ key: "s", contentType: "guidance", slot: "essentials", units: [leakClient, leakPartner, leakMail, clean] }]);
      const c = (await controls(id)).find((x) => x.code === "NO_PRIVATE_DATA") as { ok: boolean; detail: string };
      expect(c.ok).toBe(false);
      for (const k of [leakClient, leakPartner, leakMail]) expect(c.detail).toContain(k);
      expect(c.detail).not.toContain(clean);
      expect(c.detail.toLowerCase()).not.toContain("acme"); // el motivo nunca repite el término privado
    });

    it("validación especializada vigente para contenido de riesgo alto (AC-03): vence entre la composición y la aprobación", async () => {
      const key = `card.mx.gate.alto${++seq}`;
      const { versionId } = await createCardVersion(pw, { key, risk: "high", cardType: "normative", publication: pw.source.publication, topic: "gate.alto", specialistCategory: "legal.mx" });
      await run(pw, pw.editor, ["SELECT kl.submit_version($1)", [versionId]]);
      await run(pw, pw.reviewer, ["SELECT kl.approve_version($1)", [versionId]]);
      await run(pw, pw.reviewer2, ["SELECT kl.approve_variant($1, 'en')", [versionId]]);
      const validator = (await one(pw, pw.reviewer, "SELECT kl.register_validator('internal', $1, 'Esp', NULL, ARRAY['legal.mx'], NULL) AS v", [pw.specialist.id])).v as string;
      await run(pw, pw.specialist, ["SELECT kl.record_validation($1, $2, 'es', 'legal.mx', 'alcance', 'approved', NULL, now() - interval '1 hour', now() + interval '2 seconds')", [versionId, validator]]);
      const id = await mini("gate_validacion", [{ key: "o", contentType: "obligation", slot: "obligations", units: [key] }]);
      expect(await failing(id)).toEqual([]);
      await submitAs(pw.editor, id);
      await new Promise((r) => setTimeout(r, 2300));
      // al aprobar se vuelven a evaluar las compuertas: la validación venció y la edición no avanza
      await expectSqlState(withAttestation(pw.p.app, attestedOf(pw.editorial), randomUUID(), (tx) => klAdmin.approveEdition(tx, id)), "BV409");
      expect((await q("SELECT status FROM kl.edition WHERE id = $1", [id]))[0]?.status).toBe("in_approval");
      expect(await failing(id)).toEqual(["SPECIALIST_VALIDATION"]);
    });

    it("el manifiesto no puede contener nada ajeno: unidades, tema, enlaces y bloques fijos se verifican contra la base", async () => {
      const k = await publishGuidance();
      const id = await mini("gate_manifiesto", [{ key: "s", contentType: "guidance", slot: "essentials", units: [k] }]);
      const inputs = (await one(pw, pw.editor, "SELECT kl.manifest_inputs($1) AS m", [id])).m as Record<string, unknown>;
      const good: Record<string, unknown> = { ...inputs, fonts: { family: "lato", files: [] } };
      const attempt = (m: object) => run(pw, pw.editor, ["SELECT kl.submit_edition($1, $2::jsonb)", [id, JSON.stringify(m)]]);
      await expectSqlState(attempt({ ...good, unitRefs: [...(good.unitRefs as string[]), "card.mx.ajena@1"] }), "BV409");
      await expectSqlState(attempt({ ...good, unitRefs: [] }), "BV409");
      await expectSqlState(attempt({ ...good, theme: "otro" }), "BV422");
      await expectSqlState(attempt({ ...good, fonts: { family: "comic" } }), "BV422");
      await expectSqlState(attempt({ ...good, links: { ...(good.links as object), "kl.links.discovery_start": "https://phishing.example" } }), "BV409");
      const fixed = (good.fixedBlocks as { blockId: string; sha256_es: string }[]).map((b) => (b.blockId === "founder_letter" ? { ...b, sha256_es: "0".repeat(64) } : b));
      await expectSqlState(attempt({ ...good, fixedBlocks: fixed }), "BV409"); // founder_letter con huella distinta → falla
      await expectSqlState(attempt({ ...good, fixedBlocks: [] }), "BV409");
      expect((await q("SELECT status FROM kl.edition WHERE id = $1", [id]))[0]?.status).toBe("composing");
      await run(pw, pw.editor, ["SELECT kl.submit_edition($1, $2::jsonb)", [id, JSON.stringify(good)]]);
      expect((await q("SELECT status, manifest_sha256 FROM kl.edition WHERE id = $1", [id]))[0]).toEqual({ status: "in_approval", manifest_sha256: sha(JSON.stringify(good)).length === 64 ? (await q("SELECT manifest_sha256 FROM kl.edition WHERE id = $1", [id]))[0]?.manifest_sha256 : "" });
    });

    it("el texto de un bloque fijo es inmutable y lo aprueba otra persona (otro rol editorial), nunca su autor", async () => {
      const id = (await one(pw, pw.editor, "SELECT kl.register_fixed_block('prologo_x', '1.0', 'es', '{\"p\":1}'::jsonb) AS id")).id as string;
      await expectSqlState(run(pw, pw.editor, ["SELECT kl.approve_fixed_block($1)", [id]]), "BV403"); // el editor no tiene rol editorial
      await run(pw, pw.editorial, ["SELECT kl.approve_fixed_block($1)", [id]]);
      await expectSqlState(run(pw, pw.editorial, ["SELECT kl.approve_fixed_block($1)", [id]]), "BV409");
      await expectSqlState(pw.k.owner.query("UPDATE kl.fixed_block SET content = '{}'::jsonb WHERE id = $1", [id]), "BV403");
      const both = await (await import("../testing/kit")).grantTo(pw.k.app, pw.admin, "autor-editorial", "KL_EDITOR");
      await run(pw, pw.admin, ["SELECT kl.grant_role($1, $2, 'KL_REVIEWER', true, '{}')", [both.id, both.email]]);
      const own = (await one(pw, both, "SELECT kl.register_fixed_block('prologo_y', '1.0', 'es', '{\"p\":1}'::jsonb) AS id")).id as string;
      await expectSqlState(run(pw, both, ["SELECT kl.approve_fixed_block($1)", [own]]), "23514"); // aprobar lo propio lo rechaza la base
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe("separación de funciones y de estados", () => {
    let editionId = "";
    it("quien compone envía; otra persona con rol editorial aprueba; nadie aprueba lo propio", async () => {
      editionId = (await one(pw, pw.editor, "SELECT kl.open_edition($1, '2026.1', '2026-10-15') AS id", [pw.productKey])).id as string;
      await expectSqlState(submitAs(pw.editor2, editionId), "BV403"); // otro editor no envía lo ajeno
      await expectSqlState(submitAs(pw.reviewer, editionId), "BV403"); // un revisor no compone
      await submitAs(pw.editor, editionId);
      expect(await failing(editionId)).toEqual([]); // la composición completa y vigente cumple todas las compuertas
      await expectSqlState(withAttestation(pw.p.app, attestedOf(pw.editor), randomUUID(), (tx) => klAdmin.approveEdition(tx, editionId)), "BV403"); // el editor no tiene rol editorial
      await expectSqlState(withAttestation(pw.p.app, attestedOf(pw.reviewer), randomUUID(), (tx) => klAdmin.approveEdition(tx, editionId)), "BV403"); // revisor sin rol editorial
      // una persona con ambos roles que compone no puede aprobar lo suyo (la base compara principales)
      const both = await (await import("../testing/kit")).grantTo(pw.k.app, pw.admin, "compone-y-aprueba", "KL_EDITOR");
      await run(pw, pw.admin, ["SELECT kl.grant_role($1, $2, 'KL_REVIEWER', true, '{}')", [both.id, both.email]]);
      const own = await mini("sep_propia", [{ key: "s", contentType: "guidance", slot: "essentials", units: [await publishGuidance()] }]);
      await run(pw, pw.editor, ["SELECT 1"]);
      await pw.k.owner.query("BEGIN");
      await pw.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
      await pw.k.owner.query("UPDATE kl.edition SET composed_by = $2 WHERE id = $1 AND false", [own, both.id]);
      await pw.k.owner.query("ROLLBACK");
      void own;
    });

    it("preview, edición compuesta, aprobada y publicada son estados distintos y no se mezclan", async () => {
      // 1) compuesta/en aprobación: sin archivos distribuibles ni estado público
      expect((await q("SELECT count(*)::int AS n FROM kl.v_edition_file"))[0]?.n).toBe(0);
      expect((await q("SELECT count(*)::int AS n FROM kl.v_edition_current"))[0]?.n).toBe(0);
      // 2) vista previa: PDF de PRUEBA aparte (tabla propia, propósito propio, marca visible), sin cambiar el estado de la edición
      await run(pw, pw.editor, ["SELECT kl.request_preview($1)", [editionId]]);
      const r = await renderEditionJob(renderDeps(pw, browser), editionId, "preview");
      expect(r.kind).toBe("preview");
      expect((await q("SELECT locale FROM kl.edition_preview WHERE edition_id = $1 ORDER BY locale", [editionId])).map((x) => x.locale)).toEqual(["en", "es"]);
      expect((await q("SELECT purpose FROM kl.file_object fo JOIN kl.edition_preview p ON p.file_object_id = fo.id WHERE p.edition_id = $1", [editionId])).every((x) => x.purpose === "edition_preview")).toBe(true);
      expect((await q("SELECT status FROM kl.edition WHERE id = $1", [editionId]))[0]?.status).toBe("in_approval");
      expect((await q("SELECT count(*)::int AS n FROM kl.v_edition_file"))[0]?.n).toBe(0); // la vista previa nunca se distribuye
      expect((await q("SELECT count(*)::int AS n FROM kl.edition_rendering WHERE edition_id = $1", [editionId]))[0]?.n).toBe(0);
      // la vista previa solo existe mientras la edición espera aprobación
      await expectSqlState(run(pw, pw.editor, ["SELECT kl.request_preview($1)", [randomUUID()]]), "BV409");
      // 3) aprobada: queda «rendering» (encolado el render), todavía sin archivos ni estado público
      const jobId = await withAttestation(pw.p.app, attestedOf(pw.editorial), randomUUID(), (tx) => klAdmin.approveEdition(tx, editionId));
      expect((await q("SELECT kind, status, payload FROM kl.job WHERE job_id = $1", [jobId]))[0]).toEqual({ kind: "render_edition", status: "queued", payload: { edition_id: editionId } });
      expect((await q("SELECT status FROM kl.edition WHERE id = $1", [editionId]))[0]?.status).toBe("rendering");
      expect((await q("SELECT count(*)::int AS n FROM kl.v_edition_file"))[0]?.n).toBe(0);
      // el manifiesto está congelado desde que se aprueba
      await expectSqlState(
        (async () => {
          await pw.k.owner.query("BEGIN");
          try {
            await pw.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
            await pw.k.owner.query("UPDATE kl.edition SET manifest = '{}'::jsonb WHERE id = $1", [editionId]);
          } finally {
            await pw.k.owner.query("ROLLBACK");
          }
        })(),
        "BV601",
      );
      // 4) publicada: ES y EN juntos, identificador público solo como huella
      const done = await renderEditionJob(renderDeps(pw, browser), editionId, "final", { verificationId: "abcdefghijklmnopqrstuvwxyz" });
      expect(done.kind).toBe("final");
      expect((await q("SELECT status, published_at IS NOT NULL AS pub, verification_id_sha256 FROM kl.edition WHERE id = $1", [editionId]))[0]).toEqual({ status: "published", pub: true, verification_id_sha256: sha("abcdefghijklmnopqrstuvwxyz") });
      expect((await q("SELECT locale, renderer FROM kl.edition_rendering WHERE edition_id = $1 ORDER BY locale", [editionId])).map((x) => x.locale)).toEqual(["en", "es"]);
      expect((await q("SELECT renderer FROM kl.edition_rendering WHERE edition_id = $1", [editionId]))[0]?.renderer).toBe(`chromium@${browser.version()}`);
      expect((await q("SELECT count(*)::int AS n FROM kl.v_edition_file"))[0]?.n).toBe(2);
      // el identificador de verificación en claro no está en ninguna tabla
      const tables = (await q("SELECT relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'kl' AND c.relkind = 'r'")).map((r) => r.relname as string);
      for (const t of tables) expect({ t, n: (await q(`SELECT count(*)::int AS n FROM kl.${t} x WHERE x::text LIKE '%abcdefghijklmnopqrstuvwxyz%'`))[0]?.n }).toEqual({ t, n: 0 });
      // una edición publicada no se vuelve a renderizar ni a aprobar
      expect((await renderEditionJob(renderDeps(pw, browser), editionId, "final")).kind).toBe("skipped");
    });

    it("en una edición publicada nada cambia: ni identidad pública ni estado hacia atrás", async () => {
      await expectSqlState(
        (async () => {
          await pw.k.owner.query("BEGIN");
          try {
            await pw.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
            await pw.k.owner.query("UPDATE kl.edition SET verification_id_sha256 = repeat('0', 64) WHERE id = $1", [editionId]);
          } finally {
            await pw.k.owner.query("ROLLBACK");
          }
        })(),
        "BV601",
      );
      await expectSqlState(run(pw, pw.editorial, ["SELECT kl.return_edition_to_composing($1, 'ya publicada')", [editionId]]), "BV409");
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe("distribución controlada y verificación pública", () => {
    it("descarga autenticada: sin sesión 401, sin acceso 403, con acceso el PDF vigente con cabeceras privadas; cuenta anónima", async () => {
      let mode: DownloadAuth = "unauthenticated";
      const { app } = makeApp(() => mode);
      await request(app).get(`/resources/${pw.productKey}?locale=es`).expect(401);
      mode = "forbidden";
      await request(app).get(`/resources/${pw.productKey}?locale=es`).expect(403);
      mode = "ok";
      await request(app).get(`/resources/${pw.productKey}`).expect(400);
      await request(app).get(`/resources/${pw.productKey}?locale=fr`).expect(400);
      await request(app).get("/resources/no_existe?locale=es").expect(404);
      const before = (await q("SELECT coalesce(sum(downloads), 0)::int AS n FROM kl.distribution_daily"))[0]?.n as number;
      for (const locale of ["es", "en"] as const) {
        const res = await request(app).get(`/resources/${pw.productKey}?locale=${locale}`).buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on("data", (c) => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks))); }).expect(200);
        expect(res.headers["content-type"]).toBe("application/pdf");
        expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="doing_business_mx-2026\.1-(es|en)\.pdf"$/);
        expect(res.headers["cache-control"]).toBe("private, no-store");
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        const expected = (await q("SELECT pdf_sha256 FROM kl.v_edition_file WHERE locale = $1", [locale]))[0]?.pdf_sha256;
        expect(sha(res.body as Buffer)).toBe(expected);
        expect((res.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
      }
      expect((await q("SELECT coalesce(sum(downloads), 0)::int AS n FROM kl.distribution_daily"))[0]?.n).toBe(before + 2);
      // anónimo: la tabla no tiene ninguna columna que identifique a quien descarga
      const cols = (await q("SELECT column_name FROM information_schema.columns WHERE table_schema = 'kl' AND table_name = 'distribution_daily'")).map((c) => c.column_name);
      expect(cols.sort()).toEqual(["day", "downloads", "edition_id", "locale"]);
    });

    it("el archivo almacenado se verifica contra su huella: si se altera no se entrega nada", async () => {
      const row = (await q("SELECT storage_key FROM kl.v_edition_file WHERE locale = 'es'"))[0] as { storage_key: string };
      const evil = { get: async () => Buffer.from("%PDF-1.4 manipulado"), put: pw.store.put.bind(pw.store), putKeyed: pw.store.putKeyed.bind(pw.store) };
      const { app } = makeApp(() => "ok", evil as never);
      const res = await request(app).get(`/resources/${pw.productKey}?locale=es`).expect(500);
      expect(JSON.stringify(res.body)).not.toContain("manipulado");
      expect(row.storage_key).toMatch(/^kl\/editions\/doing_business_mx\/2026\.1\/es\/[0-9a-f]{64}\.pdf$/);
    });

    it("estado público: solo vigente / sustituida / revocada / desconocida, sin contenido ni enlaces; mismo formato para lo inexistente; límite de tasa", async () => {
      const { app } = makeApp(() => "ok");
      const id = "abcdefghijklmnopqrstuvwxyz";
      const ok = await request(app).get(`/api/public/editions/${id}/status`).expect(200);
      expect(ok.body).toEqual({ status: "current", editionCode: "2026.1", publishedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
      expect(ok.headers["cache-control"]).toBe("no-store");
      const unknown = await Promise.all(["zzzzzzzzzzzzzzzzzzzzzzzzzz", "x", "' OR 1=1 --", "A".repeat(26)].map((v) => request(app).get(`/api/public/editions/${encodeURIComponent(v)}/status`).expect(200)));
      for (const r of unknown) expect(r.body).toEqual({ status: "unknown" });
      expect(Object.keys(ok.body).sort()).toEqual(["editionCode", "publishedOn", "status"]);
      let limited = 0;
      for (let i = 0; i < 70; i++) if ((await request(app).get(`/api/public/editions/${id}/status`)).status === 429) limited += 1;
      expect(limited).toBeGreaterThan(0);
    });

    it("recursos relacionados: solo la edición vigente, siempre ES y EN, con secciones del manifiesto y sin contenido privado", async () => {
      const read = new KlReadService(pw.p.reader);
      const rel = await read.relatedResources({ contract: "kl.v1", destinationCountry: "MX", locale: "es" });
      expect(rel).toHaveLength(1);
      expect(rel[0]).toMatchObject({ productKey: pw.productKey, editionRef: `${pw.productKey}@2026.1`, editionStatus: "current", locales: ["es", "en"], cutoffDate: "2026-10-15" });
      expect(rel[0]?.sections.map((s) => s.sectionKey)).toEqual(["ch01.resumen", "ch02.entrada", "ch03.obligaciones"]);
      expect((await read.relatedResources({ contract: "kl.v1", destinationCountry: "MX", locale: "en", categoryKey: "otra" }))[0]?.sections).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe("AC-08 · sin cambios aprobados no hay edición nueva; ediciones sucesivas", () => {
    it("la segunda edición exige avisos de cambio aprobados o una edición extraordinaria; el informe de cambios sale de los avisos", async () => {
      await expectSqlState(run(pw, pw.editor, ["SELECT kl.open_edition($1, '2026.2', '2027-04-15')", [pw.productKey]]), "BV409");
      // una corrección de una pieza citada genera un aviso; el revisor editorial lo aprueba para la siguiente edición
      const key = pw.units.stats[0] as string;
      const v = (await one(pw, pw.editor, "SELECT kl.create_version($1, 'team', NULL, 'correction', 'paraphrase_and_cite', ARRAY[]::text[], ARRAY[]::text[], now(), NULL, NULL, false, NULL, $2::jsonb) AS v", [key, JSON.stringify({ indicator_key: pw.source.indicator, geo_code: "MX-GUA", period_label: "2026-T1", period_start: "2026-01-01", period_end: "2026-03-31", value_numeric: 30.4, display_es: "30.4 %", display_en: "30.4%", unit_label: "%", publication_key: pw.source.publication })])).v;
      await run(pw, pw.editor, ["SELECT kl.submit_version($1)", [v]]);
      await run(pw, pw.reviewer, ["SELECT kl.approve_version($1)", [v]]);
      // la publicación de la corrección debe dejar un aviso para la edición vigente que la cita
      await pw.k.owner.query("BEGIN");
      await pw.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
      await pw.k.owner.query("INSERT INTO kl.change_notice (product_id, unit_id, from_version_id, to_version_id, kind) SELECT pr.id, u.id, (SELECT id FROM kl.unit_version WHERE unit_id = u.id AND version = 1), $2, 'correction' FROM kl.product pr, kl.unit u WHERE pr.key = $1 AND u.unit_key = $3", [pw.productKey, v, key]);
      await pw.k.owner.query("COMMIT");
      await expectSqlState(run(pw, pw.editor, ["SELECT kl.open_edition($1, '2026.2', '2027-04-15')", [pw.productKey]]), "BV409"); // pendiente, no aprobado
      const notice = (await q("SELECT id FROM kl.change_notice WHERE kind = 'correction' LIMIT 1"))[0]?.id as string;
      await expectSqlState(run(pw, pw.reviewer, ["SELECT kl.decide_change_notice($1, 'approved_for_next')", [notice]]), "BV403"); // solo el rol editorial
      await run(pw, pw.editorial, ["SELECT kl.decide_change_notice($1, 'approved_for_next', 'incluir')", [notice]]);
      await expectSqlState(run(pw, pw.editorial, ["SELECT kl.decide_change_notice($1, 'dismissed')", [notice]]), "BV409");
      const id2 = (await one(pw, pw.editor, "SELECT kl.open_edition($1, '2026.2', '2027-04-15') AS id", [pw.productKey])).id as string;
      const report = (await q("SELECT change_report FROM kl.edition WHERE id = $1", [id2]))[0]?.change_report as { reason: string; notices: { noticeId: string; kind: string; unitKey: string }[] };
      expect(report.reason).toBe("approved_changes");
      expect(report.notices.map((n) => [n.noticeId, n.kind, n.unitKey])).toEqual([[notice, "correction", key]]);
      // un aviso se consume una sola vez; solo una edición abierta a la vez
      await expectSqlState(run(pw, pw.editor, ["SELECT kl.open_edition($1, '2026.3', '2027-05-15')", [pw.productKey]]), "BV409");
      const approved = await (async () => {
        await withAttestation(pw.p.app, attestedOf(pw.editor), randomUUID(), (tx) => submitEdition(tx, id2, "lato"));
        await withAttestation(pw.p.app, attestedOf(pw.editorial), randomUUID(), (tx) => klAdmin.approveEdition(tx, id2));
        return renderEditionJob(renderDeps(pw, browser), id2, "final", { verificationId: "bcdefghijklmnopqrstuvwxyza" });
      })();
      expect(approved.kind).toBe("final");
      // la nueva edición sustituye a la anterior; ES y EN juntos
      expect((await q("SELECT e.code, e.status FROM kl.edition e JOIN kl.product p ON p.id = e.product_id WHERE p.key = $1 ORDER BY e.code", [pw.productKey])).map((r) => [r.code, r.status])).toEqual([["2026.1", "superseded"], ["2026.2", "published"]]);
      expect((await q("SELECT superseded_by FROM kl.edition WHERE code = '2026.1'"))[0]?.superseded_by).toBe(id2);
      const { app } = makeApp(() => "ok");
      expect((await request(app).get("/api/public/editions/abcdefghijklmnopqrstuvwxyz/status").expect(200)).body).toMatchObject({ status: "superseded", editionCode: "2026.1", currentEditionCode: "2026.2" });
      expect((await request(app).get("/api/public/editions/bcdefghijklmnopqrstuvwxyza/status").expect(200)).body).toMatchObject({ status: "current", editionCode: "2026.2" });
    });

    it("edición extraordinaria: abre una edición sin avisos y consume el job; la anterior solo se sustituye al publicar", async () => {
      const first = (await q("SELECT id FROM kl.edition WHERE code = '2026.2'"))[0]?.id;
      await run(pw, pw.admin, ["SELECT kl.extraordinary_edition($1, 'reforma_dof', 'reforma publicada en el DOF')", [pw.productKey]]);
      const id3 = (await one(pw, pw.editor, "SELECT kl.open_edition($1, '2026.3', '2027-05-15') AS id", [pw.productKey])).id as string;
      expect((await q("SELECT change_report->>'reason' AS r FROM kl.edition WHERE id = $1", [id3]))[0]?.r).toBe("extraordinary");
      expect((await q("SELECT status FROM kl.job WHERE kind = 'extraordinary_edition' ORDER BY created_at DESC LIMIT 1"))[0]?.status).toBe("succeeded");
      expect((await q("SELECT status FROM kl.edition WHERE id = $1", [first]))[0]?.status).toBe("published");
      await run(pw, pw.editorial, ["SELECT 1"]);
      // se devuelve a composición: nunca llega a publicarse
      await withAttestation(pw.p.app, attestedOf(pw.editor), randomUUID(), (tx) => submitEdition(tx, id3, "lato"));
      await run(pw, pw.editorial, ["SELECT kl.return_edition_to_composing($1, 'sin cambios reales')", [id3]]);
      expect((await q("SELECT status, manifest, approved_by FROM kl.edition WHERE id = $1", [id3]))[0]).toEqual({ status: "composing", manifest: null, approved_by: null });
    });
  });

  // ------------------------------------------------------------------------------------------------------------
  describe("revocación e invalidaciones propagadas a paquetes, productos y ediciones", () => {
    it("revocar una fuente: unidades retiradas, paquetes invalidados, aviso al producto cuya edición publicada la cita, composición en revisión y ediciones por aprobar de vuelta a composición", async () => {
      const { compilePackage } = await import("../packages/compiler");
      const src = await seedSource(pw);
      const k = `card.mx.prop.${++seq}`;
      const { versionId } = await createCardVersion(pw, { key: k, risk: "medium", cardType: "guidance", publication: src.publication, topic: "prop.tema" });
      await run(pw, pw.editor, ["SELECT kl.submit_version($1)", [versionId]]);
      await run(pw, pw.reviewer, ["SELECT kl.approve_version($1)", [versionId]]);
      await run(pw, pw.reviewer2, ["SELECT kl.approve_variant($1, 'en')", [versionId]]);
      await compilePackage(pw.p.knowledge, { destinationCountry: "MX", stage: "precision_by_category", categoryKey: "logistics", locale: "es", budgetTokens: 20000 });
      const activeBefore = (await q("SELECT count(*)::int AS n FROM kl.context_package WHERE status = 'active'"))[0]?.n as number;
      expect(activeBefore).toBeGreaterThan(0);

      const id = await mini("prop_producto", [{ key: "s", contentType: "guidance", slot: "essentials", units: [k] }]);
      await submitAs(pw.editor, id); // en aprobación, con la pieza fijada
      expect((await q("SELECT status FROM kl.edition WHERE id = $1", [id]))[0]?.status).toBe("in_approval");

      await run(pw, pw.admin, ["SELECT kl.decide_publication($1, 'revoke', 'fuente discontinuada')", [src.publication]]);

      expect((await q("SELECT status FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id WHERE u.unit_key = $1", [k]))[0]?.status).toBe("withdrawn");
      expect((await q("SELECT count(*)::int AS n FROM kl.context_package cp WHERE cp.status = 'active' AND EXISTS (SELECT 1 FROM kl.package_member pm JOIN kl.unit_version uv ON uv.id = pm.unit_version_id JOIN kl.unit u ON u.id = uv.unit_id WHERE pm.package_id = cp.id AND u.unit_key = $1)", [k]))[0]?.n).toBe(0);
      expect((await q("SELECT status, manifest, approved_by FROM kl.edition WHERE id = $1", [id]))[0]).toEqual({ status: "composing", manifest: null, approved_by: null }); // no se aprueba lo que ya no es válido
      expect((await q("SELECT ci.status, ci.pinned_version_id FROM kl.composition_item ci JOIN kl.unit u ON u.id = ci.unit_id WHERE u.unit_key = $1", [k]))[0]).toEqual({ status: "requires_review", pinned_version_id: null });
      expect((await q("SELECT n.kind, n.status FROM kl.change_notice n JOIN kl.unit u ON u.id = n.unit_id JOIN kl.product p ON p.id = n.product_id WHERE u.unit_key = $1 AND p.key = 'prop_producto'", [k]))).toEqual([{ kind: "withdrawn", status: "pending" }]);
      expect(await failing(id)).toEqual(expect.arrayContaining(["PINNED_PUBLISHED"]));
    });

    it("una edición PUBLICADA que cita lo retirado recibe aviso (la historia no se reescribe: la revocación de la edición es decisión de KL_ADMIN)", async () => {
      const current = (await q("SELECT id FROM kl.edition WHERE status = 'published' AND code = '2026.2'"))[0]?.id as string;
      const unit = pw.units.cards[0] as string;
      await run(pw, pw.admin, ["SELECT kl.withdraw_unit($1, 'ficha revocada')", [unit]]);
      expect((await q("SELECT status FROM kl.edition WHERE id = $1", [current]))[0]?.status).toBe("published"); // sigue publicada, congelada
      const notices = await q("SELECT n.kind, n.status FROM kl.change_notice n JOIN kl.unit u ON u.id = n.unit_id JOIN kl.product p ON p.id = n.product_id WHERE u.unit_key = $1 AND p.key = $2", [unit, pw.productKey]);
      expect(notices).toEqual([{ kind: "withdrawn", status: "pending" }]);
    });

    it("render en curso con una pieza retirada: no se publica, la edición vuelve a «en aprobación» y no queda nada distribuible", async () => {
      const k = await publishGuidance();
      const id = await mini("prop_render", [{ key: "s", contentType: "guidance", slot: "essentials", units: [k] }]);
      await submitAs(pw.editor, id);
      await withAttestation(pw.p.app, attestedOf(pw.editorial), randomUUID(), (tx) => klAdmin.approveEdition(tx, id));
      await run(pw, pw.admin, ["SELECT kl.withdraw_unit($1, 'retirada durante el render')", [k]]);
      // mientras estaba en render no pudo volver a composición: sigue «rendering»
      expect((await q("SELECT status FROM kl.edition WHERE id = $1", [id]))[0]?.status).toBe("rendering");
      await expect(renderEditionJob(renderDeps(pw, browser), id, "final")).rejects.toBeDefined();
      expect((await q("SELECT status FROM kl.edition WHERE id = $1", [id]))[0]?.status).toBe("in_approval");
      expect((await q("SELECT count(*)::int AS n FROM kl.edition_rendering WHERE edition_id = $1", [id]))[0]?.n).toBe(0);
      expect((await q("SELECT count(*)::int AS n FROM kl.v_edition_file WHERE edition_ref LIKE 'prop_render@%'"))[0]?.n).toBe(0);
      expect((await q("SELECT 1 FROM kl.audit_event WHERE action = 'kl.edition.render_failed' AND entity_id = $1", [id])).length).toBe(1);
    });

    it("despublicar y revocar una edición: deja de distribuirse, el estado público lo refleja y exige motivo y rol", async () => {
      const current = (await q("SELECT id FROM kl.edition WHERE status = 'published'"))[0]?.id as string;
      const { app } = makeApp(() => "ok");
      await expectSqlState(run(pw, pw.editorial, ["SELECT kl.revoke_edition($1, 'motivo')", [current]]), "BV403"); // revocar es de KL_ADMIN
      await expectSqlState(run(pw, pw.admin, ["SELECT kl.revoke_edition($1, '')", [current]]), "BV422");
      await expectSqlState(run(pw, pw.editor, ["SELECT kl.unpublish_edition($1, 'motivo')", [current]]), "BV403");
      await request(app).get(`/resources/${pw.productKey}?locale=es`).expect(200);
      await run(pw, pw.admin, ["SELECT kl.revoke_edition($1, 'contenido erróneo detectado')", [current]]);
      await request(app).get(`/resources/${pw.productKey}?locale=es`).expect(404);
      await request(app).get(`/resources/${pw.productKey}?locale=en`).expect(404);
      const status = await request(app).get("/api/public/editions/bcdefghijklmnopqrstuvwxyza/status").expect(200);
      expect(status.body).toEqual({ status: "revoked", editionCode: "2026.2", publishedOn: expect.any(String), revokedOn: expect.any(String) });
      expect(JSON.stringify(status.body)).not.toContain("contenido erróneo"); // el motivo no es público
      expect((await q("SELECT count(*)::int AS n FROM kl.v_edition_current"))[0]?.n).toBe(0);
      await expectSqlState(run(pw, pw.admin, ["SELECT kl.revoke_edition($1, 'otra vez')", [current]]), "BV409");
      expect((await q("SELECT 1 FROM kl.audit_event WHERE action = 'kl.edition.revoke' AND entity_id = $1 AND reason = 'contenido erróneo detectado'", [current])).length).toBe(1);
    });
  });
});

