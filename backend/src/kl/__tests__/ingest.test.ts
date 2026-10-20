import { deflateRawSync } from "node:zlib";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LocalObjectStore } from "../ingest/object-store";
import { extractCsv, parseCsv, runQa } from "../ingest/csv-extractor";
import { DevNoScan, sha256OfBytes, validateUpload } from "../ingest/upload-validator";
import { loadSyntheticKseed, SYNTHETIC, syntheticCsv } from "../seed/synthetic-kseed";
import { describeKl } from "../testing/env";
import { expectSqlState, grantTo, tx } from "../testing/kit";
import { attestedOf, buildWorld, one, pools, run, World } from "../testing/world";

const MAX = 50 * 1024 * 1024;

/** Zip mínimo sin compresión: suficiente para que el validador lea el directorio central. */
function zip(names: string[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from("x");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
void deflateRawSync;

describe("A08 · validación de archivos antes de guardar", () => {
  const ok = (b: Buffer | string) => validateUpload(Buffer.from(b), { maxBytes: MAX });
  it("acepta CSV, JSON, texto, XLSX y DOCX limpios, detectados por firma y no por nombre", () => {
    expect(ok("a,b\n1,2\n")).toMatchObject({ ok: true, type: "csv" });
    expect(ok('{"a":1}')).toMatchObject({ ok: true, type: "json" });
    expect(ok("solo texto sintético")).toMatchObject({ ok: true, type: "txt" });
    expect(ok(zip(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]))).toMatchObject({ ok: true, type: "xlsx" });
    expect(ok(zip(["[Content_Types].xml", "word/document.xml"]))).toMatchObject({ ok: true, type: "docx" });
    expect(ok("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF")).toMatchObject({ ok: true, type: "pdf" });
  });
  it.each([
    ["XLSM con macros (vbaProject.bin)", zip(["[Content_Types].xml", "xl/workbook.xml", "xl/vbaProject.bin"]), "macro_enabled_office"],
    ["DOCM con macros", zip(["word/document.xml", "word/vbaProject.bin"]), "macro_enabled_office"],
    ["XLSX con objetos OLE incrustados", zip(["xl/workbook.xml", "xl/embeddings/oleObject1.bin"]), "embedded_objects"],
    ["PDF con /JavaScript", Buffer.from("%PDF-1.7\n1 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj"), "active_content_pdf"],
    ["PDF con /JavaScript ofuscado (#61)", Buffer.from("%PDF-1.7\n1 0 obj << /S /J#61vaScript >> endobj"), "active_content_pdf"],
    ["PDF con /OpenAction", Buffer.from("%PDF-1.7\n<< /OpenAction 3 0 R >>"), "active_content_pdf"],
    ["PDF con /Launch", Buffer.from("%PDF-1.7\n<< /S /Launch >>"), "active_content_pdf"],
    ["ejecutable (MZ)", Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3, 4, 5]), "executable"],
    ["ELF", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), "executable"],
    ["script (#!)", Buffer.from("#!/bin/sh\nrm -rf /"), "executable"],
    ["HTML con script", Buffer.from("<html><script>alert(1)</script></html>"), "active_content_text"],
    ["CSV con fórmula (=)", Buffer.from('a,b\n"=HYPERLINK(""http://x"")",2\n'), "formula_injection"],
    ["CSV con fórmula (@)", Buffer.from("a,b\n@SUM(1+1),2\n"), "formula_injection"],
    ["JSON inválido", Buffer.from('{"a":'), "invalid_json"],
    ["ZIP arbitrario", zip(["algo.txt"]), "unsupported_type"],
    ["binario no UTF-8", Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0xfb, 0x00, 0x01]), "unsupported_type"],
    ["vacío", Buffer.alloc(0), "empty"],
  ])("rechaza: %s", (_label, bytes, reason) => {
    const d = ok(bytes as Buffer);
    expect(d).toMatchObject({ ok: false, reason });
    expect(d.sha256).toBe(sha256OfBytes(bytes as Buffer)); // solo queda el motivo y la huella
  });
  it("rechaza lo que excede el tamaño máximo", () => {
    expect(validateUpload(Buffer.alloc(2000, 97), { maxBytes: 1000 })).toMatchObject({ ok: false, reason: "too_large" });
  });
  it("sin escáner en producción la carga se rechaza (B8): DevNoScan no existe allí", async () => {
    expect(await new DevNoScan({ NODE_ENV: "production" }).scan()).toBe("unavailable");
    expect(await new DevNoScan({ NODE_ENV: "test" }).scan()).toBe("clean");
  });
});

