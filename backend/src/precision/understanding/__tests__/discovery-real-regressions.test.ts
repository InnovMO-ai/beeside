import { emptyFrame } from "../types";
import { interpretByRules, isOnlyQuestions } from "../interpreter";
import { seedFromDiscovery } from "../seed";

/**
 * Two defects the first run with REAL Discovery output exposed (not visible with the short fixture contexts):
 *   1. a message made only of questions that names topics ("¿Qué régimen fiscal me conviene?") was read as an ANSWER (a need, an answer to the pending probe);
 *   2. Discovery's free text (the sector, the reason for the project) was promoted to a SERVICE on My Service Map, labelled with the client's own sentence.
 */
describe("a message that is only questions is a question", () => {
  it.each([
    "¿Qué régimen fiscal me conviene? ¿Me garantizan que el SAT no me va a multar?",
    "¿Cuál es la tasa exacta del impuesto sobre nómina en Yucatán este año?",
    "¿Mi información es confidencial? ¿Y cómo funciona este proceso después?",
    "What tax regime suits us?",
  ])("%s", (text) => {
    expect(isOnlyQuestions(text)).toBe(true);
    const frame = emptyFrame("es");
    const out = interpretByRules({ text, locale: /[¿áéíóú]/.test(text) ? "es" : "en", frame, asked: "entity.form", source: "client" });
    expect(out.intent).toBe("question");
    expect(out.needs).toEqual([]);
    expect(out.observations).toEqual([]);
  });

  it.each([
    "Necesitamos apoyo fiscal. ¿Cuánto tarda?",
    "Somos una empresa portuguesa y vamos a contratar 60 personas.",
    "Unas 60 personas en total.",
    "No lo sé todavía.",
  ])("a statement inside the message keeps it an answer path: %s", (text) => {
    expect(isOnlyQuestions(text)).toBe(false);
  });
});

describe("Discovery free text never becomes a service on the map", () => {
  it("the sector and the reason feed facts and concepts, never a need labelled with the client's sentence", () => {
    const { frame } = seedFromDiscovery({
      locale: "es", destinationCodes: ["MX"], operatingCountries: ["PT"],
      sector: "Servicios de ingeniería y montaje para proyectos de energía",
      objective: "apoyar proyectos del sector energético ganados por otras empresas, instalando parte del equipo de los proyectos",
      needs: [{ capabilityId: "CAP_HIVE_FI_TAX", label: "Impuestos", priority: "high" }],
      literals: { motive: "Fuimos subcontratados por las empresas ganadoras de proyectos del sector energético en México.", context: "MX: quiere operar y contratar personal; con servicios; temporal (30 meses). Motivos: un contrato." },
    }, "2026-10-15T00:00:00.000Z");
    const labels = frame.needs.map((n) => n.text);
    expect(labels).toEqual(["Impuestos"]);
    expect(frame.needs.every((n) => n.id.startsWith("n:disc:"))).toBe(true);
  });
});
