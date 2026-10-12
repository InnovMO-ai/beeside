/**
 * P-01 (process questions answered from the pack) and P-02 (they write nothing and resume the same pending question),
 * on all three surfaces, in both locales. Also: pack integrity, state variants, CRP first-mention rule, Sherpa rule,
 * unknown process questions, country-specific legal questions and false-positive guards.
 */
import { copyText } from "../copy";
import { PACK_VERSION, PROCESS_TOPICS } from "../process-knowledge/pack";
import { composeProcessAnswer, MAX_ANSWER_WORDS } from "../process-knowledge/answer";
import { routeProcessQuestion } from "../process-knowledge/router";
import { CRP_FULL } from "../process-knowledge/term-registry";
import { verifyAssistantText } from "../verifiers";
import { wordCount } from "../text-utils";
import { DEFAULT_FLAGS, type Locale, type StateFlags, type Surface } from "../types";
import { World, assistantText } from "./helpers";

const SURFACES: Surface[] = ["understanding", "category", "add_service"];

interface Q { es: string; en: string; topics: Record<Surface, string> }
const same = (t: string): Record<Surface, string> => ({ understanding: t, category: t, add_service: t });

/** The P-01 questions (Build Readiness §L) and their expected topic on each surface. */
const P01: Q[] = [
  { en: "What is a Category Requirement Pack?", es: "¿Qué es un Category Requirement Pack?", topics: same("category_requirement_pack") },
  { en: "What is a CRP?", es: "¿Qué es un CRP?", topics: same("category_requirement_pack") },
  {
    en: "What happens after I confirm it?",
    es: "¿Qué pasa después de que lo confirme?",
    topics: { understanding: "my_service_map_confirmation", category: "crp_confirmation", add_service: "requirement_destiny" },
  },
  { en: "What is sent to Operation Hub?", es: "¿Qué se envía a Operation Hub?", topics: same("send_to_operation_hub") },
  { en: "What does a Sherpa do?", es: "¿Qué hace un Sherpa?", topics: same("sherpa_role") },
  { en: "Why are you asking me this?", es: "¿Por qué me preguntas esto?", topics: same("why_this_question") },
  { en: "Can I change this later?", es: "¿Puedo cambiar esto después?", topics: same("changes_reopen_versioning") },
  {
    en: "What happens with this requirement?",
    es: "¿Qué pasa con este requisito?",
    topics: same("requirement_destiny"),
  },
];

const EXTRA: { en: string; es: string; topic: string }[] = [
  { en: "What is Precision Center?", es: "¿Qué es Precision Center?", topic: "precision_center" },
  { en: "What is Precision Understanding?", es: "¿Qué es Precision Understanding?", topic: "precision_understanding" },
  { en: "What is My Service Map?", es: "¿Qué es mi mapa de servicios?", topic: "my_service_map" },
  { en: "What is Precision by Category?", es: "¿Qué es Precision por categoría?", topic: "precision_by_category" },
  { en: "Can I add a service later?", es: "¿Puedo agregar un servicio después?", topic: "add_a_service" },
  { en: "Do I have to upload documents?", es: "¿Tengo que subir documentos?", topic: "documents_boundary" },
  { en: "Are you a bot?", es: "¿Eres un bot?", topic: "ai_use" },
  { en: "How long until someone contacts me?", es: "¿Cuándo me va a contactar alguien?", topic: "contact_timing" },
  { en: "Is confirming the same as sending it?", es: "¿Confirmar es lo mismo que enviarlo?", topic: "confirmed_vs_sent" },
  { en: "Can I see what is sent before sending?", es: "¿Puedo ver una vista previa antes de enviar?", topic: "preview_before_send" },
  { en: "What if I don't know the answer?", es: "¿Qué pasa si no sé la respuesta?", topic: "pending_information" },
  { en: "Is it possible to skip a question?", es: "¿Es posible saltarme una pregunta?", topic: "pending_information" },
  { en: "Can I skip this question?", es: "¿Puedo saltarme una pregunta?", topic: "pending_information" },
  { en: "Can I leave this one unanswered?", es: "¿Puedo omitir esta pregunta?", topic: "pending_information" },
  { en: "Do I have to answer everything?", es: "¿Tengo que contestar todo?", topic: "pending_information" },
  { en: "Is it mandatory to answer all of them?", es: "¿Es obligatorio responder todas?", topic: "pending_information" },
  { en: "Can I stop and continue later?", es: "¿Puedo parar y continuar después?", topic: "pause_and_resume" },
  { en: "Can I pause and come back tomorrow?", es: "¿Puedo pausar y volver mañana?", topic: "pause_and_resume" },
  { en: "Can I finish this later?", es: "¿Puedo seguir luego?", topic: "pause_and_resume" },
];

