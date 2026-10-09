import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { es } from "../i18n/es";
import { scan } from "./forbidden";

const keys = (o: Record<string, string>) => Object.keys(o).sort();
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

describe("precision dictionaries", () => {
  it("EN and ES have exactly the same keys", () => {
    const e = new Set(keys(en)), s = new Set(keys(es));
    expect([...e].filter((k) => !s.has(k)), "missing in ES").toEqual([]);
    expect([...s].filter((k) => !e.has(k)), "missing in EN").toEqual([]);
  });

  it("no value is empty and the placeholders match between languages", () => {
    for (const k of keys(en)) {
      const a = (en as Record<string, string>)[k], b = (es as Record<string, string>)[k];
      expect(a.trim(), k).not.toBe("");
      expect(b.trim(), k).not.toBe("");
      expect(placeholders(b), `placeholders of ${k}`).toBe(placeholders(a));
    }
  });

  it("plural keys come in .one/.other pairs", () => {
    for (const d of [en, es] as Record<string, string>[]) {
      for (const k of Object.keys(d)) {
        if (k.endsWith(".one")) expect(d[k.replace(/\.one$/, ".other")], k).toBeTruthy();
        if (k.endsWith(".other")) expect(d[k.replace(/\.other$/, ".one")], k).toBeTruthy();
      }
    }
  });

  it("no forbidden term appears in any client-facing string (EN and ES)", () => {
    const offenders: string[] = [];
    for (const [name, d] of [["en", en], ["es", es]] as const) {
      for (const [k, v] of Object.entries(d as Record<string, string>)) for (const h of scan(v, k)) offenders.push(`${name}.${k}: ${h}`);
    }
    expect(offenders).toEqual([]);
  });

  it("Spanish keeps canonical product names and uses tuteo", () => {
    for (const k of ["nav.understanding", "nav.addService"]) expect((es as Record<string, string>)[k]).toBe((en as Record<string, string>)[k]);
    const joined = Object.values(es).join(" ");
    expect(joined).not.toMatch(/\busted\b/i);
  });

  it("CRP is spelled out at its first mention on the document screens", () => {
    expect((en as Record<string, string>)["crp.eyebrow"] ?? "").toMatch(/Category Requirement Pack \(CRP\)/);
    expect((es as Record<string, string>)["crp.eyebrow"] ?? "").toMatch(/Category Requirement Pack \(CRP\)/);
  });
});
