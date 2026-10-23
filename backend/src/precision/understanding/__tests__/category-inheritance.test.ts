import { bundledCategoryManifest } from "../../manifest/bundled";
import { deriveInherited } from "../category-inheritance";
import { categoryUnderstanding } from "../category-readiness";
import { runPersona, type Persona } from "./harness";
import type { DiscoverySeedInput } from "../seed";

const NARRATIVE =
  "Somos una empresa portuguesa. Fuimos subcontratados por las empresas ganadoras de proyectos del sector energético en México y vamos a estar operando allá durante unos 2 a 3 años. Instalaremos parte del equipo de los proyectos. Necesitamos constituir una entidad local, apoyo legal, fiscal, laboral, contratar gente, algunos directamente y otros por medio de un tercero, seguridad social, contabilidad y cumplimiento fiscal. La casa matriz en Portugal va a financiar la operación en México y habrá operaciones intercompañía.";
const SEED: DiscoverySeedInput = {
  locale: "es", destinationCodes: ["MX"], sector: "Energía", objective: "Establecer operaciones en México para apoyar proyectos del sector energético",
  operatingCountries: ["PT"], needs: [{ capabilityId: "company_incorporation_corporate_setup", label: "Constitución de la entidad", priority: "high" }],
};
const PERSONA: Persona = {
  opening: NARRATIVE,
  answers: {
    "entity.form": "Todavía no lo hemos decidido, queremos que nos asesoren.", "entity.funding_structure": "Sería un préstamo, aunque no está definido del todo.",
    "workforce.headcount": "Unas 60 personas en total.", "workforce.split": "Unas 20 directas y 40 subcontratadas.",
    "workforce.benefits": "Además del mínimo de ley queremos seguro de gastos médicos y vales de despensa.", "scale.revenue": "Calculamos unos 3 millones de dólares al año.",
    "scale.volume": "Unas 150 facturas al mes.", "scale.suppliers": "Unos 25 proveedores locales.", "scale.inventory": "No, no manejaremos inventario.",
    "tax.intercompany": "Servicios de gestión de la matriz y venta de equipo a la filial.",
  },
  priority: "Primero la entidad local y la contratación, porque queremos arrancar en enero. Lo fiscal puede esperar.", implied: "yes",
};

const fieldsOf = (key: string) => new Map(bundledCategoryManifest(key)!.fields.map((f) => [f.field_key, f]));

describe("category inheritance — the category deepens the project, it does not restart it", () => {
  const run = runPersona("es", SEED, PERSONA);
  const frame = run.conv.frame;

  it("the Portuguese frame carries into the manifest fields it answers exactly", () => {
    const hr = deriveInherited(frame, "people_payroll_employment", fieldsOf("people_payroll_employment") as never);
    const byKey = Object.fromEntries(hr.map((f) => [f.fieldKey, f]));
    // 20 direct + 40 through a third party, in Mexico: known, so the category does not ask the headcount again
    expect(byKey.hr_employee_population_breakdown?.value).toEqual([{ headcount: 20, country: ["MX"] }, { headcount: 40, country: ["MX"] }]);
    // "mixed / through a third party" does NOT say employer of record vs staffing vs contractors: that stays open (depth)
    expect(byKey.hr_employment_model).toBeUndefined();

    const tax = deriveInherited(frame, "tax_accounting_audit", fieldsOf("tax_accounting_audit") as never);
    const t = Object.fromEntries(tax.map((f) => [f.fieldKey, f]));
    expect(t.tax_has_intercompany_transactions?.value).toBe(true);
    expect(t.tax_intercompany_transactions?.value).toEqual(expect.arrayContaining([{ transaction_type: "services", counterparty_country: ["PT"] }, { transaction_type: "goods", counterparty_country: ["PT"] }]));

    const legal = deriveInherited(frame, "corporate_legal_admin", fieldsOf("corporate_legal_admin") as never);
    const l = Object.fromEntries(legal.map((f) => [f.fieldKey, f]));
    expect(l.legal_entity_stage?.value).toBe("evaluating_options"); // the entity form is open: the specialist helps decide

    const customs = deriveInherited(frame, "international_trade_customs", fieldsOf("international_trade_customs") as never);
    expect(customs.find((f) => f.fieldKey === "customs_related_party_transactions")?.value).toBe(true); // equipment sold to the subsidiary
  });

  it("only what the client said is inherited, with its provenance (never an AI proposal)", () => {
    for (const k of ["corporate_legal_admin", "people_payroll_employment", "tax_accounting_audit", "international_trade_customs"]) {
      for (const f of deriveInherited(frame, k, fieldsOf(k) as never)) expect(["client_answered", "client_confirmed", "client_corrected"]).toContain(f.provenance);
    }
    const proposed = JSON.parse(JSON.stringify(frame)) as typeof frame;
    proposed.items["workforce.model"] = { ...proposed.items["workforce.model"]!, value: "direct", status: "proposed", provenance: "ai_understood" };
    expect(deriveInherited(proposed, "people_payroll_employment", fieldsOf("people_payroll_employment") as never).find((f) => f.fieldKey === "hr_employment_model")).toBeUndefined();
  });

  it("direct hiring is exactly a local entity employment model; an open decision stays open", () => {
    const f1 = JSON.parse(JSON.stringify(frame)) as typeof frame;
    f1.items["workforce.model"] = { ...f1.items["workforce.model"]!, value: "direct" };
    expect(deriveInherited(f1, "people_payroll_employment", fieldsOf("people_payroll_employment") as never).find((f) => f.fieldKey === "hr_employment_model")?.value).toBe("direct_entity");
    const f2 = JSON.parse(JSON.stringify(frame)) as typeof frame;
    f2.items["workforce.model"] = { ...f2.items["workforce.model"]!, value: null, status: "undecided" };
    expect(deriveInherited(f2, "people_payroll_employment", fieldsOf("people_payroll_employment") as never).find((f) => f.fieldKey === "hr_employment_model")?.value).toBe("undecided");
  });

  it("the client's 'I do not know' travels as honest knowledge, not as a gap to ask again", () => {
    const f = JSON.parse(JSON.stringify(frame)) as typeof frame;
    f.items["entity.form"] = { ...f.items["entity.form"]!, value: null, status: "unknown" };
    const legal = deriveInherited(f, "corporate_legal_admin", fieldsOf("corporate_legal_admin") as never);
    expect(legal.find((x) => x.fieldKey === "legal_entity_stage")).toMatchObject({ answerState: "UNKNOWN", value: null });
  });

  it("is deterministic: the same frame derives the same facts", () => {
    const a = deriveInherited(frame, "tax_accounting_audit", fieldsOf("tax_accounting_audit") as never);
    const b = deriveInherited(JSON.parse(JSON.stringify(frame)), "tax_accounting_audit", fieldsOf("tax_accounting_audit") as never);
    expect(b).toEqual(a);
  });

  it("category readiness: an aspect the category asks closes when the client answers it there", () => {
    const f = JSON.parse(JSON.stringify(frame)) as typeof frame;
    delete f.items["tax.intercompany"];
    const fields = new Set(bundledCategoryManifest("tax_accounting_audit")!.fields.map((x) => x.field_key));
    const open = categoryUnderstanding(f, "tax_accounting_audit", {}, fields);
    expect(open.asking).toContain("tax.intercompany");
    expect(open.ready).toBe(false);
    const answered = categoryUnderstanding(f, "tax_accounting_audit", { tax_has_intercompany_transactions: { value: true, answerState: "ANSWERED" } }, fields);
    expect(answered.asking).not.toContain("tax.intercompany");
  });
});