const COMBINED = { es: "¿Qué es un CRP y qué va a pasar con esto?", en: "What is a CRP and what will happen with this?" };
const SHERPA_COMBINED = { es: "¿Qué papel juega el Sherpa y cuándo aparece?", en: "What role does the Sherpa play and when does it appear?" };

const vctx = (locale: Locale, surface: Surface, over: Partial<Parameters<typeof verifyAssistantText>[1]> = {}): Parameters<typeof verifyAssistantText>[1] => ({
  locale,
  surface,
  introducedTerms: new Set<string>(),
  sherpaAssigned: false,
  allowSherpaGeneral: true,
  approvedSources: [],
  questions: "at-most-one",
  ...over,
});

describe("Process Knowledge pack integrity", () => {
  it("has a version, unique topic keys and facts with source references", () => {
    expect(PACK_VERSION).toMatch(/^pk-\d{4}-\d{2}-\d{2}\.\d+$/);
    const keys = PROCESS_TOPICS.map((t) => t.topicKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of PROCESS_TOPICS) {
      expect(t.facts.length).toBeGreaterThan(0);
      for (const f of t.facts) {
        expect(f.sourceRef.length).toBeGreaterThan(3);
        expect(f.factId).toMatch(/^[a-z]+-\d+$/);
      }
      const ids = new Set(t.facts.map((f) => f.factId));
      for (const id of t.factIds) expect(ids.has(id)).toBe(true);
      for (const v of t.variants) for (const id of v.factIds) expect(ids.has(id)).toBe(true);
    }
  });

  it("every topic and variant has EN and ES sentences (<= 3) and stays within the word budget", () => {
    for (const t of PROCESS_TOPICS) {
      const sets = [t.sentences, ...t.variants.map((v) => v.sentences)];
      for (const s of sets) {
        for (const loc of ["en", "es"] as const) {
          expect(s[loc].length).toBeGreaterThanOrEqual(1);
          expect(s[loc].length).toBeLessThanOrEqual(3);
          const words = s[loc].reduce((n, x) => n + wordCount(x.replace("{reason}", "")), 0);
          expect(words).toBeLessThanOrEqual(MAX_ANSWER_WORDS);
        }
        expect(s.en.length).toBe(s.es.length);
      }
    }
  });

  it("every topic/variant answer passes the verifiers in both locales (no question inside, canonical terms only)", () => {
    for (const t of PROCESS_TOPICS) {
      for (const locale of ["en", "es"] as const) {
        const combos: Partial<StateFlags & { surface: Surface }>[] = [
          {},
          { crpState: "confirmed" },
          { firstSendDone: true },
          { ohDeliveryState: "sending" },
          { ohDeliveryState: "failed" },
          { ohDeliveryState: "sent" },
          { serviceMapConfirmed: true },
          { sherpaAssigned: true },
          { surface: "understanding" },
          { surface: "add_service" },
        ];
        for (const c of combos) {
          const { surface, ...flags } = c;
          const a = composeProcessAnswer({
            topicKeys: [t.topicKey],
            locale,
            surface: surface ?? "category",
            flags: { ...DEFAULT_FLAGS, ...flags },
            reason: "It sizes the transport you need.",
            introduced: new Set(),
            pendingQuestion: null,
          });
          expect(a.usedUnknownCopy).toBe(false);
          const vs = verifyAssistantText(a.answerText, vctx(locale, surface ?? "category", { questions: "none", sherpaAssigned: flags.sherpaAssigned === true }));
          expect(vs.map((v) => `${t.topicKey}:${v.code}:${v.hit}`)).toEqual([]);
          for (const pat of t.mustNotSay) expect(new RegExp(pat, "iu").test(a.answerText)).toBe(false);
          expect(wordCount(a.answerText)).toBeLessThanOrEqual(MAX_ANSWER_WORDS);
        }
      }
    }
  });

  it("selects the most specific state variant", () => {
    const text = (topic: string, flags: Partial<StateFlags>, surface: Surface = "category", locale: Locale = "en"): string =>
      composeProcessAnswer({ topicKeys: [topic], locale, surface, flags: { ...DEFAULT_FLAGS, ...flags }, reason: null, introduced: new Set(["crp"]), pendingQuestion: null }).answerText;
    expect(text("crp_confirmation", {})).toContain("available for you to review");
    expect(text("crp_confirmation", { crpState: "confirmed" })).toContain("already confirmed");
    expect(text("send_to_operation_hub", {})).toContain("first send activates");
    expect(text("send_to_operation_hub", { firstSendDone: true })).toContain("already active");
    expect(text("confirmed_vs_sent", { ohDeliveryState: "failed" })).toContain("did not complete");
    expect(text("confirmed_vs_sent", { ohDeliveryState: "sent" })).toContain("received and verified");
    expect(text("add_a_service", { serviceMapConfirmed: false })).toContain("not available yet");
    expect(text("add_a_service", { serviceMapConfirmed: true })).toContain("Add a Service is available once");
    expect(text("requirement_destiny", {}, "understanding")).toContain("feeds your My Service Map");
    expect(text("requirement_destiny", {}, "add_service")).toContain("you confirm it before it is added");
  });

  it("explains the Sherpa in general terms only until one is really assigned", () => {
    const unassigned = composeProcessAnswer({ topicKeys: ["sherpa_role"], locale: "es", surface: "category", flags: DEFAULT_FLAGS, reason: null, introduced: new Set(), pendingQuestion: null }).answerText;
    expect(unassigned).toMatch(/Sherpa/);
    expect(unassigned).not.toMatch(/\b(tu|tus|mi) Sherpa\b/i);
    expect(unassigned).toMatch(/no hay ninguna asignaci/i);
    const assigned = composeProcessAnswer({ topicKeys: ["sherpa_role"], locale: "es", surface: "category", flags: { ...DEFAULT_FLAGS, sherpaAssigned: true }, reason: null, introduced: new Set(), pendingQuestion: null }).answerText;
    expect(assigned).toMatch(/tu Sherpa/i);
    // the verifier agrees: "your Sherpa" is only acceptable with a real assignment
    expect(verifyAssistantText("Tu Sherpa te contactará pronto.", vctx("es", "category")).length).toBeGreaterThan(0);
  });

  it("writes the first CRP mention in full and every later one as CRP", () => {
    const first = composeProcessAnswer({ topicKeys: ["category_requirement_pack"], locale: "en", surface: "category", flags: DEFAULT_FLAGS, reason: null, introduced: new Set(), pendingQuestion: null });
    expect(first.answerText).toContain(CRP_FULL);
    expect(first.introduced.has("crp")).toBe(true);
    const later = composeProcessAnswer({ topicKeys: ["category_requirement_pack"], locale: "en", surface: "category", flags: DEFAULT_FLAGS, reason: null, introduced: first.introduced, pendingQuestion: null });
    expect(later.answerText).not.toContain(CRP_FULL);
    expect(later.answerText).toMatch(/\bCRP\b/);
  });
});