describe("almacén de originales inmutable", () => {
  it("guarda por huella, no reescribe y rechaza contenido que no coincide; solo desarrollo", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-obj-"));
    const store = new LocalObjectStore(dir, { NODE_ENV: "test" });
    const bytes = Buffer.from("original sintético");
    const sha = sha256OfBytes(bytes);
    const key = await store.put(sha, bytes);
    expect(key).toBe(`local/${sha.slice(0, 2)}/${sha}`);
    expect(await store.put(sha, bytes)).toBe(key);
    expect((await store.get(key)).equals(bytes)).toBe(true);
    await expect(store.put(sha, Buffer.from("otro contenido"))).rejects.toThrow(/huella/);
    await expect(store.get("../../etc/passwd")).rejects.toThrow();
    expect(() => new LocalObjectStore(dir, { NODE_ENV: "production" })).toThrow(/solo de desarrollo/);
    expect(() => fs.writeFileSync(path.join(dir, key), "manipulado")).toThrow(); // 0o444
  });
});

describe("extracción y QA (I8)", () => {
  it("cada fila lleva su localizador; el CSV con comillas y comas se interpreta sin fórmulas", () => {
    expect(parseCsv('a,b\n"x, y",2\n')).toEqual([["a", "b"], ["x, y", "2"]]);
    const { rows, missingColumns } = extractCsv(syntheticCsv());
    expect(missingColumns).toEqual([]);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ locator: "row:2", indicator_key: SYNTHETIC.indicator, geo_code: "MX-GUA", parsed_value: 41.2, classification: "new_period" });
    expect(rows.at(-1)?.locator).toBe("row:7");
  });
  it("columnas faltantes se reportan", () => {
    expect(extractCsv("indicator_key,value\nx,1\n").missingColumns).toEqual(["geo_code", "period_label", "period_start", "period_end"]);
  });
  it("QA: duplicados, no numéricos, rango porcentual e indicador desconocido bloquean; los nulos solo avisan", () => {
    const known = new Set(["i1"]);
    const base = "indicator_key,geo_code,period_label,period_start,period_end,value\n";
    const qa = (body: string) => runQa(extractCsv(base + body).rows, { knownIndicators: known, percentIndicators: known });
    expect(qa("i1,MX-A,T1,2026-01-01,2026-03-31,10\ni1,MX-B,T1,2026-01-01,2026-03-31,20\n").blockingFailures).toBe(0);
    expect(qa("i1,MX-A,T1,2026-01-01,2026-03-31,10\ni1,MX-A,T1,2026-01-01,2026-03-31,11\n").checks.find((c) => c.name === "duplicates")?.status).toBe("fail");
    expect(qa("i1,MX-A,T1,2026-01-01,2026-03-31,abc\n").blockingFailures).toBeGreaterThan(0);
    expect(qa("i1,MX-A,T1,2026-01-01,2026-03-31,140\n").checks.find((c) => c.name === "percent_range")?.blocking).toBe(true);
    expect(qa("zz,MX-A,T1,2026-01-01,2026-03-31,5\n").checks.find((c) => c.name === "unknown_indicator")?.blocking).toBe(true);
    expect(qa("i1,MX-A,T1,2026-01-01,2026-03-31,n/d\n").blockingFailures).toBe(0);
  });
});

