import { bundledCategoryManifest, bundledCategoryManifests, type CategoryManifestDoc } from "../bundled";
import { categoryInfo, listCategoryKeys } from "../categories";
import { buildCrpContent, type CrpV1Content } from "../crp-content";
import { lintCopy } from "../copy-lint";
import type { FieldDefinition } from "../effective-fields";
import { evaluateCategoryDetailed } from "../readiness";
import { hasValueLabel, renderFieldValue, valueLabel, type Locale } from "../value-render";
import { drive } from "./driver";
import { A, ALL_KEYS, DEMO_KEYS, load } from "./helpers";

const LOCALES: Locale[] = ["en", "es"];

/** Every string a client may display (structural ids, schema, state and flags excluded). */
function rendered(c: CrpV1Content): string[] {
  const out: string[] = [c.title, ...c.context, ...c.requiredLater];
  const item = (i: CrpV1Content["pending"][number]): void => {
    out.push(i.label);
    if (i.value) out.push(i.value);
    out.push(...(i.entries ?? []), ...(i.missing ?? []));
  };
  for (const s of c.sections) {
    out.push(s.title);
    s.items.forEach(item);
  }
  c.pending.forEach(item);
  return out;
}

// Contract §0 "never show" list, as whole-token tests (case-sensitive for acronyms).
const FORBIDDEN: Array<[string, RegExp]> = [
  ["MOCK", /\bMOCK\b/i], ["STUB", /\bSTUB\b/i], ["SIMULATOR", /\bSIMULAT(OR|ED)\b/i], ["SANDBOX", /\bSANDBOX\b/i],
  ["BV409", /\bBV\d{3}\b/], ["JSON", /json/i], ["new:", /new:/i], ["_generic", /_generic/], ["CONTEXT_ONLY", /CONTEXT_ONLY/],
  ["PSM/MSM/OH/PbyC/PA/FA", /\b(PSM|MSM|OH|PbyC|PA|FA)\b/], ["reopen", /reopen|reabrir/i], ["Discovery", /\bdiscovery\b/i],
  ["Out of Scope", /out of scope|fuera de alcance/i], ["Unmapped", /unmapped/i], ["Sherpa", /sherpa/i], ["listo/lista", /\blist[oa]s?\b/i],
  ["provider names", /clickup|stripe/i], ["exclamation", /[!¡]/], ["braces/brackets", /[{}[\]]/], ["snake_case token", /[a-z]+_[a-z]+/],
  ["CAP_ id", /\bCAP_/], ["version number", /\bv\d+\.\d+/i],
];
// Registered exact exceptions (noun uses, not a quality judgment): "lista de empaque" = packing list (ITC operational item).
const EXCEPTIONS = [/lista de empaque/gi];
function assertClean(strings: string[], where: string): void {
  for (const raw of strings) {
    const s = EXCEPTIONS.reduce((acc, re) => acc.replace(re, "x"), raw);
    for (const [name, re] of FORBIDDEN) if (re.test(s)) throw new Error(`${where}: forbidden "${name}" in "${raw}"`);
  }
}

const allFields = (m: CategoryManifestDoc): FieldDefinition[] => {
  const out: FieldDefinition[] = [];
  const visit = (f: FieldDefinition): void => {
    out.push(f);
    (f.group_item_schema ?? []).forEach(visit);
  };
  m.fields.forEach(visit);
  for (const o of Object.values(m.country_overlays)) (o.add ?? []).forEach(visit);
  return out;
};

