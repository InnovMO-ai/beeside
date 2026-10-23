/**
 * Sweep of every STATIC customer-visible string of the backend, English and Spanish: the fixed copy, the Process
 * Knowledge answers, the question bank of the scripted provider, and every bilingual label or help text of the bundled
 * manifests, the value labels and the category labels. The route test (route-copy-quality) covers what the engine says;
 * this one covers what a screen can show from data. Checks: voice lint (R1/R2/R7), canonical names and internal terms,
 * no country-specific legal claim (R10, no approved source exists), no third-person "client" in a label, ES/EN parity
 * of punctuation, no double spaces or stray edges, no placeholder or developer words.
 */
import { AUTHORED_CATEGORY_KEYS, GENERIC_CATEGORY_KEY, bundledCategoryManifest } from "../../manifest";
import categoryLabels from "../../manifest/data/category-labels.json";
import valueLabels from "../../manifest/data/value-labels.json";
import { lintCopy } from "../../manifest/copy-lint";
import { COPY_ENTRIES, SUPERSEDED_COPY_KEYS } from "../copy";
import { GROUPS, QUESTIONS } from "../copy/field-questions";
import { PROCESS_TOPICS } from "../process-knowledge/pack";
import { FORBIDDEN_INTERNAL_TERMS, UNAPPROVED_VARIANTS } from "../process-knowledge/term-registry";
import { findCountryClaims } from "../verifiers/country-claims";
import type { Locale } from "../types";

interface Item { id: string; es: string; en: string; kind: "label" | "help" | "sentence" | "copy" | "question" }

const PARAMS = /\{[A-Za-z_]+\}/g;
const items: Item[] = [];

function walk(o: unknown, path: string, kind: Item["kind"], out: Item[]): void {
  if (Array.isArray(o)) o.forEach((v, i) => walk(v, `${path}[${i}]`, kind, out));
  else if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    if (typeof r.en === "string" && typeof r.es === "string" && Object.keys(r).length === 2) {
      out.push({ id: path, en: r.en, es: r.es, kind: /help/.test(path) ? "help" : kind });
      return;
    }
    for (const [k, v] of Object.entries(r)) if (k !== "notes" && k !== "note" && k !== "boundaries") walk(v, `${path}.${k}`, kind, out);
  }
}

for (const e of COPY_ENTRIES.filter((x) => !SUPERSEDED_COPY_KEYS.includes(x.key))) items.push({ id: `copy:${e.key}`, es: e.es, en: e.en, kind: "copy" });
for (const t of PROCESS_TOPICS) {
  const add = (id: string, s: { es: string[]; en: string[] }): void => s.es.forEach((es, i) => items.push({ id: `pack:${id}[${i}]`, es, en: s.en[i] ?? "", kind: "sentence" }));
  add(t.topicKey, t.sentences);
  t.variants.forEach((v, i) => add(`${t.topicKey}/v${i}`, v.sentences));
}
for (const [k, v] of Object.entries(QUESTIONS)) {
  items.push({ id: `question:${k}`, es: v.q.es, en: v.q.en, kind: "question" });
  if (v.why) items.push({ id: `why:${k}`, es: v.why.es, en: v.why.en, kind: "sentence" });
}
for (const [k, g] of Object.entries(GROUPS)) {
  items.push({ id: `group-intro:${k}`, es: g.intro.es, en: g.intro.en, kind: "sentence" });
  items.push({ id: `group-lead:${k}`, es: g.lead.es, en: g.lead.en, kind: "sentence" });
}
for (const key of [...AUTHORED_CATEGORY_KEYS, GENERIC_CATEGORY_KEY]) walk(bundledCategoryManifest(key), `manifest:${key}`, "label", items);
for (const [k, v] of Object.entries(valueLabels.values as Record<string, { en: string; es: string }>)) items.push({ id: `value:${k}`, es: v.es, en: v.en, kind: "label" });
for (const [f, rows] of Object.entries(valueLabels.field_overrides as Record<string, Record<string, { en: string; es: string }>>)) for (const [k, v] of Object.entries(rows)) items.push({ id: `value:${f}.${k}`, es: v.es, en: v.en, kind: "label" });
for (const [k, v] of Object.entries(valueLabels.units as Record<string, { en: string; es: string }>)) items.push({ id: `unit:${k}`, es: v.es, en: v.en, kind: "label" });
for (const [k, c] of Object.entries(categoryLabels.categories as Record<string, { label: { en: string; es: string }; description: { en: string; es: string } }>)) {
  items.push({ id: `category:${k}.label`, es: c.label.es, en: c.label.en, kind: "label" });
  items.push({ id: `category:${k}.description`, es: c.description.es, en: c.description.en, kind: "sentence" });
}

/** ES nouns that contain a word the voice lint reserves for quality judgments ("lista" = list, not "ready"). */
const noun = (t: string): string => t.replace(/lista de empaque/gi, "empaque");
const SAMPLE = { reason: "Sirve para dimensionar el servicio", category: "Logística", value: "Chile", need: "apoyo con contratación", summary: "apoyo con contratación", label: "volumen mensual", name: "Acme", min: "11", max: "50" } as Record<string, string>;
const fill = (t: string): string => t.replace(PARAMS, (m) => SAMPLE[m.slice(1, -1)] ?? "x").replace(/Category Requirement Pack \(CRP\)/g, "CRP");

/** Adjectives of nationality: "Mexican labor law" names a country as much as "Mexico" does. */
const DEMONYMS = ["mexican", "mexicana", "mexicano", "mexicanas", "mexicanos", "american", "estadounidense", "chilean", "chilena", "brazilian", "brasilena", "european", "europea", "europeo", "singaporean", "singapurense", "german", "alemana", "alemán", "espanola", "spanish", "canadian", "canadiense", "colombian", "colombiana"];

