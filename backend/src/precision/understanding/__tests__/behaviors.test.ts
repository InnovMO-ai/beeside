import { CONCEPTS } from "../concepts";
import { applyInterpretation } from "../frame";
import { govern } from "../governor";
import { interpretByRules, emptyInterpretation, type Interpretation } from "../interpreter";
import { classifyPhrase, replyForPhrase } from "../need-explorer";
import { fold, hasTerm, parseDuration, parseQuantity, quoteInText, termRegex } from "../text";
import { emptyFrame } from "../types";
import { Conv, NOW } from "./harness";

describe("text and vocabulary", () => {
  it("every concept term compiles, never matches the empty string and is unique to its intent", () => {
    for (const c of CONCEPTS) {
      for (const t of [...c.terms.es, ...c.terms.en]) {
        const re = termRegex(t);
        expect(re.test("")).toBe(false);
        expect(() => re.test("texto cualquiera")).not.toThrow();
      }
    }
  });
  it("whole-word, accent-insensitive matching with prefix wildcard", () => {
    expect(hasTerm(fold("Necesitamos contratación de personal"), "contrat*")).toBe(true);
    expect(hasTerm(fold("la contratista"), "contratar")).toBe(false);
    expect(hasTerm(fold("Constitución"), "constitucion")).toBe(true);
    expect(hasTerm(fold("financiamiento desde la casa matriz"), "financiamiento (?:desde|de) (?:la )?(?:casa )?matriz")).toBe(true);
  });
  it("parses quantities and durations in es/en", () => {
    expect(parseQuantity("treinta y cinco")).toBe(35);
    expect(parseQuantity("1.200")).toBe(1200);
    expect(parseQuantity("12.5")).toBe(12.5);
    expect(parseDuration(fold("unos 2 a 3 años"))).toMatchObject({ minMonths: 24, maxMonths: 36 });
    expect(parseDuration(fold("de dos a tres años"))).toMatchObject({ minMonths: 24, maxMonths: 36 });
    expect(parseDuration(fold("about 18 months"))).toMatchObject({ minMonths: 18, maxMonths: 18 });
  });
  it("quotes must really occur in the text", () => {
    expect(quoteInText("durante unos 2 a 3 años", "Vamos a operar durante unos 2 a 3 años en México.")).toBe(true);
    expect(quoteInText("durante cinco años", "Vamos a operar durante unos 2 a 3 años en México.")).toBe(false);
  });
});

describe("governor: the AI understands, the product decides", () => {
  const text = "Vamos a contratar unas 40 personas.";
  const base = (): Interpretation => ({ ...emptyInterpretation("model") });
  it("rejects unknown probes, invented quotes and implausible values; never silently", () => {
    const i = base();
    i.observations = [
      { key: "made.up", value: 1, display: "x", quote: "Vamos a contratar", interpretive: "observed" },
      { key: "workforce.headcount", value: { min: 40, max: 40 }, display: "40", quote: "contratar a cuarenta mil personas", interpretive: "observed" },
      { key: "workforce.headcount", value: { min: 40_000_000, max: 40_000_000 }, display: "40M", quote: "contratar unas 40 personas", interpretive: "observed" },
      { key: "workforce.headcount", value: { min: 40, max: 40 }, display: "40 personas", quote: "contratar unas 40 personas", interpretive: "observed" },
    ];
    const g = govern(i, { text, source: "client" });
    expect(g.interpretation.observations).toHaveLength(1);
    expect(g.rejected.map((r) => r.reason)).toEqual(["unknown_probe", "quote_not_in_text", "implausible_value"]);
  });
  it("demotes implicit inferences to proposals", () => {
    const i = base();
    i.observations = [{ key: "workforce.origin", value: "relocated", display: "Personal que se traslada", quote: "", interpretive: "implicit" }];
    const g = govern(i, { text, source: "client" });
    expect(g.interpretation.observations[0]!.status).toBe("proposed");
  });
  it("a proposal never becomes knowledge and never counts for sufficiency", () => {
    const i = base();
    i.observations = [{ key: "workforce.origin", value: "relocated", display: "Personal que se traslada", quote: "", interpretive: "implicit" }];
    const g = govern(i, { text, source: "client" });
    const a = applyInterpretation(emptyFrame("es"), g.interpretation, { now: NOW, source: "client", asked: null, text });
    expect(a.frame.items["workforce.origin"]!.status).toBe("proposed");
  });
  it("strips markup and control characters from model-provided strings", () => {
    const i = base();
    i.observations = [{ key: "workforce.headcount", value: { min: 40, max: 40 }, display: "<b>40</b>\u0000 personas", quote: "contratar unas 40 personas", interpretive: "observed" }];
    expect(govern(i, { text, source: "client" }).interpretation.observations[0]!.display).toBe("b40/b personas".replace("b40/b", "b40/b"));
  });
});