describe("crp.v1 content", () => {
  it("every field of the four demo categories has an EN and an ES label (no keys as labels)", () => {
    for (const key of DEMO_KEYS) {
      for (const f of allFields(load(key))) {
        for (const l of LOCALES) {
          const text = f.label?.[l];
          expect(typeof text === "string" && text.trim().length > 0).toBe(true);
          expect(text).not.toBe(f.field_key);
          expect(text).not.toMatch(/_/);
        }
      }
    }
  });

  it("all authored manifests: every label exists in both languages", () => {
    for (const m of bundledCategoryManifests()) for (const f of allFields(m)) for (const l of LOCALES) expect((f.label?.[l] ?? "").trim()).not.toBe("");
  });

  it("every enum value in every shipped manifest has a drafted label in both languages", () => {
    const missing: string[] = [];
    for (const m of bundledCategoryManifests()) {
      for (const f of allFields(m)) {
        for (const v of f.values ?? []) {
          if (!hasValueLabel(v)) missing.push(`${m.category_key}.${f.field_key}=${v}`);
          for (const l of LOCALES) if (!valueLabel(v, l, f.field_key) || /_/.test(valueLabel(v, l, f.field_key))) missing.push(`${f.field_key}=${v}/${l}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it.each(ALL_KEYS.map((k) => [k]))("%s: complete and partial CRPs contain no JSON, keys, codes or forbidden terms (EN and ES)", (key) => {
    const manifest = load(key);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const countries of [[], ["US"], ["MX", "US"]]) {
        const { facts } = drive(manifest, { seed, countries });
        // a partial state too: drop the last answered fields
        const partial = Object.fromEntries(Object.entries(facts).slice(0, Math.ceil(Object.keys(facts).length / 2)));
        for (const f of [facts, partial]) {
          for (const locale of LOCALES) {
            const crp = buildCrpContent({ categoryKey: key, manifest, facts: f, countries, locale });
            assertClean(rendered(crp), `${key}/${locale}/seed${seed}`);
            expect(crp.schema).toBe("crp.v1");
            expect(JSON.stringify(crp.sections.map((s) => s.title.toLowerCase()))).not.toMatch(/document|documento|attachment|adjunt|upload/);
          }
        }
      }
    }
  });

  it("has no documents section and no upload-like item, even for categories whose manifest mentions evidence", () => {
    for (const key of ALL_KEYS) {
      const m = load(key);
      const { facts } = drive(m, { seed: 7, countries: ["US"] });
      for (const locale of LOCALES) {
        const crp = buildCrpContent({ categoryKey: key, manifest: m, facts, countries: ["US"], locale });
        const titles = crp.sections.map((s) => s.title).join(" | ").toLowerCase();
        expect(titles).not.toMatch(/supporting documents|documentos de apoyo|documents|documentos/);
      }
    }
  });

  it("is deterministic: same facts, manifest and locale give identical content", () => {
    const m = load("logistics");
    const { facts } = drive(m, { seed: 11, countries: ["US"] });
    const a = buildCrpContent({ categoryKey: "logistics", manifest: m, facts, countries: ["US"], locale: "es" });
    const b = buildCrpContent({ categoryKey: "logistics", manifest: load("logistics"), facts, countries: ["US"], locale: "es" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("a complete logistics CRP has no pending items; an empty one lists every applicable required item as pending", () => {
    const m = load("logistics");
    const done = drive(m, { seed: 3, countries: ["US"] });
    const full = buildCrpContent({ categoryKey: "logistics", manifest: m, facts: done.facts, countries: ["US"], locale: "en" });
    expect(full.pending).toEqual([]);
    expect(full.sections.length).toBeGreaterThan(0);
    const empty = buildCrpContent({ categoryKey: "logistics", manifest: m, facts: {}, countries: ["US"], locale: "en" });
    const ev = evaluateCategoryDetailed({ manifest: m, facts: {}, countries: ["US"] });
    expect(empty.pending.map((p) => p.id)).toEqual(ev.evaluation.pending.map((p) => p.fieldKey));
    expect(empty.pending.every((p) => p.state === "pending" && p.value === null)).toBe(true);
  });

  it("renders values for people: enum, multi-enum, booleans, groups, countries, numbers with unit (EN and ES)", () => {
    const m = load("logistics");
    const facts = {
      logistics_services_in_scope: A(["freight_transportation", "warehousing"]),
      logistics_operating_responsibility: A("self_managed"),
      logistics_hazardous_materials_flag: { answerState: "EXPLICIT_NO" as const, value: false },
      logistics_flows: A([{ origin_country: "CN", destination_country: "US", product: "finished electronics", volume: { value: 1500, unit: "containers" }, frequency: "monthly", mode_of_transport: "ocean" }]),
    };
    const en = buildCrpContent({ categoryKey: "logistics", manifest: m, facts, countries: ["US"], locale: "en" });
    const es = buildCrpContent({ categoryKey: "logistics", manifest: m, facts, countries: ["US"], locale: "es" });
    const find = (c: CrpV1Content, id: string) => c.sections.flatMap((s) => s.items).find((i) => i.id === id);
    expect(find(en, "logistics_hazardous_materials_flag")).toMatchObject({ value: "No", state: "confirmed" });
    expect(find(es, "logistics_hazardous_materials_flag")?.value).toBe("No");
    const flowsEn = find(en, "logistics_flows");
    const flowsEs = find(es, "logistics_flows");
    expect(flowsEn?.entries?.[0]).toContain("China");
    expect(flowsEn?.entries?.[0]).toContain("United States");
    expect(flowsEs?.entries?.[0]).toContain("Estados Unidos");
    expect(flowsEn?.entries?.[0]).toContain("1,500");
    expect(flowsEs?.entries?.[0]).toMatch(/1\.?500/);
    expect(find(en, "logistics_services_in_scope")?.value).toMatch(/ and /);
    expect(find(es, "logistics_services_in_scope")?.value).toMatch(/ y /);
    expect(en.context[0]).toBe("Destination: United States");
    expect(es.context[0]).toBe("Destino: Estados Unidos");
  });

  it("marks ASSUMED items as assumed (never confirmed) and unknown answers as pending", () => {
    const m = load("logistics");
    const crp = buildCrpContent({
      categoryKey: "logistics", manifest: m, countries: ["US"], locale: "en",
      facts: { logistics_operating_responsibility: A("self_managed", "ASSUMED"), logistics_primary_product_type: { answerState: "UNKNOWN", value: null } },
    });
    const items = crp.sections.flatMap((s) => s.items);
    expect(items.find((i) => i.id === "logistics_operating_responsibility")?.state).toBe("assumed");
    expect(items.find((i) => i.id === "logistics_primary_product_type")).toMatchObject({ state: "pending", value: null });
  });

  it("repeatable groups list the missing required sub-fields per entry in human words", () => {
    const m = load("logistics");
    const crp = buildCrpContent({
      categoryKey: "logistics", manifest: m, countries: ["US"], locale: "es",
      facts: { logistics_flows: A([{ origin_country: "CN", destination_country: "US", product: "x", frequency: "monthly", mode_of_transport: "ocean" }]) },
    });
    const flows = crp.pending.find((p) => p.id === "logistics_flows");
    expect(flows?.missing).toEqual(["Registro 1: Volumen"]);
    assertClean(rendered(crp), "partial flows");
  });

  it("a new:<slug> instance renders as discovery content with a neutral title and no slug anywhere", () => {
    const m = load("_generic");
    const { facts } = drive(m, { seed: 5, countries: ["MX"] });
    for (const locale of LOCALES) {
      const crp = buildCrpContent({ categoryKey: "new:public_procurement", manifest: m, facts, countries: ["MX"], locale });
      expect(crp.crpKind).toBe("new_category_discovery");
      expect(crp.title).toBe(`${categoryInfo("new:x").label[locale]} — Category Requirement Pack (CRP)`);
      assertClean(rendered(crp), `new/${locale}`);
      expect(JSON.stringify(rendered(crp))).not.toMatch(/public_procurement|procurement/i);
    }
  });

  it("requiredLater shows applicable operational pending items as plain lines, never a section", () => {
    const m = load("logistics");
    const crp = buildCrpContent({ categoryKey: "logistics", manifest: m, facts: {}, countries: ["US"], locale: "en" });
    const ev = evaluateCategoryDetailed({ manifest: m, facts: {}, countries: ["US"] });
    expect(crp.requiredLater.length).toBe(ev.operationalPending.length);
    assertClean(crp.requiredLater, "requiredLater");
    expect(crp.sections.every((s) => !crp.requiredLater.includes(s.title))).toBe(true);
  });

  it("carries the Execution Dependency mark and structural visibility flags, not mode names", () => {
    const m = load("logistics");
    const { facts } = drive(m, { seed: 2, countries: ["US"] });
    const crp = buildCrpContent({ categoryKey: "logistics", manifest: m, facts, countries: ["US"], locale: "en" });
    const items = crp.sections.flatMap((s) => s.items);
    expect(items.some((i) => i.executionDependency)).toBe(true);
    for (const i of items) if (i.visibility) expect(["confidential", "context_only"]).toContain(i.visibility);
  });

  it("section titles are neutral when the manifest declares none", () => {
    const m = load("logistics");
    const { facts } = drive(m, { seed: 2, countries: ["US"] });
    const es = buildCrpContent({ categoryKey: "logistics", manifest: m, facts, countries: ["US"], locale: "es" });
    for (const s of es.sections) expect(s.title).toMatch(/^(Parte \d+|Requisitos)$/);
  });
});

describe("manifest copy", () => {
  it("every authored label (fields, decisions, pending items) passes the voice lint except the registered exception", () => {
    const hits: string[] = [];
    const walk = (o: unknown, path: string): void => {
      if (!o || typeof o !== "object") return;
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if ((k === "en" || k === "es") && typeof v === "string") {
          for (const f of lintCopy(path, v.replace(/lista de empaque/gi, "x"))) hits.push(`${path}.${k} [${f.rule}] ${f.hit}`);
        }
        walk(v, `${path}.${k}`);
      }
    };
    for (const m of bundledCategoryManifests()) walk({ fields: m.fields, ov: m.country_overlays, cd: m.critical_decisions, op: m.operational_pending_items }, m.category_key);
    expect(hits).toEqual([]);
  });
});

describe("category labels", () => {
  it("all 17 catalog categories + SA + ED + to-review have EN/ES labels and descriptions that pass the voice lint", () => {
    const keys = listCategoryKeys();
    expect(keys.length).toBe(19);
    for (const key of [...keys, "new:anything"]) {
      const info = categoryInfo(key);
      for (const l of LOCALES) {
        for (const text of [info.label[l], info.description[l]]) {
          expect(text.trim()).not.toBe("");
          expect(lintCopy(`category_${key}`, text).filter((f) => f.critical)).toEqual([]);
          assertClean([text], `label ${key}/${l}`);
        }
      }
    }
  });
  it("never leaks the slug of a possible new service", () => {
    expect(categoryInfo("new:public_procurement").label.en).not.toMatch(/procurement|new/i);
    expect(categoryInfo("new:public_procurement").kind).toBe("to_review");
  });
});

describe("value rendering", () => {
  it("never renders JSON or raw keys for unexpected values", () => {
    expect(renderFieldValue({ type: "text", field_key: "x" }, { a: 1 }, "en")).toBeNull();
    expect(renderFieldValue({ type: "enum", field_key: "x" }, "some_unknown_value", "en")).toBe("Some unknown value");
    expect(renderFieldValue({ type: "boolean", field_key: "x" }, "yes", "en")).toBeNull();
    expect(renderFieldValue({ type: "date", field_key: "x" }, "2027-03", "en")).toBe("March 2027");
    expect(renderFieldValue({ type: "date", field_key: "x" }, "2027-03", "es")).toMatch(/marzo de 2027|marzo 2027/i);
    expect(renderFieldValue({ type: "money", field_key: "x" }, { amount: 1000, currency: "USD" }, "en")).toBe("$1,000.00");
  });
  it("covers authored manifest categories by name (guard against a renamed bundle)", () => {
    expect(bundledCategoryManifest("logistics")).toBeDefined();
  });
});
