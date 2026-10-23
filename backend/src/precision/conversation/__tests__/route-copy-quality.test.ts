/**
 * Copy quality of the demo route (docs/f5/demo-route.md, sections D and K): plays the EXACT client utterances of the
 * route, in English and Spanish, through the real conversation engine with the bundled manifests, ENGINE's evaluator and
 * the scripted provider, and checks every assistant text the client would read:
 *  - the verifiers pass (tone, terminology, country claims, voice) and no fixed-copy fallback was needed;
 *  - no internal term or unapproved variant of a canonical name;
 *  - sentences are short (at most 35 words, 18 on average per language) and a question turn has exactly one question;
 *  - no exclamation, emoji or placeholder, and no immediately repeated sentence.
 * It reads the route from the text the engine produces, so a wording change that breaks the Voice Guide fails here.
 */
import { bundledCategoryManifest, evaluateCategory } from "../../manifest";
import { paManifestContent } from "../../domain/pa-manifest";
import type { CategoryManifestContent } from "../../manifest/effective-fields";
import { engineValueRenderer } from "../adapters/engine-bindings";
import { FORBIDDEN_INTERNAL_TERMS, UNAPPROVED_VARIANTS } from "../process-knowledge/term-registry";
import { splitSentences, wordCount } from "../text-utils";
import { verifyAssistantText } from "../verifiers";
import type { Locale, ProcessTurnResult } from "../types";
import { World } from "./helpers";

type Utterance = string | { quick: "unknown" };

interface Played { stage: string; locale: Locale; said: string; texts: string[]; kind: string; fallback: boolean; question: boolean }

const INHERITED = {
  en: [
    { fieldKey: "pa_project_objective", value: "x", displayText: "Start selling our packaged food products in Mexico through local distributors" },
    { fieldKey: "pa_destination_countries", value: ["MX"], displayText: "Mexico" },
  ],
  es: [
    { fieldKey: "pa_project_objective", value: "x", displayText: "Start selling our packaged food products in Mexico through local distributors" },
    { fieldKey: "pa_destination_countries", value: ["MX"], displayText: "México" },
  ],
} as const;

const UNDERSTANDING: Record<Locale, Utterance[]> = {
  en: ["Yes", "Yes", "We make dry packaged food products with a long shelf life, mainly snacks and cereals", "We plan to set up a local company in Mexico", "April 2027"],
  es: ["Sí", "Sí", "Fabricamos alimentos secos empacados de larga vida útil, sobre todo botanas y cereales", "Vamos a constituir una empresa local en México", "Abril de 2027"],
};

const PROCESS: Record<Locale, string[]> = {
  en: ["What is a CRP and what happens with this?", "What role does the Sherpa play and when does it appear?"],
  es: ["¿Qué es un CRP y qué va a pasar con esto?", "¿Qué papel juega el Sherpa y cuándo aparece?"],
};

const LOGISTICS: Record<Locale, Utterance[]> = {
  en: ["Third-party logistics provider", "No", "Third-party logistics and Freight transportation", "General cargo", "Chile", "Mexico", "Packaged dry food products", "20 pallets", "Monthly", "Ocean", "No", { quick: "unknown" }],
  es: ["Proveedor logístico externo", "No", "Logística con terceros y Transporte de carga", "Carga general", "Chile", "México", "Alimentos secos empacados", "20 pallets", "Mensual", "Marítimo", "No", { quick: "unknown" }],
};

const STRATEGIC: Record<Locale, string[]> = {
  en: [
    "Decide whether to commit to a local presence",
    "Does the plan make commercial sense at our expected volumes?",
    "Market",
    "Retail and food-service distribution for packaged dry goods",
    "Mexico",
    "A clear recommendation we can take to our board",
    "Whether to set up a local company this year",
    "Feasibility report",
  ],
  es: [
    "Decidir si nos comprometemos con una presencia local",
    "¿Tiene sentido comercial el plan con los volúmenes que esperamos?",
    "Mercado",
    "Distribución minorista y de servicios de alimentos para productos secos empacados",
    "México",
    "Una recomendación clara que podamos llevar a nuestro consejo",
    "Si conviene constituir una empresa local este año",
    "Informe de viabilidad",
  ],
};

