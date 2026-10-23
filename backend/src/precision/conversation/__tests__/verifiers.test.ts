/**
 * Verifier unit tests: R1-R4, R6, R7 (ES listo/lista family), R9, R10 and the voice lint, the Voice Pack
 * evaluation material (Si/No pairs, S-cases) and the verified-output pipeline (regenerate once, then fallback).
 */
import { ALL_COPY_KEYS, COPY_ENTRIES, SUPERSEDED_COPY_KEYS, copyText } from "../copy";
import { produceVerifiedText, verifyAssistantText, checkCountryClaims, findCountryClaims, isCountryLegalQuestion, countQuestions } from "../verifiers";
import type { VerifyContext } from "../verifiers";
import type { Locale } from "../types";

const ctx = (locale: Locale, over: Partial<VerifyContext> = {}): VerifyContext => ({
  locale,
  surface: "category",
  introducedTerms: new Set<string>(),
  sherpaAssigned: false,
  allowSherpaGeneral: false,
  approvedSources: [],
  questions: "at-most-one",
  ...over,
});
const codes = (text: string, locale: Locale, over: Partial<VerifyContext> = {}): string[] => verifyAssistantText(text, ctx(locale, over)).map((v) => `${v.rule}:${v.code}`);

describe("R1 register (ES tuteo)", () => {
  it.each(["Usted debería contratar un agente aduanal.", "Ustedes pueden confirmar esto.", "¿Vos tenés definido el país?", "¿Podés contarme más?"])("flags %j", (t) => {
    expect(codes(t, "es")).toContain("R1:register_usted_vos");
  });
  it("accepts tú and does not apply to English", () => {
    expect(codes("Si aún no cuentas con agente aduanal, lo dejo anotado como pendiente.", "es")).toEqual([]);
    expect(codes("You can confirm this at any time.", "en")).toEqual([]);
  });
});

describe("R2 colloquialisms, exclamations, emoji", () => {
  it.each([
    ["¡Genial! Cuéntame todo sobre tu proyecto 😊", "es"],
    ["Ahorita lo revisamos.", "es"],
    ["Perfecto, seguimos.", "es"],
    ["Órale, sigamos.", "es"],
    ["Great job! Tell me more.", "en"],
    ["Awesome, let's go.", "en"],
    ["Tell me more 🙂", "en"],
    ["Noted, no on that one. What is the destination?", "en"],
    ["Got it, yes. Which month would you start?", "en"],
  ] as const)("flags %j", (t, l) => {
    expect(codes(t, l)).toContain("R2:colloquial_or_exclamation");
  });
  it("does not flag ordinary acknowledgements of a value", () => {
    for (const t of ["Noted: Chile as the destination. Which month would you start?", "Got it, about 20 pallets a month. How often do they ship?", "Thanks. Is there a customs agent in place?"]) {
      expect(codes(t, "en")).not.toContain("R2:colloquial_or_exclamation");
    }
  });
  it("does not flag 'de una empresa' (Gate D false positive T-1)", () => {
    expect(codes("Eres dueño de una empresa de manufactura.", "es")).not.toContain("R2:colloquial_or_exclamation");
  });
});

describe("R3 one question per turn", () => {
  it("counts ¿ in Spanish and ? in English", () => {
    expect(countQuestions("¿Cuál es el país? ¿Y la fecha?")).toBe(2);
    expect(countQuestions("Which country? And the date?")).toBe(2);
    expect(countQuestions("Dime el país.")).toBe(0);
  });
  it("enforces the requested mode", () => {
    expect(codes("¿Cuál es el país? ¿Y la fecha?", "es")).toContain("R3:one_question_per_turn");
    expect(codes("Dime el país.", "es", { questions: "one" })).toContain("R3:exactly_one_question");
    expect(codes("¿Cuál es el país?", "es", { questions: "none" })).toContain("R3:question_not_allowed");
    expect(codes("¿Cuál es el país?", "es", { questions: "one" })).toEqual([]);
  });
});

describe("R4 sentence length (non-critical flag)", () => {
  it("flags averages above 18 and sentences above 35 words, without being critical", () => {
    const long = "Esta es una frase muy larga que sigue y sigue con muchas palabras adicionales para superar el promedio permitido por la guía de voz de la plataforma porque no termina nunca y además continúa con más palabras sin ninguna razón aparente.";
    const vs = verifyAssistantText(long, ctx("es"));
    expect(vs.some((v) => v.rule === "R4")).toBe(true);
    expect(vs.filter((v) => v.rule === "R4").every((v) => !v.critical)).toBe(true);
  });
});