describe("pre-router", () => {
  const flags = DEFAULT_FLAGS;
  it.each(P01.flatMap((q) => SURFACES.flatMap((s) => (["en", "es"] as const).map((l) => [q[l], s, q.topics[s]] as const))))("routes %j on %s to %s", (text, surface, topic) => {
    const d = routeProcessQuestion(text, { surface, flags });
    expect(d.kind).toBe("pack");
    expect(d.topicKeys).toContain(topic);
  });

  it.each(EXTRA.flatMap((q) => (["en", "es"] as const).map((l) => [q[l], q.topic] as const)))("routes %j to %s", (text, topic) => {
    const d = routeProcessQuestion(text, { surface: "category", flags });
    expect(d.kind).toBe("pack");
    expect(d.topicKeys[0]).toBe(topic);
  });

  it("splits a combined question into two topics (P-02 combined case)", () => {
    for (const loc of ["es", "en"] as const) {
      const d = routeProcessQuestion(COMBINED[loc], { surface: "category", flags });
      expect(d.topicKeys).toEqual(["category_requirement_pack", "requirement_destiny"]);
      const s = routeProcessQuestion(SHERPA_COMBINED[loc], { surface: "category", flags });
      expect(s.topicKeys).toEqual(["sherpa_role"]);
    }
  });

  it("does not treat ordinary answers as process questions", () => {
    const answers = [
      "Queremos entrar a Chile",
      "Necesitamos un proveedor de pagos en Chile",
      "Lo que necesitamos es un proveedor logístico",
      "We sell medical devices and want to enter Chile",
      "Mi empresa tiene 50 empleados",
      "La operación será híbrida, con un tercero para el almacén",
      "Unos 500 envíos al mes",
      "No sé",
      "Yes",
      "March 2027",
      "¿Cuál es el precio de los aranceles para vinos?",
    ];
    for (const a of answers) expect(routeProcessQuestion(a, { surface: "category", flags }).kind).toBe("none");
  });

  it("flags a message that carries answer content next to a question as mixed", () => {
    const d = routeProcessQuestion("Vamos a operar con un tercero en Chile desde marzo. ¿Qué es un CRP?", { surface: "category", flags });
    expect(d.kind).toBe("pack");
    expect(d.mixed).toBe(true);
  });

  it("recognises process questions the pack cannot answer as unknown", () => {
    for (const q of ["¿Cuánto cuesta esto?", "How much does this cost?", "¿Cuánto tarda el proceso?", "¿Mis datos están protegidos?", "Is my data secure?"]) {
      expect(routeProcessQuestion(q, { surface: "category", flags }).kind).toBe("unknown");
    }
  });

  it("routes confidentiality/privacy questions to the approved privacy_confidentiality topic", () => {
    for (const q of ["Is my data private?", "Is my information confidential?", "¿Mi información es confidencial?", "¿Es privada mi información?", "Is it confidential?"]) {
      const d = routeProcessQuestion(q, { surface: "category", flags });
      expect(d.kind).toBe("pack");
      expect(d.topicKeys).toContain("privacy_confidentiality");
    }
  });

  it("routes 'how does it work / what happens after I send it' to the send topic and 'how does this process work' to Precision Center", () => {
    for (const q of ["How does this process work after I send it?", "What happens after I send it?", "¿Cómo funciona este proceso después de enviarlo?", "¿Qué pasa después de enviar?"]) {
      const d = routeProcessQuestion(q, { surface: "category", flags });
      expect(d.kind).toBe("pack");
      expect(d.topicKeys).toContain("send_to_operation_hub");
    }
    for (const q of ["How does this process work?", "¿Cómo funciona este proceso?"]) {
      const d = routeProcessQuestion(q, { surface: "category", flags });
      expect(d.kind).toBe("pack");
      expect(d.topicKeys).toContain("precision_center");
    }
  });

  it("treats a country-specific legal question as legal_unverified", () => {
    expect(routeProcessQuestion("What are the tax requirements in Brazil?", { surface: "category", flags }).kind).toBe("legal_unverified");
    expect(routeProcessQuestion("¿Necesito un permiso para importar en Chile?", { surface: "category", flags, extraCountryNames: ["Chile"] }).kind).toBe("legal_unverified");
  });
});