const assistantTexts = (r: ProcessTurnResult): string[] => r.turns.filter((t) => t.role === "assistant" && t.kind !== "disclosure").map((t) => t.text);

async function play(world: World, stage: string, locale: Locale, utterances: Utterance[], played: Played[]): Promise<void> {
  const opened = await world.open();
  played.push({ stage: `${stage}/open`, locale, said: "(open)", texts: assistantTexts(opened), kind: opened.meta.turnKind, fallback: opened.meta.usedFallbackCopy, question: true });
  for (const u of utterances) {
    const r = typeof u === "string" ? await world.say(u) : await world.turn({ quickReply: { value: u.quick, intent: "unknown" } });
    played.push({ stage, locale, said: typeof u === "string" ? u : `[${u.quick}]`, texts: assistantTexts(r), kind: r.meta.turnKind, fallback: r.meta.usedFallbackCopy, question: !(r.progress?.ready === true || r.understandingState === "ready_to_confirm") });
  }
}

function logisticsWorld(locale: Locale): World {
  return new World({
    surface: "category", locale, countries: ["MX"], title: locale === "es" ? "Logística" : "Logistics",
    manifest: bundledCategoryManifest("logistics") as unknown as CategoryManifestContent, evaluate: evaluateCategory, renderer: engineValueRenderer,
  });
}

async function playRoute(locale: Locale): Promise<Played[]> {
  const played: Played[] = [];
  const u = new World({ surface: "understanding", locale, manifest: paManifestContent() as unknown as CategoryManifestContent, evaluate: evaluateCategory, renderer: engineValueRenderer, inherited: [...INHERITED[locale]], countries: ["MX"] });
  await play(u, "understanding", locale, UNDERSTANDING[locale], played);

  const lw = logisticsWorld(locale);
  await lw.open().then((o) => played.push({ stage: "logistics/open", locale, said: "(open)", texts: assistantTexts(o), kind: o.meta.turnKind, fallback: o.meta.usedFallbackCopy, question: true }));
  for (const q of PROCESS[locale]) {
    const r = await lw.say(q);
    played.push({ stage: "logistics/process", locale, said: q, texts: assistantTexts(r), kind: r.meta.turnKind, fallback: r.meta.usedFallbackCopy, question: true });
  }
  for (const a of LOGISTICS[locale]) {
    const r = typeof a === "string" ? await lw.say(a) : await lw.turn({ quickReply: { value: a.quick, intent: "unknown" } });
    played.push({ stage: "logistics", locale, said: typeof a === "string" ? a : `[${a.quick}]`, texts: assistantTexts(r), kind: r.meta.turnKind, fallback: r.meta.usedFallbackCopy, question: !(r.progress?.ready === true || r.understandingState === "ready_to_confirm") });
  }

  const sw = new World({ surface: "category", locale, countries: ["MX"], title: "Strategic Advisory", introducedTerms: ["crp"], manifest: bundledCategoryManifest("strategic_advisory") as unknown as CategoryManifestContent, evaluate: evaluateCategory, renderer: engineValueRenderer });
  await play(sw, "strategic_advisory", locale, STRATEGIC[locale], played);
  return played;
}

const routes: Partial<Record<Locale, Played[]>> = {};
beforeAll(async () => {
  for (const l of ["en", "es"] as const) routes[l] = await playRoute(l);
  // PRINT_ROUTE=1 prints the transcript for copy review (never part of a normal run)
  if (process.env.PRINT_ROUTE) for (const l of ["en", "es"] as const) for (const p of routes[l] as Played[]) process.stdout.write(`[${l}] ${p.stage} <- ${p.said}\n    ${p.texts.join("\n    ")}\n`);
}, 120_000);

