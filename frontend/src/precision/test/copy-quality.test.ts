/**
 * Copy quality of the client dictionaries (EN and ES): the terminology rules of the backend sweep, applied to what the
 * screens show. Complements i18n.test.ts (parity, placeholders, forbidden terms). Rules: Voice Guide v1.1, Track A
 * contract section 4, decisions D-9 / D-10 and the glossary of docs/f5/qa/copy-review-2026-10-09.md.
 */
import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { es } from "../i18n/es";

const entries = (d: Record<string, string>): [string, string][] => Object.entries(d);
const both: [string, "en" | "es", string][] = [
  ...entries(en as Record<string, string>).map(([k, v]) => [k, "en", v] as [string, "en", string]),
  ...entries(es as Record<string, string>).map(([k, v]) => [k, "es", v] as [string, "es", string]),
];
const offenders = (test: (key: string, lang: "en" | "es", text: string) => string | null): string[] =>
  both.flatMap(([k, l, v]) => {
    const r = test(k, l, v);
    return r ? [`${l}.${k}: ${r}`] : [];
  });

/** Words of a sentence (placeholders count as one). */
const sentences = (t: string): string[] => t.replace(/\{\w+\}/g, "x").split(/(?<=[.?!…])\s+/).map((s) => s.trim()).filter(Boolean);
const words = (s: string): number => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