describe("R7 quality judgments and forbidden terms", () => {
  it.each(["Tu proyecto está listo para cotizar.", "La información está lista.", "Datos validados por nosotros.", "Excelente proyecto.", "Eso es un servicio Core.", "Usamos ClickUp para esto.", "Quieres reabrir el resumen?"])("flags %j (es)", (t) => {
    expect(codes(t, "es")).toContain("R7:forbidden_term_or_quality_judgment");
  });
  it.each(["Your project is ready to quote.", "This is an excellent project.", "We don't have that service.", "Your company looks solid."])("flags %j (en)", (t) => {
    expect(codes(t, "en")).toContain("R7:forbidden_term_or_quality_judgment");
  });
  it("allows the approved state label exactly as written and the ordinary word 'core'", () => {
    expect(codes("Datos validados", "es")).toEqual([]);
    expect(codes("El núcleo (core) de tu operación está definido.", "es")).not.toContain("R7:forbidden_term_or_quality_judgment");
  });
  it("keeps the brand lowercase and The Hive capitalised", () => {
    expect(codes("Beeside te escribirá.", "es")).toContain("R7:brand_case");
    expect(codes("Tu información está en the hive.", "es")).toContain("R7:hive_case");
  });
});

describe("R9 terminology and acronyms", () => {
  it.each(["PSM", "MSM", "OH", "PbyC", "PA", "FA", "CCIR"])("never shows the internal acronym %s", (a) => {
    expect(codes(`Estamos revisando el ${a} de tu proyecto.`, "es").some((c) => c.startsWith("R9:forbidden_"))).toBe(true);
    expect(codes(`We are reviewing the ${a} of your project.`, "en").some((c) => c.startsWith("R9:forbidden_"))).toBe(true);
  });
  it("blocks internal keys, version numbers, provider names and raw structures", () => {
    for (const t of ["Estado PREFILL_CONFIRM activo.", "Estás en la versión 2 del mapa.", "Usamos GPT-4 para esto.", 'Respuesta {"a": 1}', "Error BV409 en tu solicitud."]) {
      expect(codes(t, "es").some((c) => c.startsWith("R9:"))).toBe(true);
    }
  });
  it("blocks unapproved variants of canonical names", () => {
    for (const t of ["Revisa tu Service Map.", "Abre My Precision Service Map.", "Tu Requirement Pack está aquí.", "Entra a Understanding.", "Usa Add Category."]) {
      expect(codes(t, "es").some((c) => c.startsWith("R9:variant_"))).toBe(true);
    }
    expect(codes("Revisa tu My Service Map.", "es")).toEqual([]);
  });
  it("requires 'Category Requirement Pack (CRP)' at the first mention and CRP afterwards", () => {
    expect(codes("Tu CRP está listo para revisar.", "es")).toContain("R9:unintroduced_crp");
    expect(codes("Tu Category Requirement Pack está disponible.", "es")).toContain("R9:crp_name_without_acronym");
    expect(codes("Tu Category Requirement Pack (CRP) está disponible.", "es")).toEqual([]);
    expect(codes("Tu CRP está disponible.", "es", { introducedTerms: new Set(["crp"]) })).toEqual([]);
    expect(codes("Tu Category Requirement Pack (CRP) está disponible.", "es", { introducedTerms: new Set(["crp"]) })).toContain("R9:crp_full_repeated");
    expect(codes("Un Category Requirement Pack (CRP) y otro Category Requirement Pack (CRP).", "en")).toContain("R9:crp_full_repeated");
  });
});

describe("R10 country-specific legal claims", () => {
  const approved = [{ sourceRef: "overlay:CL:vat", country: "CL", text: "En Chile el IVA general es del 19 por ciento." }];
  it("flags an unapproved claim and accepts one contained in an approved source", () => {
    expect(codes("En Chile necesitas un permiso de importación obligatorio.", "es")).toContain("R10:unapproved_country_claim");
    expect(codes("En Chile el IVA general es del 19 por ciento.", "es", { approvedSources: approved })).toEqual([]);
    expect(codes("In Brazil you need a license to import this.", "en")).toContain("R10:unapproved_country_claim");
  });
  it("never treats a question as a claim", () => {
    expect(codes("¿Cuentas con el permiso de importación para Chile?", "es")).toEqual([]);
  });
  it("uses destination names from the context", () => {
    expect(findCountryClaims("En Atlantis la ley exige un registro previo.", { locale: "es", approvedSources: [], extraCountryNames: ["Atlantis"] })).toHaveLength(1);
    expect(checkCountryClaims("Nada legal aquí.", { locale: "es", approvedSources: [] })).toEqual([]);
  });
  it("detects a client legal question about a country", () => {
    expect(isCountryLegalQuestion("¿Qué impuestos debo pagar en México?")).toBe(true);
    expect(isCountryLegalQuestion("What permit do I need in Chile?")).toBe(true);
    expect(isCountryLegalQuestion("We want to enter Mexico in March.")).toBe(false);
  });
});