const both = (i: Item): [Locale, string][] => [["es", fill(i.es)], ["en", fill(i.en)]];

describe("static customer text sweep", () => {
  it("covers a meaningful amount of text", () => {
    expect(items.length).toBeGreaterThan(900);
  });

  it("has both languages for every item, with no stray whitespace or placeholder", () => {
    const bad: string[] = [];
    for (const i of items) {
      for (const [l, t] of both(i)) {
        if (!t.trim()) bad.push(`${i.id} (${l}): empty`);
        if (t !== t.trim()) bad.push(`${i.id} (${l}): edge whitespace`);
        if (/\s{2,}/.test(t)) bad.push(`${i.id} (${l}): double space`);
        if (/\b(?:TODO|TBD|FIXME|XXX|undefined|null|NaN)\b|lorem ipsum|\[\w+\]|\{\w+\}/.test(t)) bad.push(`${i.id} (${l}): placeholder or developer word`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("passes the voice lint (tuteo, no colloquialism or exclamation, no quality judgment)", () => {
    const bad: string[] = [];
    for (const i of items) {
      for (const [l, t] of both(i)) {
        // "de una" is only a colloquial reply when it stands alone ("dueño de una empresa" is ordinary Spanish; tone.ts handles it)
        for (const f of lintCopy(i.id, noun(t))) if (f.critical && !(f.rule === "R2" && f.hit.toLowerCase() === "de una")) bad.push(`${i.id} (${l}): ${f.rule} "${f.hit}"`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("uses canonical names and no internal term", () => {
    const bad: string[] = [];
    for (const i of items) {
      for (const [l, t] of both(i)) {
        for (const f of [...FORBIDDEN_INTERNAL_TERMS, ...UNAPPROVED_VARIANTS]) if (f.pattern.test(t)) bad.push(`${i.id} (${l}): ${f.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("makes no country-specific legal, regulatory or customs claim (R10: no approved source exists)", () => {
    const bad: string[] = [];
    for (const i of items) {
      for (const [l, t] of both(i)) {
        for (const c of findCountryClaims(t, { locale: l, approvedSources: [], extraCountryNames: DEMONYMS })) bad.push(`${i.id} (${l}): ${c.sentence}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("names no country inside a manifest overlay or help text (an overlay is already country-specific, so it must not state a rule)", () => {
    const COUNTRY = /\b(?:M[eé]xico|Mexico|EE\.? ?UU\.?|US|U\.S\.|United States|Estados Unidos|UE|EU|European Union|Uni[oó]n Europea|Chile|Colombia|Brasil|Brazil|Canad[aá]|Per[uú]|Argentina|Alemania|Germany)\b/;
    const bad = items.filter((i) => i.id.startsWith("manifest:") && (/country_overlays/.test(i.id) || i.kind === "help") && (COUNTRY.test(i.es) || COUNTRY.test(i.en))).map((i) => i.id);
    expect(bad).toEqual([]);
  });

  it("never speaks of 'the client' in the third person in a label, question or sentence", () => {
    const bad: string[] = [];
    for (const i of items) {
      if (/^copy:(?:ccir_|ai_disclosure)/.test(i.id)) continue; // approved wording (QA-m5, QA-m8)
      if (/\b(?:the client|client's|clients)\b/i.test(i.en)) bad.push(`${i.id} (en): ${i.en}`);
      if (/\b(?:el cliente|los clientes|del cliente)\b/i.test(i.es)) bad.push(`${i.id} (es): ${i.es}`);
    }
    expect(bad).toEqual([]);
  });

  it("keeps question marks consistent: Spanish questions open with ¿ and close with ?, English never use ¿", () => {
    const bad: string[] = [];
    for (const i of items) {
      const opens = (i.es.match(/¿/g) ?? []).length;
      const closes = (i.es.match(/\?/g) ?? []).length;
      if (opens !== closes) bad.push(`${i.id} (es): ${opens} ¿ vs ${closes} ?`);
      if (/¿/.test(i.en)) bad.push(`${i.id} (en): ¿ in English`);
      if (((i.en.match(/\?/g) ?? []).length > 0) !== (closes > 0) && i.kind !== "label" && i.id !== "copy:ccir_why_title") bad.push(`${i.id}: question in one language only`);
    }
    expect(bad).toEqual([]);
  });

  it("starts every sentence-like Spanish and English text with a capital or an opening mark", () => {
    const bad: string[] = [];
    for (const i of items.filter((x) => !x.id.startsWith("unit:"))) {
      for (const [l, t] of both(i)) if (!/^[¿¡"“(+\p{Lu}\p{N}]/u.test(t)) bad.push(`${i.id} (${l}): ${t.slice(0, 40)}`);
    }
    expect(bad).toEqual([]);
  });

  it("does not use jargon or anglicisms that a Spanish-speaking professional would not use", () => {
    const bad: string[] = [];
    const ES_JARGON = /\b(?:frente de trabajo|workstream|bandera|flag|en archivo|on file|hazmat|soporte administrativo|soporte de secretar[ií]a|estatus|targets?|inputs?|feedback|default)\b/i;
    const EN_JARGON = /\b(?:workstream|lanes?|hazmat|on file|path confirmed|unmapped|payload|manifest|fields?|schema|backend|token|slug)\b/i;
    for (const i of items) {
      if (i.id.startsWith("copy:ccir_")) continue;
      if (ES_JARGON.test(i.es)) bad.push(`${i.id} (es): ${i.es}`);
      if (EN_JARGON.test(i.en)) bad.push(`${i.id} (en): ${i.en}`);
    }
    expect(bad).toEqual([]);
  });
});
