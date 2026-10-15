/**
 * Terminology sweep (frozen product rules): no internal acronym or engineering label reaches a customer
 * surface, canonical names are never varied, and the Category Requirement Pack (CRP) is spelled out at its first
 * mention and called "CRP" afterwards. Covers fixed copy, the Process Knowledge pack, quick-reply labels,
 * confirm cards and every assistant turn the engine produces for a set of realistic dialogues.
 */
import { COPY_ENTRIES, SUPERSEDED_COPY_KEYS, copyText } from "../copy";
import { PROCESS_TOPICS } from "../process-knowledge/pack";
import { CRP_FULL, FORBIDDEN_INTERNAL_TERMS, TERM_REGISTRY, UNAPPROVED_VARIANTS, expandCrpToken } from "../process-knowledge/term-registry";
import type { ProcessTurnResult, Locale, Surface } from "../types";
import { World } from "./helpers";

const PARAMS: Record<string, string> = { category: "Logística", value: "Chile", need: "apoyo con contratación de personal", summary: "apoyo con contratación", label: "volumen mensual", name: "Acme", min: "11", max: "50", known: "personas en el país: 60 personas", area: "la conclusión fiscal de tu caso" };

function offences(text: string): string[] {
  const out: string[] = [];
  for (const t of [...FORBIDDEN_INTERNAL_TERMS, ...UNAPPROVED_VARIANTS]) if (t.pattern.test(text)) out.push(`${t.id}: ${text.slice(0, 80)}`);
  return out;
}

/** Every CRP-ish mention: a full name or a bare acronym, in text order. */
function crpMentions(text: string): ("full" | "short")[] {
  const out: ("full" | "short")[] = [];
  const re = /Category Requirement Pack \(CRP\)|Category Requirement Pack|(?<![\p{L}\p{N}_])CRP(?![\p{L}\p{N}_])/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[0] === CRP_FULL ? "full" : m[0] === "Category Requirement Pack" ? "short" : "short");
  return out;
}

/** Strips the full form from the text so a bare "Category Requirement Pack" (without "(CRP)") can be detected. */
function hasBareFullName(text: string): boolean {
  return /Category Requirement Pack(?! \(CRP\))/.test(text);
}

describe("fixed copy", () => {
  const live = COPY_ENTRIES.filter((e) => !SUPERSEDED_COPY_KEYS.includes(e.key));
  it.each(live.flatMap((e) => (["es", "en"] as const).map((l) => [e.key, l] as const)))("%s (%s) has no internal term, unapproved variant or bare long CRP name", (key, locale) => {
    // first mention of the session: {crp} -> full; the full name must therefore appear at most once per text
    const text = copyText(key, locale, PARAMS).text;
    expect(offences(text)).toEqual([]);
    expect(hasBareFullName(text)).toBe(false);
    const mentions = crpMentions(text);
    if (mentions.length > 0) expect(mentions[0]).toBe("full");
    expect(mentions.filter((m) => m === "full").length).toBeLessThanOrEqual(1);
  });

  it.each(live.filter((e) => e.es.includes("{crp}") || e.en.includes("{crp}")).map((e) => [e.key] as const))("%s: after the first mention it says only CRP", (key) => {
    for (const locale of ["es", "en"] as const) {
      const again = copyText(key, locale, PARAMS, new Set(["crp"])).text;
      expect(again).not.toContain("Category Requirement Pack");
    }
  });
});

describe("Process Knowledge pack", () => {
  const sentences = PROCESS_TOPICS.flatMap((t) => [
    ...(["es", "en"] as const).flatMap((l) => t.sentences[l].map((s) => [`${t.topicKey}/${l}`, s] as const)),
    ...t.variants.flatMap((v, i) => (["es", "en"] as const).flatMap((l) => v.sentences[l].map((s) => [`${t.topicKey}/v${i}/${l}`, s] as const))),
  ]);
  it("has sentences to check", () => {
    expect(sentences.length).toBeGreaterThan(40);
  });
  it.each(sentences)("%s: %s", (_id, sentence) => {
    for (const introduced of [new Set<string>(), new Set(["crp"])]) {
      const text = expandCrpToken(sentence, introduced).text;
      expect(offences(text)).toEqual([]);
      expect(hasBareFullName(text)).toBe(false);
    }
  });
  it("uses only registered terms", () => {
    const ids = new Set(TERM_REGISTRY.map((t) => t.id));
    for (const t of PROCESS_TOPICS) for (const id of t.terms) expect(ids.has(id)).toBe(true);
  });
});