describe("voice lint", () => {
  it("no lists, no markdown, no percentage in Precision Understanding", () => {
    expect(codes("Cuéntame:\n- país\n- fecha", "es")).toContain("VOICE:format_list");
    expect(codes("**Importante**: dime el país.", "es")).toContain("VOICE:format_markdown");
    expect(codes("Llevas un 40% del camino.", "es", { surface: "understanding" })).toContain("VOICE:percentage_in_understanding");
    expect(codes("Llevas un 40% del camino.", "es", { surface: "category" })).not.toContain("VOICE:percentage_in_understanding");
  });
  it("no Sherpa before a real assignment (possessive, contact, implied assignment, mention)", () => {
    expect(codes("Tu Sherpa te acompañará.", "es")).toEqual(expect.arrayContaining(["VOICE:sherpa_before_assignment", "VOICE:sherpa_assignment_implied"]));
    expect(codes("Your Sherpa will contact you.", "en")).toContain("VOICE:sherpa_before_assignment");
    expect(codes("Un Sherpa coordina la ejecución.", "es")).toContain("VOICE:sherpa_not_introduced");
    expect(codes("Un Sherpa coordina la ejecución.", "es", { allowSherpaGeneral: true })).toEqual([]);
    expect(codes("Tu Sherpa coordina la ejecución.", "es", { sherpaAssigned: true })).toEqual([]);
  });
  it("no promised timing, meta leaks or wrong language", () => {
    expect(codes("Te contactaremos dentro de 2 días.", "es")).toContain("VOICE:promise_of_timing_or_outcome");
    expect(codes("We guarantee a response.", "en")).toContain("VOICE:promise_of_timing_or_outcome");
    expect(codes("Como modelo de lenguaje no puedo decirlo.", "es")).toContain("VOICE:meta_leak");
    expect(codes("<meta>x</meta> ¿Cuál es el país?", "es")).toContain("VOICE:meta_leak");
    expect(codes("What is the destination country that you plan for the project and for the team?", "es")).toContain("VOICE:locale_mismatch");
    expect(codes("¿Cuál es el país de destino que tu equipo tiene previsto para el proyecto?", "en")).toContain("VOICE:locale_mismatch");
  });
  it("R6: never re-ask a known fact, but the target question is allowed", () => {
    const known = [{ fieldKey: "dest_country", label: "País de destino principal" }];
    expect(codes("¿Cuál es el país de destino principal?", "es", { knownFields: known })).toContain("R6:reask_known_fact");
    expect(codes("¿Cuál es el país de destino principal?", "es", { knownFields: known, targetLabels: ["País de destino principal"] })).toEqual([]);
    expect(codes("¿Cuándo planeas iniciar?", "es", { knownFields: known })).toEqual([]);
  });
});

describe("Voice Pack evaluation material", () => {
  const NO_ES = ["¡Genial! Cuéntame todo sobre tu proyecto 😊", "Tu proyecto está listo para cotizar.", "Usted debería contratar un agente aduanal."];
  const YES_ES = [
    "Gracias. Para armar tu mapa de servicios necesito entender primero qué quieres lograr en el destino.",
    "¿Cuántos envíos esperas hacer al mes durante el primer año?",
    "Entiendo lo que necesitas. Voy a capturarlo con el detalle suficiente para determinar cómo podemos atenderlo.",
    "Tienes definidos los datos esenciales de esta categoría. Falta confirmar el alcance de almacenaje.",
    "Si aún no cuentas con agente aduanal, lo dejo anotado como pendiente.",
  ];
  it("every 'No' example is rejected and every 'Si' example passes", () => {
    for (const t of NO_ES) expect(verifyAssistantText(t, ctx("es", { questions: "at-most-one" })).some((v) => v.critical)).toBe(true);
    for (const t of YES_ES) expect(verifyAssistantText(t, ctx("es")).filter((v) => v.critical)).toEqual([]);
  });
  it("S02 / S17 style replies pass; injection text is not echoed by fixed copy", () => {
    expect(codes("Entiendo. Con lo que ya me contaste solo me falta el volumen mensual. ¿Cuántos envíos esperas al mes?", "es", { questions: "one" })).toEqual([]);
    expect(codes(copyText("guard_block", "es").text, "es")).toEqual([]);
  });
});

