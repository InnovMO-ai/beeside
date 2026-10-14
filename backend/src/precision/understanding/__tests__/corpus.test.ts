/**
 * Acceptance corpus (Core Product macroblock): simple single-country, Colombia -> Mexico -> US coffee, multi-country services,
 * sparse Discovery, rich Discovery, ambiguous / early-stage. Each case is evaluated on BUSINESS DEPTH, not on field completion:
 * enough information to scope? meaningful questions? why understood? missing decisions recognised? no specialist-advice pretence?
 * the client never repeats what is already known? the final representation materially deeper than Discovery?
 */
import { Conv, runPersona } from "./harness";
import type { DiscoverySeedInput } from "../seed";

const quotesOf = (c: Conv): string[] => c.transcript.map((t) => t.bot);

describe("coffee, Colombia -> Mexico -> US (Discovery already knows the product)", () => {
  const seed: DiscoverySeedInput = {
    locale: "es", destinationCodes: ["MX", "US"], sector: "Alimentos y bebidas", operatingCountries: ["CO"],
    objective: "Queremos exportar café de Colombia a México y luego a Estados Unidos, con cadena de frío.",
    needs: [{ capabilityId: "customs_advisory", label: "Asesoría aduanera y de comercio exterior" }, { capabilityId: "freight_transportation", label: "Transporte de carga" }],
  };

  it("uses what Discovery knows: the product is coffee and Precision never asks what product is being moved", () => {
    const c = new Conv("es", seed);
    expect(c.frame.items["product.what"]).toMatchObject({ status: "known", provenance: "discovery" });
    expect(c.frame.items["product.what"]!.display.toLowerCase()).toContain("café");
    expect(c.frame.countries.find((x) => x.code === "CO")?.role).toBe("origin");
    expect(c.frame.phases.map((p) => p.countries)).toEqual([["MX"], ["US"]]);
    // walk the whole conversation: the product question must never appear
    const run = runPersona("es", seed, { opening: "Sí, es café verde de exportación, tostado después en destino.", answers: { "trade.volume": "Unos 20 contenedores al mes.", "trade.temperature": "Entre 2 y 8 °C.", "project.why": "Porque tenemos compradores en ambos mercados.", "project.phases": "Primero México y luego Estados Unidos." }, priority: "Primero la aduana y el transporte, porque ya tenemos el primer embarque.", implied: "yes" });
    expect(run.conv.asked()).not.toContain("product.what");
    expect(run.conv.transcript.map((t) => t.bot).join(" ")).not.toMatch(/qu[eé] producto/i);
    expect(run.completed).toBe(true);
  });

  it("a contradiction with Discovery is clarified, never silently overwritten", () => {
    const c = new Conv("es", seed);
    const r = c.say("Vamos a mover cacao en grano.");
    expect(c.frame.items["product.what"]!.display.toLowerCase()).toContain("café");
    expect(r.action.kind).toBe("clarify_conflict");
    expect(r.text).toMatch(/Discovery/);
    const r2 = c.say({ quick: "new" });
    expect(c.frame.items["product.what"]!.display.toLowerCase()).toContain("cacao");
    expect(c.frame.items["product.what"]!.provenance).toBe("client_corrected");
    expect(c.frame.changedSinceDiscovery[0]).toMatchObject({ key: "product.what" });
    expect(r2.action.kind).not.toBe("clarify_conflict");
  });

  it("an explicit correction (\"en realidad ...\") is accepted without a confirmation round", () => {
    const c = new Conv("es", seed);
    c.say("En realidad vamos a mover cacao en grano, cambiamos de producto.");
    expect(c.frame.items["product.what"]!.display.toLowerCase()).toContain("cacao");
    expect(c.frame.pendingConflicts).toHaveLength(0);
  });

  it("the cold chain is a property of the logistics need, not a service, and drives the temperature question", () => {
    const c = new Conv("es", seed);
    expect(c.frame.concepts.temperature_control).toBeDefined();
    expect(c.frame.needs.some((n) => n.conceptIds.includes("temperature_control"))).toBe(false);
    const run = runPersona("es", seed, { opening: "Es café verde.", answers: {}, implied: "yes" });
    expect(run.conv.asked()).toContain("trade.temperature");
  });
});

describe("simple single-country project", () => {
  it("a small office + a few hires is scoped in a handful of turns, without enterprise sizing questions", () => {
    const seed: DiscoverySeedInput = { locale: "es", destinationCodes: ["MX"], sector: "Software", objective: "Abrir una oficina en Querétaro", needs: [{ capabilityId: "office_search", label: "Oficina" }] };
    const run = runPersona("es", seed, {
      opening: "Queremos una oficina en Querétaro y contratar a 5 personas nosotros mismos, contratación directa.",
      answers: { "workforce.benefits": "Solo las prestaciones de ley.", "workforce.origin": "Todo el personal sería contratado localmente." },
      priority: "Lo más importante es la oficina.",
    });
    expect(run.completed).toBe(true);
    expect(run.turns).toBeLessThanOrEqual(10);
    expect(run.conv.asked()).not.toEqual(expect.arrayContaining(["trade.volume"]));
    expect(run.conv.asked()).not.toContain("entity.form");
    expect(run.conv.frame.items["workforce.headcount"]?.value).toEqual({ min: 5, max: 5 });
  });
});

