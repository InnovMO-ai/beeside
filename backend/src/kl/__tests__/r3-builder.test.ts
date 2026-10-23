import * as fs from "node:fs";
import * as path from "node:path";
import { GuideBuildError, Snapshot, buildKnowledgeGuide } from "../products/builder";
import { GuideBlock } from "../products/guide-model";
import { newVerificationId, copyFor } from "../products/render/render-edition";
import { editionStamp, normalizePdf } from "../products/render/normalize";
import { COPY } from "../testing/product-world";

import { fixtureSnapshot as snapshot, fixtureSha as sha } from "../testing/fixture-snapshot";
const opts = (locale: "es" | "en" = "es", status: "PREVIEW" | "PUBLISHED" = "PUBLISHED") => ({ locale, copy: COPY[locale], status, ...(status === "PUBLISHED" ? { verificationId: "abcdefghijklmnopqrstuvwxyz" } : {}) });
const blocks = (s: Snapshot, o = opts()) => buildKnowledgeGuide(s, o).pages.flatMap((p) => p.blocks);
const failure = (s: Snapshot, o = opts()): string => {
  try {
    buildKnowledgeGuide(s, o);
  } catch (e) {
    return e instanceof GuideBuildError ? e.code : String(e);
  }
  return "no-error";
};

describe("R3 · el constructor del documento es una función pura y no inventa nada (AC-01, AC-10)", () => {
  it("mismo snapshot ⇒ mismo documento, sin mutar la entrada", () => {
    const s = snapshot();
    const frozen = JSON.stringify(s);
    const a = JSON.stringify(buildKnowledgeGuide(s, opts()));
    const b = JSON.stringify(buildKnowledgeGuide(s, opts()));
    expect(a).toBe(b);
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it("las cifras son el display de la ficha, tal cual, en cada idioma; nada se formatea ni se calcula", () => {
    const es = blocks(snapshot());
    const en = blocks(snapshot(), opts("en"));
    const rows = (bs: GuideBlock[]) => bs.filter((b): b is Extract<GuideBlock, { type: "matrix_table" }> => b.type === "matrix_table").flatMap((b) => b.rows.map((r) => r.cells[1]));
    expect(rows(es)).toEqual(["41,2 %"]);
    expect(rows(en)).toEqual(["41.2%"]);
    const kpi = es.find((b): b is Extract<GuideBlock, { type: "kpi_row" }> => b.type === "kpi_row");
    expect(kpi?.items[0]).toMatchObject({ value: "41,2 %", period: "2026-T1", unitRef: "stat.a@1" });
  });

  it("las afirmaciones llevan claimId «unidad@versión#n»; la obligación cita fuente primaria y fecha de validación sin nombrar al validador", () => {
    const bs = blocks(snapshot());
    const text = bs.find((b): b is Extract<GuideBlock, { type: "labelled_text" }> => b.type === "labelled_text");
    expect(text?.claimIds).toEqual(["card.b@1#1"]);
    expect(text?.paragraphs).toEqual(["Texto uno.", "Texto dos."]);
    const note = bs.filter((b): b is Extract<GuideBlock, { type: "editorial_note" }> => b.type === "editorial_note").map((b) => b.text).join(" | ");
    expect(note).toContain("Instituto · Encuesta");
    expect(note).toContain("1 septiembre 2026");
    expect(note).not.toMatch(/especialista|validador|validator/i);
  });

  it("la fecha de la próxima revisión se genera del ciclo programado y el mes sale de tablas propias (sin Intl)", () => {
    const notes = blocks(snapshot()).find((b): b is Extract<GuideBlock, { type: "publication_notes" }> => b.type === "publication_notes");
    expect(notes?.lines.find((l) => l.label === COPY.es.labels.nextReview)?.text).toBe("15 abril 2027");
    const d = buildKnowledgeGuide(snapshot(), opts("en"));
    expect(d.edition).toMatchObject({ monthLong: "October 2026", dataCutoff: "15 October 2026", label: "V2026.1" });
    const none = snapshot();
    none.edition.nextCycleAt = null;
    expect(blocks(none).find((b): b is Extract<GuideBlock, { type: "publication_notes" }> => b.type === "publication_notes")?.lines.some((l) => l.label === COPY.es.labels.nextReview)).toBe(false);
  });

  it("vista previa: marca visible y plantilla de verificación sin identificador; publicada: sin marca y con el identificador en el enlace", () => {
    const pre = buildKnowledgeGuide(snapshot(), opts("es", "PREVIEW"));
    const pub = buildKnowledgeGuide(snapshot(), opts());
    expect(pre.statusLabel).toBe("VISTA PREVIA · NO DISTRIBUIR");
    expect(pub.statusLabel).toBe("");
    expect(pre.links["kl.links.edition_verify"]?.href).toContain("[edition-id]");
    expect(pub.links["kl.links.edition_verify"]?.href).toBe("https://verify.example/verificar/abcdefghijklmnopqrstuvwxyz");
  });

  describe("falla cerrada", () => {
    it.each([
      ["tema no soportado", (s: Snapshot) => void (s.manifest.theme = "otro"), "theme"],
      ["unidad del manifiesto ausente de la instantánea", (s: Snapshot) => void delete s.units["stat.a@1"], "missing_unit"],
      ["bloque fijo con huella distinta (founder_letter)", (s: Snapshot) => void (s.fixedBlocks[0] = { ...(s.fixedBlocks[0] as Snapshot["fixedBlocks"][number]), sha256: sha("9") }), "fixed_block"],
      ["bloque fijo ausente del manifiesto", (s: Snapshot) => void (s.manifest.fixedBlocks = s.manifest.fixedBlocks.filter((b) => b.blockId !== "founder_letter")), "fixed_block"],
      ["ficha sin texto aprobado en el idioma", (s: Snapshot) => void ((s.units["card.b@1"] as { card: { body: { en: string | null } } }).card.body.en = null), "locale_missing"],
      ["ficha cite_only", (s: Snapshot) => void ((s.units["card.b@1"] as { permittedUse: string }).permittedUse = "cite_only"), "cite_only"],
      ["cifra sin fuente", (s: Snapshot) => void ((s.units["stat.a@1"] as { source: null }).source = null), "no_source"],
      ["cta_link sin enlace configurado", (s: Snapshot) => void delete s.manifest.links["kl.links.discovery_start"], "cta_link"],
    ])("%s", (_label, mutate, code) => {
      const s = snapshot();
      mutate(s);
      expect(failure(s, code === "locale_missing" || code === "cite_only" ? opts("en") : opts())).toBe(code);
    });
    it("falta la copia editorial aprobada", () => {
      const s = snapshot();
      s.fixedBlocks = s.fixedBlocks.filter((b) => b.blockId !== "guide_copy");
      expect(() => copyFor(s, "es")).toThrow(GuideBuildError);
    });
  });
});

describe("R3 · propiedades del código del generador", () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  it("la composición del documento y del HTML no usa reloj, azar, Intl ni red: nada de IA ni de entorno", () => {
    for (const f of ["products/builder.ts", "products/guide-model.ts", "products/render/compose.ts", "products/render/normalize.ts"]) {
      expect({ f, hit: /Date\.now|new Date\(|Math\.random|\bIntl\b|toLocale|process\.env|fetch\(|anthropic|openai/i.test(read(f)) }).toEqual({ f, hit: false });
    }
  });

  it("el identificador de verificación es CSPRNG de 128 bits en base32 sin relleno (26 caracteres) y no se repite", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newVerificationId()));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(/^[a-z2-7]{26}$/);
  });

  it("la normalización fija fechas e identificador sin cambiar la longitud, y rechaza sellos inválidos", () => {
    const pdf = Buffer.from("%PDF-1.4\n<</CreationDate (D:20261017023412+00'00')\n/ModDate (D:20261017023412+00'00')\n/ID [<AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA><BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB>]>>\n%%EOF", "latin1");
    const { pdf: out, report } = normalizePdf(pdf, editionStamp("2026-10-15"), "0123456789abcdef0123456789abcdef");
    expect(out.length).toBe(pdf.length);
    expect(report).toEqual({ creationDate: 1, modDate: 1, id: 1 });
    expect(out.toString("latin1")).toContain("/CreationDate (D:20261015000000+00'00')");
    expect(() => normalizePdf(pdf, "2026", "abc")).toThrow();
  });
});