describe("P-01 / P-02 through the turn engine (every surface, both locales)", () => {
  const cases = SURFACES.flatMap((surface) => (["en", "es"] as const).flatMap((locale) => P01.map((q) => [surface, locale, q[locale], q.topics[surface]] as const)));

  it.each(cases)("%s/%s %j answers from the pack, writes nothing and resumes the same question", async (surface, locale, text, topic) => {
    const w = new World({ surface, locale });
    const opened = await w.open();
    const openQuestion = (w.lastAssistant().structured as { state: { pendingQuestion: string } }).state.pendingQuestion;
    expect(openQuestion).toBeTruthy();
    const before = JSON.stringify(w.facts);
    const r = await w.say(text);

    expect(r.status).toBe("ok");
    expect(r.meta.turnKind).toBe("process_question");
    expect(r.meta.topicKeys).toContain(topic);
    expect(r.meta.modelCalls).toBe(0); // deterministic pre-router: no model call
    expect(r.factsToWrite).toEqual([]);
    expect(w.writer.applied.size).toBe(0);
    expect(w.writer.calls).toBe(0);
    expect(JSON.stringify(w.facts)).toBe(before);
    expect(r.serviceMapChanged).toBe(false);
    expect(r.confirmedServiceNeed).toBeNull();

    const reply = assistantText(r);
    const lead = copyText("process_resume_lead", locale).text;
    expect(reply.endsWith(openQuestion.split(CRP_FULL).join("CRP"))).toBe(true);
    expect(reply).toContain(lead);
    // the pending question is still the same one for the next turn
    expect((w.lastAssistant().structured as { state: { pendingQuestion: string } }).state.pendingQuestion).toBe(openQuestion);
    // verified like any generated text
    const vs = verifyAssistantText(reply, vctx(locale, surface, { introducedTerms: reply.includes(CRP_FULL) ? new Set<string>() : new Set(["crp"]) }));
    expect(vs.filter((v) => v.critical)).toEqual([]);
    void opened;
  });

  it.each(SURFACES.flatMap((s) => (["en", "es"] as const).map((l) => [s, l] as const)))("%s/%s: after the process answer the client's next answer is processed normally", async (surface, locale) => {
    const w = new World({ surface, locale });
    await w.open();
    await w.say(locale === "es" ? "¿Qué pasa con este requisito?" : "What happens with this requirement?");
    expect(w.writer.applied.size).toBe(0);
    const answer = surface === "add_service" ? (locale === "es" ? "Necesito apoyo con contratación de personal" : "I need help hiring staff") : locale === "es" ? "Queremos entrar a Chile" : "We want to enter Chile";
    const r = await w.say(answer);
    expect(r.meta.turnKind).toBe("message");
    if (surface === "add_service") expect(r.turns.some((t) => t.confirmCard?.kind === "service_need")).toBe(true);
    else expect(r.factsToWrite.length).toBeGreaterThan(0);
  });

  it("re-presents the quick replies / confirm card of the pending question", async () => {
    const w = new World({ surface: "category", locale: "es", facts: { dest_country: { value: ["CL"], answerState: "ANSWERED" }, operating_model: { value: "hybrid", answerState: "ANSWERED" }, monthly_volume: { value: 10, answerState: "ANSWERED" }, start_date: { value: "2027-03", answerState: "ANSWERED" }, product_notes: { value: "x", answerState: "ANSWERED" } } });
    await w.open();
    const asked = w.lastAssistant();
    expect((asked.structured as { quickReplies?: unknown[] }).quickReplies?.length).toBeGreaterThan(0);
    const r = await w.say("¿Por qué me preguntas esto?");
    const a = r.turns.find((t) => t.role === "assistant");
    expect(a?.quickReplies?.map((q) => q.intent)).toContain("unknown");
    expect(a?.quickReplies?.length).toBe((asked.structured as { quickReplies: unknown[] }).quickReplies.length);
  });

  it("explains the reason from the manifest help text when the topic is 'why are you asking'", async () => {
    const w = new World({ surface: "category", locale: "en", facts: { dest_country: { value: ["CL"], answerState: "ANSWERED" }, operating_model: { value: "hybrid", answerState: "ANSWERED" } } });
    await w.open();
    expect(w.lastAssistant().content.toLowerCase()).toContain("monthly shipment volume");
    const r = await w.say("Why are you asking me this?");
    expect(assistantText(r)).toContain("It sizes the transport and storage you need.");
  });
});