describe("multi-country services project", () => {
  it("records the countries with roles, the phases and the reasons, and keeps services needs separate from product questions", () => {
    const seed: DiscoverySeedInput = { locale: "es", destinationCodes: ["MX"], sector: "Consultoría", objective: "Expandir nuestra consultoría desde España hacia México, Colombia y Chile", operatingCountries: ["ES"], needs: [{ capabilityId: "marketing_agency", label: "Marketing" }] };
    const c = new Conv("es", seed);
    c.say("Somos una consultora española. Empezaremos en México y luego iremos a Colombia y Chile, porque nuestros clientes globales nos lo piden. Necesitamos marketing y contratar consultores locales.");
    const codes = c.frame.countries.map((x) => `${x.code}:${x.role}`);
    expect(codes).toEqual(expect.arrayContaining(["ES:origin", "MX:operation"]));
    expect(c.frame.countries.some((x) => x.code === "CO")).toBe(true);
    expect(c.frame.countries.some((x) => x.code === "CL")).toBe(true);
    expect(c.frame.rationale.length).toBeGreaterThan(0);
    expect(c.frame.needs.some((n) => n.categoryKey === "marketing_communications")).toBe(true);
    expect(c.asked()).not.toContain("product.what");
    expect(c.critical()).toEqual([]);
  });
});

describe("sparse Discovery", () => {
  it("elicits the needs instead of pretending Discovery completed the understanding", () => {
    const seed: DiscoverySeedInput = { locale: "es", destinationCodes: ["MX"], sector: "Manufactura", objective: "Expandirnos a México", needs: [] };
    const c = new Conv("es", seed);
    expect(c.opening).toMatch(/necesitas resolver/);
    expect(c.depth.ready).toBe(false);
    expect(c.depth.blockers).toContain("no_needs");
  });
});

describe("rich Discovery", () => {
  it("reads the details already written in Discovery's free text and does not ask for them again", () => {
    const seed: DiscoverySeedInput = {
      locale: "es", destinationCodes: ["MX"], sector: "Energía", operatingCountries: ["PT"], objective: "Establecer operaciones en México",
      literals: { motive: "Fuimos subcontratados por ganadores de proyectos y operaremos durante 3 años.", context: "La casa matriz en Portugal va a financiar la operación en México. Contrataremos directamente a 40 personas." },
      needs: [{ capabilityId: "company_incorporation_corporate_setup", label: "Constitución de la entidad" }, { capabilityId: "payroll_processing", label: "Nómina" }],
    };
    const c = new Conv("es", seed);
    expect(c.frame.items["project.duration"]).toMatchObject({ provenance: "discovery", status: "known" });
    expect(c.frame.items["entity.funding"]).toMatchObject({ provenance: "discovery", status: "known" });
    expect(c.frame.items["workforce.headcount"]?.value).toEqual({ min: 40, max: 40 });
    const run = runPersona("es", seed, { opening: "Correcto, eso es lo que queremos.", answers: { "entity.form": "Una S.A. de C.V.", "scale.revenue": "Unos 2 millones de dólares al año.", "scale.volume": "100 facturas al mes.", "scale.suppliers": "10 proveedores.", "scale.inventory": "No tendremos inventario.", "workforce.benefits": "Solo el mínimo de ley." } });
    const asked = run.conv.asked();
    for (const k of ["project.duration", "entity.funding", "workforce.headcount", "workforce.model"]) expect(asked).not.toContain(k);
  });
});

describe("ambiguous / early-stage client", () => {
  it("does not pretend to understand, does not loop and does not complete", () => {
    const seed: DiscoverySeedInput = { locale: "es", destinationCodes: ["MX"], sector: "Alimentos", objective: "Explorar México", needs: [] };
    const c = new Conv("es", seed);
    const answers = ["No sé bien qué necesito, estoy explorando.", "Todavía no tengo claro nada.", "No sé.", "No lo sé aún."];
    const outputs = answers.map((a) => c.say(a));
    expect(outputs.every((o) => !o.ready)).toBe(true);
    expect(c.depth.ready).toBe(false);
    // never the same question three times in a row
    const bots = quotesOf(c);
    expect(new Set(bots.slice(-3)).size).toBeGreaterThan(1);
    expect(c.critical()).toEqual([]);
    // when the client finally says something concrete, it is picked up
    c.say("Quiero saber si me conviene abrir una oficina y contratar personal.");
    expect(c.frame.needs.length).toBeGreaterThan(0);
  });
});
