/**
 * Conformity / evaluation suite — gates P (conversational quality) and Q (depth / sufficiency) applied to EVERY acceptance case,
 * plus the cross-cutting behaviour: PRECISION KNOWS AND USES WHAT DISCOVERY ALREADY KNOWS (behaviour, not representation).
 */
import { Conv, runPersona, NOW, type Persona } from "./harness";
import { conversationQuality, depthReport, sufficiencyIssues } from "../evaluation";
import { seedFromDiscovery, type DiscoverySeedInput } from "../seed";

interface Case { name: string; seed: DiscoverySeedInput; persona: Persona; mustComplete: boolean; deeper: boolean }

const PT_NARR = "Somos una empresa portuguesa. Fuimos subcontratados por las empresas ganadoras de proyectos del sector energético en México y vamos a estar operando allá durante unos 2 a 3 años. Instalaremos parte del equipo de los proyectos. Necesitamos constituir una entidad local, apoyo legal, fiscal, laboral, contratar gente, algunos directamente y otros por medio de un tercero, seguridad social, contabilidad y cumplimiento fiscal. La casa matriz en Portugal va a financiar la operación en México y habrá operaciones intercompañía.";

const CASES: Case[] = [
  {
    name: "Portuguese company subcontracted in Mexico's energy sector (mandatory reference)",
    seed: { locale: "es", destinationCodes: ["MX"], sector: "Energía", objective: "Establecer operaciones en México para apoyar proyectos del sector energético", operatingCountries: ["PT"], needs: [{ capabilityId: "company_incorporation_corporate_setup", label: "Constitución de la entidad", priority: "high" }] },
    persona: {
      opening: PT_NARR,
      answers: { "entity.form": "Todavía no lo hemos decidido, queremos que nos asesoren.", "entity.funding_structure": "Sería un préstamo, aunque no está definido del todo.", "workforce.headcount": "Unas 60 personas en total.", "workforce.split": "Unas 20 directas y 40 subcontratadas.", "workforce.benefits": "Además del mínimo de ley queremos seguro de gastos médicos y vales de despensa.", "scale.revenue": "Calculamos unos 3 millones de dólares al año.", "scale.volume": "Unas 150 facturas al mes.", "scale.suppliers": "Unos 25 proveedores locales.", "scale.inventory": "No, no manejaremos inventario.", "tax.intercompany": "Servicios de gestión de la matriz y venta de equipo a la filial." },
      priority: "Primero la entidad local y la contratación, porque queremos arrancar en enero. Lo fiscal puede esperar.", implied: "yes",
    },
    mustComplete: true, deeper: true,
  },
  {
    name: "coffee, Colombia -> Mexico -> US",
    seed: { locale: "es", destinationCodes: ["MX", "US"], sector: "Alimentos y bebidas", operatingCountries: ["CO"], objective: "Queremos exportar café de Colombia a México y luego a Estados Unidos, con cadena de frío.", needs: [{ capabilityId: "customs_advisory", label: "Asesoría aduanera y de comercio exterior" }, { capabilityId: "freight_transportation", label: "Transporte de carga" }] },
    persona: { opening: "Sí, es café verde de exportación, tostado después en destino.", answers: { "trade.volume": "Unos 20 contenedores al mes.", "trade.temperature": "Entre 2 y 8 °C.", "project.why": "Porque tenemos compradores en ambos mercados.", "project.phases": "Primero México y luego Estados Unidos." }, priority: "Primero la aduana y el transporte, porque ya tenemos el primer embarque.", implied: "yes" },
    mustComplete: true, deeper: true,
  },
  {
    name: "simple single-country project",
    seed: { locale: "es", destinationCodes: ["MX"], sector: "Software", objective: "Abrir una oficina en Querétaro", needs: [{ capabilityId: "office_search", label: "Oficina" }] },
    persona: { opening: "Queremos una oficina en Querétaro y contratar a 5 personas nosotros mismos, contratación directa.", answers: { "workforce.benefits": "Solo las prestaciones de ley.", "workforce.origin": "Todo el personal sería contratado localmente." }, priority: "Lo más importante es la oficina." },
    mustComplete: true, deeper: true,
  },
  {
    name: "rich Discovery",
    seed: { locale: "es", destinationCodes: ["MX"], sector: "Energía", operatingCountries: ["PT"], objective: "Establecer operaciones en México", literals: { motive: "Fuimos subcontratados por ganadores de proyectos y operaremos durante 3 años.", context: "La casa matriz en Portugal va a financiar la operación en México. Contrataremos directamente a 40 personas." }, needs: [{ capabilityId: "company_incorporation_corporate_setup", label: "Constitución de la entidad" }, { capabilityId: "payroll_processing", label: "Nómina" }] },
    persona: { opening: "Correcto, eso es lo que queremos.", answers: { "entity.form": "Una S.A. de C.V.", "scale.revenue": "Unos 2 millones de dólares al año.", "scale.volume": "100 facturas al mes.", "scale.suppliers": "10 proveedores.", "scale.inventory": "No tendremos inventario.", "workforce.benefits": "Solo el mínimo de ley." } },
    mustComplete: false, deeper: true,
  },
  {
    name: "sparse Discovery",
    seed: { locale: "es", destinationCodes: ["MX"], sector: "Manufactura", objective: "Expandirnos a México", needs: [] },
    persona: { opening: "Necesitamos constituir una entidad y contratar a 10 personas directamente.", answers: { "entity.form": "Una S.A. de C.V.", "workforce.benefits": "Solo lo de ley.", "workforce.origin": "Contratación local." }, priority: "Primero la entidad." },
    mustComplete: false, deeper: true,
  },
];