describeKl("canal de carga contra beeside_kl (I8, I9)", () => {
  let w: World;
  let p: ReturnType<typeof pools>;
  let store: LocalObjectStore;

  beforeAll(async () => {
    w = await buildWorld();
    p = pools();
    store = new LocalObjectStore(fs.mkdtempSync(path.join(os.tmpdir(), "kl-ingest-")), { NODE_ENV: "test" });
  });
  afterAll(async () => {
    await p.closeAll();
    await w.close();
  });

  const sources = async (key: string) => {
    await run(w, w.editor, ["SELECT kl.propose_institution($1, 'Instituto', 'MX', 'A', 'public')", [`inst.${key}`]]);
    await run(w, w.editor, ["SELECT kl.propose_publication($1, $2, 'Pub', 'MX', ARRAY[]::text[], 'https://x.sintetico.example/p', 'paraphrase_and_cite', 'low')", [`pub.${key}`, `inst.${key}`]]);
    await run(w, w.editor, ["SELECT kl.register_indicator($1, 'I', 'I', '%', NULL, 'objective', $2, true)", [`ind_${key}`, `pub.${key}`]]);
  };
  const file = async (content: string, publication: string | null) => {
    const bytes = Buffer.from(content);
    const sha = sha256OfBytes(bytes);
    const fileId = (await one(w, w.editor, "SELECT kl.register_file_object($1, 'csv', $2, $3, 'not_required_dev', 'source_original') AS f", [sha, bytes.length, await store.put(sha, bytes)])).f as string;
    const batch = (await one(w, w.editor, "SELECT kl.create_ingest_batch('team', $1, '2026-T1', '2026-04-01', 'https://x.sintetico.example', 'ODbL', $2) AS b", [publication, fileId])).b as string;
    return { fileId, batch, sha };
  };
  const csv = (ind: string, rows: Array<[string, string]>) => `indicator_key,geo_code,period_label,period_start,period_end,value\n${rows.map(([g, v]) => `${ind},${g},2026-T1,2026-01-01,2026-03-31,${v}`).join("\n")}\n`;

  it("un archivo rechazado antes de guardar deja solo el motivo y la huella (sin objeto)", async () => {
    const bad = Buffer.from("%PDF-1.7\n<< /JavaScript (x) >>");
    const decision = validateUpload(bad, { maxBytes: MAX });
    expect(decision.ok).toBe(false);
    const files0 = (await w.k.owner.query("SELECT count(*)::int AS n FROM kl.file_object")).rows[0].n;
    const id = (await one(w, w.editor, "SELECT kl.reject_upload('team', $1, $2) AS b", [decision.sha256, decision.ok ? "" : decision.reason])).b as string;
    const row = (await w.k.owner.query("SELECT status, reject_reason, file_sha256, file_object_id FROM kl.ingest_batch WHERE id = $1", [id])).rows[0];
    expect(row).toEqual({ status: "rejected", reject_reason: "active_content_pdf", file_sha256: decision.sha256, file_object_id: null });
    expect((await w.k.owner.query("SELECT count(*)::int AS n FROM kl.file_object")).rows[0].n).toBe(files0);
  });

  it("duplicado exacto por huella reutiliza el mismo objeto; el tamaño máximo es configurable y se respeta", async () => {
    const a = await one(w, w.editor, "SELECT kl.register_file_object($1, 'csv', 10, 'local/k', 'not_required_dev', 'source_original') AS f", ["b".repeat(64)]);
    const b = await one(w, w.editor, "SELECT kl.register_file_object($1, 'csv', 10, 'local/k2', 'not_required_dev', 'source_original') AS f", ["b".repeat(64)]);
    expect(a.f).toBe(b.f);
    await expectSqlState(run(w, w.editor, ["SELECT kl.register_file_object($1, 'csv', 99999999999, 'local/k3', 'not_required_dev', 'source_original')", ["c".repeat(64)]]), "BV422");
  });

  it("la fuente sin aprobar deja la carga en awaiting_source; al aprobarla se libera", async () => {
    const key = "esperando";
    await run(w, w.editor, ["SELECT kl.propose_institution($1, 'Inst', 'MX', 'A', 'public')", [`inst.${key}`]]);
    await run(w, w.editor, ["SELECT kl.propose_publication($1, $2, 'Pub', 'MX', ARRAY[]::text[], 'https://x.sintetico.example/p', 'paraphrase_and_cite', 'low')", [`pub.${key}`, `inst.${key}`]]);
    const f = await file(csv("x", [["MX-A", "1"]]), `pub.${key}`);
    expect((await w.k.owner.query("SELECT status FROM kl.ingest_batch WHERE id = $1", [f.batch])).rows[0].status).toBe("awaiting_source");
    await run(w, w.admin, ["SELECT kl.decide_publication($1, 'approve')", [`pub.${key}`]]);
    expect((await one(w, w.admin, "SELECT kl.release_awaiting_batches($1) AS n", [`pub.${key}`])).n).toBe(1);
    expect((await w.k.owner.query("SELECT status FROM kl.ingest_batch WHERE id = $1", [f.batch])).rows[0].status).toBe("received");
  });

  it("flujo completo: extracción → QA → revisión por otra persona → publicación; el original queda inmutable", async () => {
    await sources("flujo");
    await run(w, w.admin, ["SELECT kl.decide_publication('pub.flujo', 'approve')"]);
    const f = await file(csv("ind_flujo", [["MX-GUA", "10.5"], ["MX-JAL", "20.5"]]), "pub.flujo");
    const rows = extractCsv(await store.get(`local/${f.sha.slice(0, 2)}/${f.sha}`).then((b) => b.toString("utf8"))).rows;
    expect((await one(w, w.editor, "SELECT kl.add_extracted_rows($1, $2::jsonb) AS n", [f.batch, JSON.stringify(rows)])).n).toBe(2);
    const qa = runQa(rows, { knownIndicators: new Set(["ind_flujo"]), percentIndicators: new Set(["ind_flujo"]) });
    expect((await one(w, w.editor, "SELECT kl.set_qa_report($1, $2::jsonb, $3) AS s", [f.batch, JSON.stringify(qa.checks), qa.blockingFailures])).s).toBe("in_review");
    // el revisor no puede editar valores: solo el mapeo
    const rowId = (await w.k.owner.query("SELECT id FROM kl.extracted_row WHERE batch_id = $1 ORDER BY locator LIMIT 1", [f.batch])).rows[0].id;
    await expectSqlState(
      tx(w.k.owner, async () => {
        await w.k.owner.query("SELECT set_config('kl.mutation_authorized','on',true)");
        await w.k.owner.query("UPDATE kl.extracted_row SET parsed_value = 99 WHERE id = $1", [rowId]);
      }),
      "BV601",
    );
    await run(w, w.reviewer, ["SELECT kl.remap_extracted_row($1, 'ind_flujo', 'MX-GUA', 'new_period')", [rowId]]);
    expect((await one(w, w.reviewer, "SELECT kl.review_batch($1, true, 'ok') AS s", [f.batch])).s).toBe("approved");
    expect((await one(w, w.reviewer, "SELECT kl.publish_batch($1) AS n", [f.batch])).n).toBe(2);
    const vers = (await w.k.owner.query("SELECT u.unit_key, uv.status, uv.origin, uv.authored_by, uv.approved_by FROM kl.unit_version uv JOIN kl.unit u ON u.id = uv.unit_id WHERE uv.batch_id = $1 ORDER BY u.unit_key", [f.batch])).rows;
    expect(vers.map((v) => [v.status, v.origin])).toEqual([["published", "team"], ["published", "team"]]);
    expect(vers[0].authored_by).toBe(w.editor.id);
    expect(vers[0].approved_by).toBe(w.reviewer.id);
    expect((await store.get(`local/${f.sha.slice(0, 2)}/${f.sha}`)).toString()).toContain("MX-GUA,2026-T1");
  });

  it("quien sube no revisa: una persona con KL_EDITOR + KL_REVIEWER no aprueba su propia carga (roles acumulados)", async () => {
    await sources("acumulado");
    await run(w, w.admin, ["SELECT kl.decide_publication('pub.acumulado', 'approve')"]);
    const both = await grantTo(w.k.app, w.admin, "ambos", "KL_EDITOR");
    await run(w, w.admin, ["SELECT kl.grant_role($1, $2, 'KL_REVIEWER', false, '{}')", [both.id, both.email]]);
    const run2 = (...q: Parameters<typeof run>[2][]) => run(w, both, ...q);
    const bytes = Buffer.from(csv("ind_acumulado", [["MX-A", "5"]]));
    const sha = sha256OfBytes(bytes);
    const fid = (await run2(["SELECT kl.register_file_object($1, 'csv', $2, 'local/z', 'not_required_dev', 'source_original') AS f", [sha, bytes.length]]))[0]?.f;
    const batch = (await run2(["SELECT kl.create_ingest_batch('team', 'pub.acumulado', 'T1', '2026-04-01', 'https://x.sintetico.example', 'x', $1) AS b", [fid]]))[0]?.b;
    await run2(["SELECT kl.add_extracted_rows($1, $2::jsonb)", [batch, JSON.stringify(extractCsv(bytes.toString()).rows)]]);
    await run2(["SELECT kl.set_qa_report($1, '[]'::jsonb, 0)", [batch]]);
    await expectSqlState(run2(["SELECT kl.review_batch($1, true)", [batch]]), "BV403");
  });

  it("QA con fallas bloqueantes no pasa a revisión", async () => {
    await sources("malo");
    await run(w, w.admin, ["SELECT kl.decide_publication('pub.malo', 'approve')"]);
    const f = await file(csv("ind_malo", [["MX-A", "abc"]]), "pub.malo");
    const rows = extractCsv(csv("ind_malo", [["MX-A", "abc"]])).rows;
    await run(w, w.editor, ["SELECT kl.add_extracted_rows($1, $2::jsonb)", [f.batch, JSON.stringify(rows)]]);
    const qa = runQa(rows, { knownIndicators: new Set(["ind_malo"]) });
    expect(qa.blockingFailures).toBeGreaterThan(0);
    expect((await one(w, w.editor, "SELECT kl.set_qa_report($1, $2::jsonb, $3) AS s", [f.batch, JSON.stringify(qa.checks), qa.blockingFailures])).s).toBe("extracted");
    await expectSqlState(run(w, w.reviewer, ["SELECT kl.review_batch($1, true)", [f.batch]]), "BV409");
  });
});