describe("category inheritance across the acceptance corpus — only what each project established, nothing more", () => {
  const inheritedBy = (frame: ReturnType<typeof runPersona>["conv"]["frame"], categories: string[]): Record<string, string[]> =>
    Object.fromEntries(categories.map((k) => [k, deriveInherited(frame, k, fieldsOf(k) as never).map((f) => f.fieldKey)]));
  const ALL = ["corporate_legal_admin", "people_payroll_employment", "tax_accounting_audit", "logistics", "international_trade_customs"];

  it("a small office with five direct hires: the employment model and headcount carry over; nothing about groups or taxes is invented", () => {
    const seed: DiscoverySeedInput = { locale: "es", destinationCodes: ["MX"], sector: "Software", objective: "Abrir una oficina en Querétaro", needs: [{ capabilityId: "office_search", label: "Oficina" }] };
    const run = runPersona("es", seed, { opening: "Queremos una oficina en Querétaro y contratar a 5 personas nosotros mismos, contratación directa.", answers: { "workforce.benefits": "Solo las prestaciones de ley.", "workforce.origin": "Todo el personal sería contratado localmente." }, priority: "Lo más importante es la oficina." });
    const frame = run.conv.frame;
    const hr = deriveInherited(frame, "people_payroll_employment", fieldsOf("people_payroll_employment") as never);
    expect(hr.find((f) => f.fieldKey === "hr_employment_model")?.value).toBe("direct_entity");
    expect(hr.find((f) => f.fieldKey === "hr_employee_population_breakdown")?.value).toEqual([{ headcount: 5, country: ["MX"] }]);
    const by = inheritedBy(frame, ALL);
    expect(by.tax_accounting_audit).not.toContain("tax_has_intercompany_transactions");
    expect(by.international_trade_customs).toEqual([]);
  });

  it("a coffee exporter has no payroll or entity facts to inherit", () => {
    const seed: DiscoverySeedInput = {
      locale: "es", destinationCodes: ["MX", "US"], sector: "Alimentos y bebidas", operatingCountries: ["CO"],
      objective: "Queremos exportar café de Colombia a México y luego a Estados Unidos, con cadena de frío.",
      needs: [{ capabilityId: "customs_advisory", label: "Asesoría aduanera y de comercio exterior" }, { capabilityId: "freight_transportation", label: "Transporte de carga" }],
    };
    const run = runPersona("es", seed, { opening: "Sí, es café verde de exportación, tostado después en destino.", answers: { "trade.volume": "Unos 20 contenedores al mes.", "trade.temperature": "Entre 2 y 8 °C.", "project.why": "Porque tenemos compradores en ambos mercados.", "project.phases": "Primero México y luego Estados Unidos." }, priority: "Primero la aduana y el transporte, porque ya tenemos el primer embarque.", implied: "yes" });
    const by = inheritedBy(run.conv.frame, ALL);
    expect(by.people_payroll_employment).toEqual([]);
    expect(by.corporate_legal_admin).toEqual([]);
    expect(by.tax_accounting_audit).toEqual([]);
  });

  it("the Portuguese case, by category: every inherited field exists in that category's manifest and carries a client-origin provenance", () => {
    for (const k of ALL) {
      const names = new Set(bundledCategoryManifest(k)!.fields.map((f) => f.field_key));
      for (const f of deriveInherited(frame0(), k, fieldsOf(k) as never)) {
        expect(names.has(f.fieldKey)).toBe(true);
        expect(["client_answered", "client_confirmed", "client_corrected"]).toContain(f.provenance);
      }
    }
  });
});

function frame0() { return runPersona("es", SEED, PERSONA).conv.frame; }