describe("fixed copy passes its own lint (16/16 automatic checks, both locales)", () => {
  const live = COPY_ENTRIES.filter((e) => !SUPERSEDED_COPY_KEYS.includes(e.key));
  it("has unique keys and none of the superseded ones", () => {
    expect(new Set(ALL_COPY_KEYS).size).toBe(ALL_COPY_KEYS.length);
    for (const k of SUPERSEDED_COPY_KEYS) expect(ALL_COPY_KEYS).not.toContain(k);
  });
  it("contains the keys the engine needs", () => {
    for (const k of ["ai_disclosure_once", "understanding_welcome", "category_intro", "category_intro_known", "knowledge_limit_none", "knowledge_limit_partial", "knowledge_boundary", "knowledge_boundary_alone", "fa_prefill_confirm", "confirm_candidate", "pending_accept", "pending_accept_withheld", "pending_accept_estimate", "process_unknown", "process_resume_lead", "ai_unavailable_retry", "r10_cannot_confirm", "add_service_intro", "add_service_confirm_need", "fallback_question_wrapper", "fallback_question_generic", "category_review_ready", "understanding_review_ready", "guard_block"]) {
      expect(ALL_COPY_KEYS).toContain(k);
    }
  });
  const PARAMS: Record<string, string> = { category: "Logística", value: "Chile", need: "apoyo con contratación de personal", summary: "apoyo con contratación", label: "volumen mensual", name: "Acme", min: "11", max: "50", known: "personas en el país: 60 personas; operaciones con la matriz: servicios entre empresas del grupo", area: "la conclusión fiscal de tu caso" };
  it.each(live.flatMap((e) => (["es", "en"] as const).map((l) => [e.key, l] as const)))("%s (%s) has no placeholders and is clean", (key, locale) => {
    const text = copyText(key, locale, PARAMS).text;
    expect(text).not.toMatch(/\{[a-z_]+\}|\[[^\]]+\]/);
    const vs = verifyAssistantText(text, ctx(locale, { allowSherpaGeneral: false, questions: "at-most-one", introducedTerms: new Set() }));
    // R4 is a non-critical flag; every other automatic check must be clean
    expect(vs.filter((v) => v.rule !== "R4").map((v) => `${v.rule}:${v.code}:${v.hit}`)).toEqual([]);
  });
});

describe("verified output pipeline", () => {
  const baseArgs = (drafts: string[], over: { canRegenerate?: () => boolean } = {}): { calls: number[]; args: Parameters<typeof produceVerifiedText>[0] } => {
    const calls: number[] = [];
    return {
      calls,
      args: {
        generate: async (attempt) => {
          calls.push(attempt);
          return drafts[Math.min(attempt - 1, drafts.length - 1)] as string;
        },
        verify: (t) => verifyAssistantText(t, ctx("es", { questions: "one" })),
        fallback: () => "¿Puedes contarme sobre esto: volumen mensual?",
        r10Replacement: () => "Todavía no puedo confirmar ese requisito.",
        canRegenerate: over.canRegenerate ?? (() => true),
      },
    };
  };
  it("accepts a clean first draft with one model call", async () => {
    const { calls, args } = baseArgs(["¿Cuántos envíos esperas al mes?"]);
    const out = await produceVerifiedText(args);
    expect(out.text).toBe("¿Cuántos envíos esperas al mes?");
    expect(calls).toEqual([1]);
    expect(out.regenerated).toBe(false);
  });
  it("regenerates once on a violation and passes feedback codes", async () => {
    const seen: string[][] = [];
    const out = await produceVerifiedText({
      ...baseArgs(["¡Genial! ¿Cuántos envíos?", "¿Cuántos envíos esperas al mes?"]).args,
      generate: async (attempt, fb) => {
        seen.push(fb);
        return attempt === 1 ? "¡Genial! ¿Cuántos envíos?" : "¿Cuántos envíos esperas al mes?";
      },
    });
    expect(out.regenerated).toBe(true);
    expect(out.usedFallback).toBe(false);
    expect(seen[1]).toContain("colloquial_or_exclamation");
  });
  it("falls back to fixed copy after two violations (never more than 2 drafts)", async () => {
    const { calls, args } = baseArgs(["¡Genial! ¿Cuántos?", "Perfecto. ¿Cuántos?"]);
    const out = await produceVerifiedText(args);
    expect(out.usedFallback).toBe(true);
    expect(out.text).toContain("volumen mensual");
    expect(calls).toEqual([1, 2]);
  });
  it("falls back immediately when the budget does not allow a regeneration", async () => {
    const { calls, args } = baseArgs(["¡Genial! ¿Cuántos?"], { canRegenerate: () => false });
    const out = await produceVerifiedText(args);
    expect(out.usedFallback).toBe(true);
    expect(calls).toEqual([1]);
  });
  it("replaces an unapproved country claim without regenerating (R10)", async () => {
    const { calls, args } = baseArgs(["En Chile necesitas un permiso de importación obligatorio. ¿Cuántos envíos esperas?"]);
    const out = await produceVerifiedText(args);
    expect(out.r10).toBe(true);
    expect(out.text).toBe("Todavía no puedo confirmar ese requisito.");
    expect(calls).toEqual([1]);
  });
});