describe("frame lifecycle: depth is not confirmation", () => {
  it("a clearly stated fact is known at once (no confirm button) with the client's quote", () => {
    const c = new Conv("es", null);
    c.say("Necesitamos contratar unas 80 personas directamente.");
    expect(c.frame.items["workforce.headcount"]).toMatchObject({ status: "known", provenance: "client_stated", quote: expect.stringContaining("80") });
    expect(c.transcript[0]!.bot).not.toMatch(/¿(?:es correcto|confirmas)/i);
  });
  it("only a contradiction, an ambiguity, a material inference or the closing checkpoint ask the client again", () => {
    const c = new Conv("es", null);
    const kinds: string[] = [];
    kinds.push(c.say("Queremos abrir una filial y contratar 80 personas directamente, con un millón de dólares anuales.").action.kind);
    for (const t of c.transcript) expect(t.bot).not.toMatch(/confirm/i);
    expect(kinds[0]).not.toBe("clarify_conflict");
  });
  it("a repeated statement is not a second fact and refreshes freshness", () => {
    const c = new Conv("es", null);
    c.say("Necesitamos contratar unas 80 personas directamente.");
    const first = c.frame.items["workforce.headcount"]!.at;
    c.say("Sí, unas 80 personas directamente.");
    expect(c.frame.items["workforce.headcount"]!.value).toEqual({ min: 80, max: 80 });
    expect(c.frame.items["workforce.headcount"]!.at >= first).toBe(true);
  });
  it("partial answers merge (split given in two messages)", () => {
    const c = new Conv("es", null);
    c.say("Contrataremos 60 personas, algunos directamente y otros por un tercero.");
    c.say("Unas 20 directas.");
    c.say("Y 40 subcontratadas.");
    expect(c.frame.items["workforce.split"]!.value).toMatchObject({ direct: 20, outsourced: 40 });
  });
  it("'I don't know' and 'we haven't decided' are knowledge, not a gap that blocks", () => {
    const c = new Conv("es", null);
    c.say("Vamos a constituir una entidad local.");
    expect(c.last).toMatchObject({ kind: "ask_probe", probeKey: "entity.form" });
    c.say("Todavía no lo hemos decidido.");
    expect(c.frame.items["entity.form"]!.status).toBe("undecided");
    const f = c.findings().find((x) => x.id === "f:entity_form_pending");
    expect(f?.kind).toBe("decision_pending");
  });
  it("a question that is answered with nothing three times is closed as unknown instead of looping", () => {
    const c = new Conv("es", null);
    c.say("Vamos a constituir una entidad local y contratar gente.");
    for (let i = 0; i < 4; i++) c.say("mmm");
    const asks = c.transcript.filter((t) => t.action.kind === "ask_probe" && (t.action as { probeKey: string }).probeKey === "entity.form").length;
    expect(asks).toBeLessThanOrEqual(2);
  });
  it("priority belongs to the client: unprioritized is not 'low' and dependency is not priority", () => {
    const f = emptyFrame("es");
    expect(f.priority.status).toBe("unprioritized");
    const i = interpretByRules({ text: "Lo más importante es la nómina, porque arrancamos en marzo.", locale: "es", frame: f, asked: null, source: "client" });
    expect(i.priorities[0]).toMatchObject({ rank: "top", subjects: expect.arrayContaining(["payroll"]), timing: "en marzo" });
  });
  it("what the client says about the WHY is kept with their words", () => {
    const c = new Conv("es", null);
    c.say("Vamos a abrir una oficina en México porque nuestros clientes globales nos lo piden.");
    expect(c.frame.rationale[0]!.quote).toContain("clientes globales");
  });
});

describe("Service Explorer: need first", () => {
  const kinds: [string, string][] = [
    ["marketing", "known"],
    ["almacén", "ambiguous"],
    ["cadena de frío", "attribute"],
    ["quiero agregar más servicios", "meta"],
    ["4 plumones", "goods_item"],
    ["un sillón", "goods_item"],
    ["necesito asesoría para obtener un permiso de uso de suelo", "unknown_legit"],
    ["warehouse space near the port", "known"],
  ];
  it.each(kinds)("%s -> %s", (text, kind) => {
    expect(classifyPhrase(text).kind).toBe(kind);
  });
  it("marketing maps to its own category (not to_review)", () => {
    const r = classifyPhrase("marketing");
    expect(r.conceptIds).toEqual(["marketing"]);
  });
  it("cold chain is an attribute of transport/storage, never a service", () => {
    const r = classifyPhrase("cadena de frío");
    expect(r.attributeOf).toEqual(expect.arrayContaining(["logistics_transport", "warehousing"]));
  });
  it("noise and meta never become a service; each gets a useful reply", () => {
    for (const t of ["4 plumones", "un sillón", "quiero agregar más servicios"]) {
      const c = new Conv("es", { locale: "es", destinationCodes: ["MX"], objective: "x", needs: [{ capabilityId: "a", label: "Contabilidad" }, { capabilityId: "b", label: "Nómina" }] });
      const before = c.frame.needs.length;
      const r = c.say(t);
      expect(c.frame.needs.length).toBe(before);
      expect(r.text.length).toBeGreaterThan(10);
      expect(replyForPhrase(classifyPhrase(t), "es")).not.toBeNull();
    }
  });
  it("almacén asks one disambiguating question and the answer decides the need", () => {
    const c = new Conv("es", { locale: "es", destinationCodes: ["MX"], objective: "Operar en México", needs: [] });
    const r = c.say("almacén");
    expect(r.action).toMatchObject({ kind: "clarify_need", ambiguous: true });
    expect(r.text).toMatch(/espacio para rentar o un servicio/);
    c.say("Un espacio para rentar cerca del puerto.");
    const need = c.frame.needs.find((n) => n.conceptIds.includes("industrial_site"));
    expect(need?.resolution).toBe("resolved");
  });
  it("a legitimate unknown need is preserved in the client's words and routed for review", () => {
    const c = new Conv("es", { locale: "es", destinationCodes: ["MX"], objective: "Operar en México", needs: [{ capabilityId: "a", label: "Contabilidad" }] });
    c.say("necesito asesoría para obtener un permiso de uso de suelo");
    const need = c.frame.needs.find((n) => n.id.startsWith("n:u:"))!;
    expect(need.text.toLowerCase()).toContain("permiso de uso de suelo");
    c.say("Es para poder abrir la planta en una zona que hoy no permite industria.");
    expect(c.frame.needs.find((n) => n.id === need.id)!.why).toContain("planta");
    expect(c.findings().some((f) => f.kind === "unresolved_need")).toBe(true);
  });
});