describe.each(CASES)("gates P and Q — $name", (c) => {
  const run = runPersona("es", c.seed, c.persona);

  it("P: every assistant text passes the voice verifiers and the conversation shows no repetition", () => {
    expect(run.conv.critical()).toEqual([]);
    expect(conversationQuality(run.conv.transcript)).toEqual([]);
  });

  it("Behaviour: it never asks what Discovery already knows (unless the client contradicts it)", () => {
    const known = Object.values(seedFromDiscovery(c.seed, NOW).frame.items).filter((i) => i.status === "known").map((i) => i.key);
    const contradicted = new Set(run.conv.frame.changedSinceDiscovery.map((x) => x.key));
    for (const k of run.conv.asked()) if (!contradicted.has(k)) expect(known).not.toContain(k);
    expect(run.conv.transcript.filter((t) => t.askedProbeResolved)).toEqual([]);
  });

  it("Q: ready means the material aspects of THIS project are understood — and nothing else", () => {
    const r = depthReport(run.conv.frame, NOW);
    expect(sufficiencyIssues(r)).toEqual([]);
    if (c.mustComplete) { expect(run.completed).toBe(true); expect(r.openMaterial).toEqual([]); }
    if (run.completed) expect(r.ready).toBe(true);
  });

  it("Q: the final representation is deeper than Discovery", () => {
    const r = depthReport(run.conv.frame, NOW);
    if (c.deeper) expect(r.beyondDiscovery.facts + r.beyondDiscovery.findings).toBeGreaterThan(0);
  });
});

describe("gates catch what they must", () => {
  it("P flags a repeated question, a re-asked known fact, a repeated opening and an overlong text", () => {
    const q = "¿Cuántas personas contratarán?";
    const issues = conversationQuality([
      { bot: `Entendido. ${q}`, askedProbe: "workforce.headcount", askedProbeResolved: false },
      { bot: `Entendido. ${q}`, askedProbe: "workforce.headcount", askedProbeResolved: false },
      { bot: `Entendido. ${q}`, askedProbe: "workforce.headcount", askedProbeResolved: true },
      { bot: "x".repeat(1500), askedProbe: null, askedProbeResolved: false },
    ]);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(["repeated_question", "reasked_known", "repeated_opening", "too_long"]));
  });
  it("Q flags ready-with-open-material and not-ready-without-reason", () => {
    const base = { applicableMaterial: 3, resolvedMaterial: 1, openMaterial: ["scale.revenue"], forSpecialist: [], needs: { active: 1, unresolved: 0 }, priority: "not_needed" as const, beyondDiscovery: { facts: 1, findings: 0 }, ready: true, blockers: [] };
    expect(sufficiencyIssues(base)).toContain("ready_with_open_material");
    expect(sufficiencyIssues({ ...base, openMaterial: [], ready: false, blockers: [] })).toContain("not_ready_without_reason");
  });
  it("an ambiguous early-stage client never reaches 'ready'", () => {
    const c = new Conv("es", { locale: "es", destinationCodes: ["MX"], sector: "Alimentos", objective: "Explorar México", needs: [] });
    for (const a of ["No sé bien qué necesito.", "Todavía no tengo claro nada.", "No sé."]) c.say(a);
    const r = depthReport(c.frame, NOW);
    expect(r.ready).toBe(false);
    expect(sufficiencyIssues(r)).toEqual([]);
  });
});