describe("questions about pace and privacy never write (QA-LIVE regression)", () => {
  const PHRASES: Record<"en" | "es", string[]> = {
    en: ["Is it possible to skip a question?", "Can I skip this question?", "Is my information confidential?", "Can I stop and continue later?", "Do I have to answer everything?"],
    es: ["¿Puedo saltarme una pregunta?", "¿Puedo omitir esta pregunta?", "¿Mi información es confidencial?", "¿Puedo parar y continuar después?", "¿Tengo que contestar todo?"],
  };
  it.each(SURFACES.flatMap((s) => (["en", "es"] as const).map((l) => [s, l] as const)))("%s/%s: answered as a process question, nothing written, question resumed", async (surface, locale) => {
    for (const text of PHRASES[locale]) {
      const w = new World({ surface, locale });
      await w.open();
      const q = (w.lastAssistant().structured as { state: { pendingQuestion: string } }).state.pendingQuestion;
      const r = await w.say(text);
      const reply = assistantText(r);
      expect(r.meta.turnKind).toBe("process_question");
      expect(r.factsToWrite).toEqual([]);
      expect(w.writer.applied.size).toBe(0);
      expect(reply.endsWith(q)).toBe(true);
      expect(verifyAssistantText(reply, vctx(locale, surface)).filter((v) => v.critical)).toEqual([]);
    }
  });
  it("answers the confidentiality question with the approved copy (no extra promises), nothing written", async () => {
    for (const [locale, q, expected] of [
      ["es", "¿Mi información es confidencial?", /La información de tu proyecto se utiliza para estructurar tu expansión y se comparte únicamente cuando corresponde avanzar la ejecución\. Precision no envía a Operation Hub el historial de conversación, correo, nombres de personas ni documentos; antes de enviar un Category Requirement Pack \(CRP\), puedes revisar exactamente qué información se compartirá\./],
      ["en", "Is my information confidential?", /Your project information is used to structure your expansion and is only shared when it is needed to move into execution\. Precision does not send conversation history, email, people's names or documents to Operation Hub; before sending a Category Requirement Pack \(CRP\), you can review exactly what information will be shared\./],
    ] as const) {
      const w = new World({ surface: "category", locale });
      await w.open();
      const r = await w.say(q);
      expect(assistantText(r)).toMatch(expected);
      expect(assistantText(r)).not.toMatch(/cannot confirm|No puedo confirmar|no necesitas compartirlo/);
      expect(r.factsToWrite).toEqual([]);
      expect(w.writer.applied.size).toBe(0);
    }
  });
  it("keeps security / protection questions as 'cannot confirm' (no extra promises beyond the contract)", async () => {
    const w = new World({ surface: "category", locale: "en" });
    await w.open();
    const r = await w.say("Is my data secure?");
    expect(assistantText(r)).toMatch(/I can't confirm that detail/);
  });
});

describe("unknown and legal process questions", () => {
  it.each(SURFACES.flatMap((s) => (["en", "es"] as const).map((l) => [s, l] as const)))("%s/%s: honest 'I can't confirm that' + resume, nothing written, signal for DOMAIN", async (surface, locale) => {
    const w = new World({ surface, locale });
    await w.open();
    const q = (w.lastAssistant().structured as { state: { pendingQuestion: string } }).state.pendingQuestion;
    const r = await w.say(locale === "es" ? "¿Cuánto cuesta esto?" : "How much does this cost?");
    const reply = assistantText(r);
    expect(reply).toMatch(locale === "es" ? /No puedo confirmar ese detalle/ : /I can't confirm that detail/);
    expect(reply.endsWith(q)).toBe(true);
    expect(r.factsToWrite).toEqual([]);
    expect(w.writer.applied.size).toBe(0);
    expect(r.meta.turnKind).toBe("process_question");
    expect(r.pendingSignals.map((s) => s.kind)).toEqual(["process_question_unanswered"]);
    expect(verifyAssistantText(reply, vctx(locale, surface)).filter((v) => v.critical)).toEqual([]);
  });

  it("answers a country-specific legal question with the 'cannot confirm yet' copy and a pending signal (R10)", async () => {
    const w = new World({ surface: "category", locale: "en", countries: ["BR"] });
    await w.open();
    const r = await w.say("What are the tax requirements in Brazil?");
    expect(assistantText(r)).toContain("I can't confirm that requirement for that country yet");
    expect(r.pendingSignals.map((s) => s.kind)).toEqual(["country_claim_unverified"]);
    expect(r.factsToWrite).toEqual([]);
    expect(r.meta.modelCalls).toBe(0);
  });
});

describe("a client who does not understand the question gets its reason and the question again", () => {
  const phrases = {
    en: ["What do you mean by hazardous?", "I do not understand the question", "Can you explain this question?", "Could you clarify?"],
    es: ["¿A qué te refieres con peligrosos?", "No entiendo la pregunta", "¿Me puedes explicar esta pregunta?", "¿Puedes aclarar?"],
  } as const;
  it.each((["en", "es"] as const).flatMap((l) => phrases[l].map((p) => [l, p] as const)))("%s %j", async (locale, text) => {
    const w = new World({ surface: "category", locale, facts: { dest_country: { value: ["CL"], answerState: "ANSWERED" } } });
    await w.open();
    const before = JSON.stringify(w.facts);
    const r = await w.say(text);
    expect(r.meta.turnKind).toBe("process_question");
    expect(r.meta.topicKeys).toContain("why_this_question");
    expect(r.factsToWrite).toEqual([]);
    expect(JSON.stringify(w.facts)).toBe(before);
    expect(r.meta.modelCalls).toBe(0);
  });
});