describe("customer text produced by the engine (scripted provider, same verifiers)", () => {
  interface Collected { texts: string[]; labels: string[] }

  function collect(results: ProcessTurnResult[]): Collected {
    const texts: string[] = [];
    const labels: string[] = [];
    for (const r of results) {
      for (const t of r.turns) {
        if (t.role !== "assistant") continue;
        texts.push(t.text);
        for (const q of t.quickReplies ?? []) labels.push(q.label);
        if (t.confirmCard) labels.push(t.confirmCard.title, t.confirmCard.body, t.confirmCard.confirmLabel, t.confirmCard.correctLabel);
      }
      if (r.notice) texts.push(r.notice.text);
    }
    return { texts, labels };
  }

  const QUESTIONS: Record<Locale, string[]> = {
    es: [
      "¿Qué es un CRP?",
      "¿Qué es Precision Center?",
      "¿Qué es Mi mapa de servicios y cómo cambia?",
      "¿Un Sherpa me va a contactar? ¿Cuándo?",
      "¿Lo que envío ya es definitivo?",
      "¿Puedo agregar otro servicio después?",
      "¿Usan inteligencia artificial?",
      "¿Qué pasa si no tengo un documento?",
      "¿Por qué me preguntan esto?",
      "¿Cuánto cuesta el servicio?",
      "¿Qué impuestos aplican en Chile?",
    ],
    en: [
      "What is a CRP?",
      "What is Precision Center?",
      "What is My Service Map and can it change?",
      "Will a Sherpa contact me? When?",
      "Is what I send final?",
      "Can I add another service later?",
      "Do you use artificial intelligence?",
      "What if I do not have a document?",
      "Why are you asking me this?",
      "How much does it cost?",
      "Which taxes apply in Chile?",
    ],
  };
  const ANSWERS: Record<Locale, string[]> = {
    es: ["Chile", "Lo operamos nosotros mismos", "unos 500 envíos al mes", "no sé", "marzo de 2027", "prefiero no decirlo", "sí", "ninguno"],
    en: ["Chile", "We run it ourselves", "about 500 shipments a month", "I don't know", "March 2027", "I would rather not say", "yes", "none"],
  };

  const combos: [Surface, Locale][] = [
    ["category", "es"],
    ["category", "en"],
    ["understanding", "es"],
    ["understanding", "en"],
    ["add_service", "es"],
    ["add_service", "en"],
  ];

  it.each(combos)("%s / %s: every assistant text, quick reply and card is clean; CRP rule holds across the thread", async (surface, locale) => {
    const w = new World({ surface, locale });
    const results: ProcessTurnResult[] = [await w.open()];
    for (const q of QUESTIONS[locale]) results.push(await w.say(q));
    for (const a of ANSWERS[locale]) {
      results.push(await w.say(a));
      results.push(await w.say(QUESTIONS[locale][0] as string));
    }
    // an AI failure + retry also produces customer text
    w.provider.failNext(1);
    const fk = w.key("fail");
    results.push(await w.say(ANSWERS[locale][0] as string, fk));
    results.push(await w.say(ANSWERS[locale][0] as string, fk));

    const { texts, labels } = collect(results);
    expect(texts.length).toBeGreaterThan(10);
    for (const s of [...texts, ...labels]) expect(offences(s)).toEqual([]);
    for (const s of texts) expect(hasBareFullName(s)).toBe(false);

    // first CRP mention in the thread is the full name; none is a bare "CRP" before it (and never twice in full)
    const seq = texts.flatMap((t) => crpMentions(t));
    if (seq.length > 0) expect(seq[0]).toBe("full");
    expect(seq.filter((m) => m === "full").length).toBeLessThanOrEqual(1);
    for (const t of texts) expect(crpMentions(t).filter((m) => m === "full").length).toBeLessThanOrEqual(1);
  });

  it("the CRP is introduced in full once per project even across two threads", async () => {
    const w = new World({ surface: "category", locale: "es" });
    const first = await w.say("¿Qué es un CRP?");
    const second = await w.say("¿Y qué es un CRP otra vez?");
    const a = collect([first]).texts.join(" ");
    const b = collect([second]).texts.join(" ");
    expect(a).toContain(CRP_FULL);
    expect(b).not.toContain("Category Requirement Pack");
  });

  it("canonical names are never translated (English names inside Spanish text)", async () => {
    const w = new World({ surface: "category", locale: "es" });
    const r = await w.say("¿Qué es Mi mapa de servicios?");
    const text = collect([r]).texts.join(" ");
    expect(text).toMatch(/My Service Map/);
    expect(text).not.toMatch(/Mapa de servicios|Centro de Precisi/i);
  });

  it("never names the model, the provider or the simulation", async () => {
    const w = new World({ surface: "category", locale: "en" });
    const rs = [await w.open(), await w.say("Do you use artificial intelligence?"), await w.say("Chile")];
    const joined = collect(rs).texts.join(" ");
    expect(joined).not.toMatch(/scripted|simulat|mock|stub|fake|OpenAI|Anthropic|Claude|GPT|LLM/i);
  });
});
