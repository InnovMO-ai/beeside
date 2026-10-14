/**
 * MANDATORY reference case (Core Product macroblock): a real, anonymized Portuguese company subcontracted by energy-sector project
 * winners in Mexico. Standard: Precision must reproduce, digitally, the depth of a strong ~40-minute first consulting meeting. If it
 * cannot scope this case, Understanding is NOT feature complete.
 */
import { Conv, runPersona, type Persona } from "./harness";
import type { DiscoverySeedInput } from "../seed";

const NARRATIVE =
  "Somos una empresa portuguesa. Fuimos subcontratados por las empresas ganadoras de proyectos del sector energético en México y vamos a estar operando allá durante unos 2 a 3 años. Instalaremos parte del equipo de los proyectos. Necesitamos constituir una entidad local, apoyo legal, fiscal, laboral, contratar gente, algunos directamente y otros por medio de un tercero, seguridad social, contabilidad y cumplimiento fiscal. La casa matriz en Portugal va a financiar la operación en México y habrá operaciones intercompañía.";

const SPARSE_DISCOVERY: DiscoverySeedInput = {
  locale: "es", destinationCodes: ["MX"], sector: "Energía", objective: "Establecer operaciones en México para apoyar proyectos del sector energético",
  operatingCountries: ["PT"], needs: [{ capabilityId: "company_incorporation_corporate_setup", label: "Constitución de la entidad", priority: "high" }],
};

const PERSONA: Persona = {
  opening: NARRATIVE,
  answers: {
    "entity.form": "Todavía no lo hemos decidido, queremos que nos asesoren.",
    "entity.funding_structure": "Sería un préstamo, aunque no está definido del todo.",
    "workforce.headcount": "Unas 60 personas en total.",
    "workforce.split": "Unas 20 directas y 40 subcontratadas.",
    "workforce.benefits": "Además del mínimo de ley queremos seguro de gastos médicos y vales de despensa.",
    "scale.revenue": "Calculamos unos 3 millones de dólares al año.",
    "scale.volume": "Unas 150 facturas al mes.",
    "scale.suppliers": "Unos 25 proveedores locales.",
    "scale.inventory": "No, no manejaremos inventario.",
    "tax.intercompany": "Servicios de gestión de la matriz y venta de equipo a la filial.",
  },
  priority: "Primero la entidad local y la contratación, porque queremos arrancar en enero. Lo fiscal puede esperar.",
  implied: "yes",
};