describe("client dictionaries: terminology", () => {
  it("never says 'map' or 'mapa' on its own: the canonical name is My Service Map", () => {
    expect(offenders((_k, _l, t) => {
      const stripped = t.replace(/My Service Map/g, "");
      const m = /\b(?:map|maps|mapa|mapas)\b/i.exec(stripped);
      return m ? `bare "${m[0]}"` : null;
    })).toEqual([]);
  });

  it("keeps canonical names untranslated and unvaried", () => {
    const bad = offenders((_k, l, t) => {
      if (l === "es" && /\b(?:Agregar un servicio|Añadir un servicio|Mapa de servicios|Mi Mapa de Servicios|Comprensión de Precision|Centro de Precisión|Hub de operaciones|Centro de operaciones)\b/i.test(t)) return "translated canonical name";
      if (/\b(?:Service Map|Requirement Pack|Understanding)\b/.test(t.replace(/My Service Map|Category Requirement Pack|Precision Understanding/g, ""))) return "shortened canonical name";
      if (/\b(?:add a service|agregar un servicio)\b/.test(t)) return "Add a Service is written with capitals and not translated";
      return null;
    });
    expect(bad).toEqual([]);
  });

  it("does not promise work, outcomes, timing or an assigned person", () => {
    expect(offenders((_k, _l, t) => {
      const m = /\b(?:will start working|empezará a trabajar|will contact you|te contactará|within \d+|en \d+ (?:horas|días)|guarantee|garantiz\w*|your advisor|tu asesor)\b/i.exec(t);
      return m ? `promise "${m[0]}"` : null;
    })).toEqual([]);
  });

  it("avoids reopen/reabrir in any form and the developer words of the product", () => {
    expect(offenders((_k, _l, t) => {
      const m = /\b(?:reopen\w*|reabr\w+|reabrimos|workstream\w*|frente de trabajo|payload|backend|token|slug|schema|manifest|hazmat|lanes?)\b/i.exec(t);
      return m ? `"${m[0]}"` : null;
    })).toEqual([]);
  });

  it("uses Spanish words a Mexican professional would use (no 'estatus', 'soporte', 'ventana de tiempo')", () => {
    expect(offenders((_k, l, t) => {
      if (l !== "es") return null;
      const m = /\b(?:estatus|soporte|ventana de tiempo|bandera|en archivo|chequear|trackear|performance)\b/i.exec(t);
      return m ? `"${m[0]}"` : null;
    })).toEqual([]);
  });

  it("never refers to the person in the third person", () => {
    expect(offenders((_k, l, t) => {
      const m = l === "en" ? /\b(?:the client|clients?'s?)\b/i.exec(t) : /\b(?:el cliente|los clientes)\b/i.exec(t);
      return m ? `"${m[0]}"` : null;
    })).toEqual([]);
  });

  it("spells Category Requirement Pack (CRP) in full on every headline that introduces it, and elsewhere uses CRP", () => {
    for (const d of [en, es] as Record<string, string>[]) {
      for (const [k, v] of Object.entries(d)) {
        if (/Category Requirement Pack(?! \(CRP\))/.test(v)) expect.fail(`${k}: "Category Requirement Pack" without (CRP)`);
        if (/(?:Category Requirement Pack \(CRP\)).*(?:Category Requirement Pack \(CRP\))/.test(v)) expect.fail(`${k}: full name twice`);
      }
    }
  });
});

describe("client dictionaries: voice and typography", () => {
  it("keeps sentences short (at most 35 words) and the average under 18 per string", () => {
    const bad = offenders((_k, _l, t) => {
      const s = sentences(t);
      const w = s.map(words);
      if (Math.max(0, ...w) > 35) return `a sentence has ${Math.max(...w)} words`;
      if (w.length > 1 && w.reduce((a, b) => a + b, 0) / w.length > 18) return "average sentence length over 18";
      return null;
    });
    expect(bad).toEqual([]);
  });

  it("uses the single ellipsis character, straight quotes are avoided and spacing is clean", () => {
    expect(offenders((_k, _l, t) => {
      if (/\.\.\./.test(t)) return 'three dots instead of "…"';
      if (/\s{2,}|^\s|\s$/.test(t)) return "stray whitespace";
      if (/[.,;:]{2,}(?!\s*$)/.test(t.replace(/…/g, ""))) return "doubled punctuation";
      if (/\s[.,;:?!]/.test(t)) return "space before punctuation";
      return null;
    })).toEqual([]);
  });

  it("matches question marks: ES opens with ¿ and closes with ?, EN has no ¿", () => {
    expect(offenders((_k, l, t) => {
      const opens = (t.match(/¿/g) ?? []).length;
      const closes = (t.match(/\?/g) ?? []).length;
      if (l === "en" && opens > 0) return "¿ in English";
      if (l === "es" && opens !== closes) return `${opens} ¿ vs ${closes} ?`;
      return null;
    })).toEqual([]);
  });

  it("writes percentages the way each language does (ES with a space, EN without)", () => {
    expect(offenders((_k, l, t) => {
      if (l === "en" && /\d\}?\s%/.test(t.replace(/\{pct\}/g, "1"))) return "space before %";
      if (l === "es" && /(?:\d|\{pct\})%/.test(t)) return "no space before %";
      return null;
    })).toEqual([]);
  });

  it("starts every full string with a capital, an opening mark or a placeholder, except short labels in lower case by design", () => {
    expect(offenders((k, _l, t) => (/^[¿¡"“(+\p{Lu}\p{N}{]|^beeside\b/u.test(t) ? null : `starts with "${t.slice(0, 12)}" (${k})`))).toEqual([]);
  });

  it("states action labels as verbs and statuses as adjectives in the same way in both languages", () => {
    const get = (d: Record<string, string>, k: string): string => d[k] as string;
    for (const k of ["center.cat.cta.not_started", "center.cat.cta.in_progress", "center.cat.cta.sent", "center.u.cta.confirmed"]) {
      expect(get(en as Record<string, string>, k).split(/\s+/).length, k).toBeLessThanOrEqual(3);
      expect(get(es as Record<string, string>, k).split(/\s+/).length, k).toBeLessThanOrEqual(4);
    }
    // the status words a category shows are registered: Confirmed / Sent, never Completed
    for (const d of [en, es] as Record<string, string>[]) expect(Object.values(d).join(" ")).not.toMatch(/\b(?:Completed|Completada|Completado)\b/);
  });

  it("keeps the registered glossary decisions (see docs/f5/qa/copy-review-2026-10-09.md)", () => {
    const E = en as Record<string, string>;
    const S = es as Record<string, string>;
    expect(E["status.ready_for_review"]).toBe("For your review");
    expect(S["status.ready_for_review"]).toBe("Para tu revisión");
    expect(S["nav.addService"]).toBe("Add a Service");
    expect(S["sm.timeWindow"]).toBe("Horizonte de tiempo");
    expect(S["nav.helpCenter"]).toBe("Centro de ayuda");
    expect([S["item.confirmed"], S["item.assumed"], S["item.pending"], S["item.not_applicable"]]).toEqual(["Confirmado", "Supuesto", "Pendiente", "No aplica"]);
    expect([E["item.confirmed"], E["item.assumed"], E["item.pending"], E["item.not_applicable"]]).toEqual(["Confirmed", "Assumed", "Pending", "Not applicable"]);
  });
});