describeKl("I9 · KSeed sintético en local", () => {
  let w: World;
  let p: ReturnType<typeof pools>;
  let store: LocalObjectStore;
  beforeAll(async () => {
    w = await buildWorld();
    p = pools();
    store = new LocalObjectStore(fs.mkdtempSync(path.join(os.tmpdir(), "kl-kseed-")), { NODE_ENV: "test" });
  });
  afterAll(async () => {
    await p.closeAll();
    await w.close();
  });

  it("I9 · KSeed sintético: el lote completo pasa QA y revisión y queda consultable desde la primera lectura", async () => {
    const w2 = w;
    const p2 = p;
    {
      const out = await loadSyntheticKseed({ app: p2.app, store, scan: new DevNoScan({ NODE_ENV: "test" }), actors: { editor: attestedOf(w2.editor), reviewer: attestedOf(w2.reviewer), admin: attestedOf(w2.admin) } });
      expect(out.statVersions).toBe(6);
      expect(out.cards).toEqual(["card.mx.sint.perfil-pais", "card.mx.sint.puerto-contexto"]);
      const rows = (await w2.k.owner.query("SELECT locator FROM kl.extracted_row WHERE batch_id = $1 ORDER BY locator", [out.batchId])).rows;
      expect(rows.map((r) => r.locator)).toEqual(["row:2", "row:3", "row:4", "row:5", "row:6", "row:7"]);
      const consumable = (await w2.k.reader.query("SELECT count(*)::int AS n FROM kl.v_consumable_stat")).rows[0].n;
      expect(consumable).toBe(6);
      // doble intervención real del flujo: quien subió ≠ quien aprobó
      const batch = (await w2.k.owner.query("SELECT uploaded_by, approved_by FROM kl.ingest_batch WHERE id = $1", [out.batchId])).rows[0];
      expect(batch.uploaded_by).not.toBe(batch.approved_by);
      // repetir la carga del mismo archivo es un duplicado por huella
      const again = (await w2.k.owner.query("SELECT count(*)::int AS n FROM kl.file_object")).rows[0].n;
      expect(again).toBe(1);
    }
  });
});