describe("Portuguese company — the reference consulting case", () => {
  it("understands the long narrative without manifest order: duration, role, entity, workforce model, funding, intercompany", () => {
    const c = new Conv("es", SPARSE_DISCOVERY);
    c.say(NARRATIVE);
    const f = c.frame;
    expect(f.items["project.duration"]).toMatchObject({ status: "known", value: { minMonths: 24, maxMonths: 36 } });
    expect(f.countries.find((x) => x.code === "PT")?.role).toBe("origin");
    expect(f.countries.some((x) => x.code === "MX" && x.role === "operation")).toBe(true);
    expect(f.items["workforce.model"]?.value).toBe("mixed");
    expect(f.items["entity.funding"]?.value).toMatchObject({ sources: ["parent"] });
    expect(f.items["entity.activity"]?.status).toBe("known");
    expect(f.concepts.subcontracted_project).toBeDefined();
    expect(f.rationale.length).toBeGreaterThan(0);
    for (const id of ["entity_setup", "legal_services", "tax_services", "labor_legal", "hiring", "social_security", "accounting", "tax_compliance", "transfer_pricing", "intercompany_funding", "outsourced_workforce"]) {
      expect(f.needs.some((n) => n.conceptIds.includes(id))).toBe(true);
    }
  });

  it("does not re-ask what the narrative already said, and asks for the sizing a consultant would", () => {
    const c = new Conv("es", SPARSE_DISCOVERY);
    const r = c.say(NARRATIVE);
    // duration, workforce model and funding were stated: none of them is asked
    expect(["project.duration", "workforce.model", "entity.funding"]).not.toContain((r.action as { probeKey?: string }).probeKey);
    const run = runPersona("es", SPARSE_DISCOVERY, PERSONA);
    const asked = run.conv.asked();
    expect(asked).toEqual(expect.arrayContaining(["entity.form", "workforce.headcount", "workforce.split", "workforce.benefits", "scale.revenue", "scale.volume", "scale.suppliers", "scale.inventory", "tax.intercompany"]));
    for (const k of ["project.duration", "workforce.model", "entity.funding"]) expect(asked).not.toContain(k);
    expect(new Set(asked).size).toBe(asked.length); // no probe asked twice when answered
  });

  it("does NOT complete while material sizing information is missing", () => {
    const c = new Conv("es", SPARSE_DISCOVERY);
    c.say(NARRATIVE);
    expect(c.depth.ready).toBe(false);
    expect(c.depth.blockers).toEqual(expect.arrayContaining(["material:workforce.headcount", "material:scale.revenue", "material:scale.volume"]));
  });

  it("completes through a checkpoint, with every material aspect resolved and the client's own priority recorded", () => {
    const run = runPersona("es", SPARSE_DISCOVERY, PERSONA);
    expect(run.completed).toBe(true);
    const f = run.conv.frame;
    expect(f.priority.status).toBe("client_set");
    expect(f.priority.groups.find((g) => g.rank === "top")?.subjects).toEqual(expect.arrayContaining(["entity_setup", "hiring"]));
    expect(f.priority.groups.find((g) => g.rank === "can_wait")?.subjects).toContain("tax_services");
    expect(f.items["workforce.headcount"]?.value).toEqual({ min: 60, max: 60 });
    expect(f.items["workforce.split"]?.value).toMatchObject({ direct: 20, outsourced: 40 });
    expect(f.items["scale.revenue"]?.value).toMatchObject({ min: 3_000_000, currency: "USD", period: "year" });
    expect(f.items["entity.form"]?.status).toBe("undecided");
    expect(f.checkpoint.accepted).toBe(true);
    expect(run.turns).toBeLessThanOrEqual(22); // a ~40-minute meeting, not an interrogation
  });

  it("emerges 'Hallazgos para poner atención' from the conversation, without generic warnings and without professional conclusions", () => {
    const run = runPersona("es", SPARSE_DISCOVERY, PERSONA);
    const ids = run.conv.findings().map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["f:workforce_mixed", "f:direct_employment", "f:parent_funding_tax", "f:intercompany", "f:entity_form_pending", "f:benefits_above_minimum"]));
    for (const f of run.conv.findings()) {
      expect(f.basis.length).toBeGreaterThan(0); // every finding names the facts behind it
      expect(f.detail.es + f.detail.en).not.toMatch(/\b(debe cumplir|es ilegal|es obligatorio|you must|is illegal)\b/i);
    }
    expect(new Set(ids).size).toBe(ids.length); // deterministic ids, no duplicates
  });

  it("every assistant text passes the deterministic verifiers (voice, tone, terminology, one question)", () => {
    const run = runPersona("es", SPARSE_DISCOVERY, PERSONA);
    expect(run.conv.critical()).toEqual([]);
  });

  it("the same case works in English", () => {
    const en: DiscoverySeedInput = { ...SPARSE_DISCOVERY, locale: "en", sector: "Energy", objective: "Set up operations in Mexico to support energy-sector projects" };
    const c = new Conv("en", en);
    c.say("We are a Portuguese company. We were subcontracted by the winners of energy projects in Mexico and we will operate there for about 2 to 3 years. We need to set up a local entity, tax and accounting support and to hire people, some directly and some through a third party. The parent company in Portugal will fund the operation.");
    expect(c.frame.items["project.duration"]?.status).toBe("known");
    expect(c.frame.items["workforce.model"]?.value).toBe("mixed");
    expect(c.frame.items["entity.funding"]?.value).toMatchObject({ sources: ["parent"] });
    expect(c.critical()).toEqual([]);
  });
});