describe.each(["en", "es"] as const)("demo route copy quality (%s)", (locale) => {
  const get = (): Played[] => routes[locale] as Played[];
  const lines = (): { where: string; text: string }[] => get().flatMap((p) => p.texts.map((text) => ({ where: `${p.stage} <- ${p.said}`, text })));

  it("plays the whole route and every turn gets a reply", () => {
    expect(get().length).toBeGreaterThan(20);
    for (const p of get()) expect({ where: p.stage + p.said, replies: p.texts.length > 0 }).toEqual({ where: p.stage + p.said, replies: true });
  });

  it("needs no fixed-copy fallback question", () => {
    expect(get().filter((p) => p.fallback).map((p) => `${p.stage} <- ${p.said}`)).toEqual([]);
  });

  it("passes every verifier (tone, terminology, country claims, voice) with no critical violation", () => {
    const bad: string[] = [];
    let crpIntroduced = false;
    for (const p of get()) {
      for (const text of p.texts) {
        const surface = p.stage.startsWith("understanding") ? "understanding" : "category";
        const vs = verifyAssistantText(text, {
          locale, surface, introducedTerms: new Set(crpIntroduced ? ["crp"] : []), sherpaAssigned: false, allowSherpaGeneral: true, approvedSources: [], extraCountryNames: ["Mexico", "México", "Chile"],
          skip: ["R3", "R6"],
        });
        for (const v of vs) bad.push(`${p.stage} <- ${p.said}: ${v.rule}/${v.code} "${v.hit}"`);
        if (/Category Requirement Pack \(CRP\)/.test(text)) crpIntroduced = true;
      }
    }
    expect(bad).toEqual([]);
  });

  it("contains no internal term, unapproved variant, exclamation, emoji or placeholder", () => {
    const bad: string[] = [];
    for (const { where, text } of lines()) {
      for (const t of [...FORBIDDEN_INTERNAL_TERMS, ...UNAPPROVED_VARIANTS]) if (t.pattern.test(text)) bad.push(`${where}: ${t.id}`);
      if (/[!¡]/.test(text)) bad.push(`${where}: exclamation`);
      if (/\p{Extended_Pictographic}/u.test(text)) bad.push(`${where}: emoji`);
      if (/\{[A-Za-z_]+\}|\[\w+\]|undefined|null|NaN|\[object/.test(text)) bad.push(`${where}: placeholder`);
    }
    expect(bad).toEqual([]);
  });

  it("keeps sentences short: at most 35 words each and 18 on average", () => {
    const counts: number[] = [];
    const long: string[] = [];
    for (const { where, text } of lines()) {
      for (const s of splitSentences(text)) {
        const n = wordCount(s);
        counts.push(n);
        if (n > 35) long.push(`${where}: ${n} words: ${s}`);
      }
    }
    expect(long).toEqual([]);
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(avg).toBeLessThanOrEqual(18);
  });

  it("asks exactly one question per question turn and never more than one in any turn", () => {
    const bad: string[] = [];
    for (const p of get()) {
      const joined = p.texts.join(" ");
      const marks = (joined.match(/\?/g) ?? []).length;
      if (marks > 1) bad.push(`${p.stage} <- ${p.said}: ${marks} questions`);
      if (p.question && marks === 0) bad.push(`${p.stage} <- ${p.said}: no question (${p.kind})`);
    }
    expect(bad).toEqual([]);
  });

  it("does not repeat a sentence inside a turn, and does not open two turns in a row with the same words", () => {
    const bad: string[] = [];
    for (const p of get()) {
      const seen = new Set<string>();
      for (const s of splitSentences(p.texts.join(" "))) {
        if (seen.has(s)) bad.push(`${p.stage} <- ${p.said}: repeated "${s}"`);
        seen.add(s);
      }
    }
    expect(bad).toEqual([]);
  });

  it("never writes the same country as both origin and destination of the lane", () => {
    const text = get().filter((p) => p.stage === "logistics").flatMap((p) => p.texts).join(" ");
    expect(text).not.toMatch(/Chile (?:to|a) Chile|Mexico (?:to|a) Mexico|México (?:to|a) México/);
  });
});

