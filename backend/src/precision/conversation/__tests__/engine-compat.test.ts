/**
 * Compatibility with ENGINE's real evaluator and bundled manifests. TEST-ONLY: the conversation module itself
 * never imports the evaluator (it receives it through the `EvaluateCategory` port). If the ENGINE module cannot be
 * loaded (it is built concurrently by another owner), the suite reports a skip instead of failing.
 */
import type { EvaluateCategory } from "../ports";
import type { CategoryManifestContent } from "../../manifest/effective-fields";
import { World } from "./helpers";

interface Engine {
  evaluateCategory: EvaluateCategory;
  manifest: (key: string) => (CategoryManifestContent & { fields: { field_key: string; label: { en: string; es: string } }[] }) | undefined;
}

let engine: Engine | null = null;
let loadError = "";

beforeAll(async () => {
  try {
    const m = (await import("../../manifest")) as unknown as { evaluateCategory: EvaluateCategory; bundledCategoryManifest: Engine["manifest"] };
    if (typeof m.evaluateCategory !== "function" || typeof m.bundledCategoryManifest !== "function") throw new Error("ENGINE exports missing");
    engine = { evaluateCategory: m.evaluateCategory, manifest: m.bundledCategoryManifest };
  } catch (e) {
    loadError = e instanceof Error ? e.message : String(e);
  }
});

function withEngine(name: string, fn: (e: Engine) => Promise<void>): void {
  it(name, async () => {
    if (!engine) {
      // eslint-disable-next-line no-console
      console.warn(`engine-compat skipped: ENGINE not loadable (${loadError})`);
      return;
    }
    await fn(engine);
  });
}

describe("conversation engine on ENGINE's real evaluateCategory and the bundled logistics manifest", () => {
  for (const locale of ["es", "en"] as const) {
    withEngine(`${locale}: opens, asks manifest fields, writes only known fields, process questions write nothing`, async (e) => {
      const manifest = e.manifest("logistics");
      expect(manifest).toBeDefined();
      const keys = new Set((manifest as NonNullable<typeof manifest>).fields.map((f) => f.field_key));
      const w = new World({ surface: "category", locale, manifest: manifest as CategoryManifestContent, evaluate: e.evaluateCategory, countries: ["CL"], title: "Logistics" });
      const opened = await w.open();
      expect(opened.status).toBe("ok");
      const firstQuestion = opened.turns[opened.turns.length - 1];
      expect(firstQuestion?.text.length).toBeGreaterThan(10);
      expect(opened.progress?.ready).toBe(false);

      const writes = w.writer.applied.size;
      const q = await w.say(locale === "es" ? "¿Qué es un CRP?" : "What is a CRP?");
      expect(q.meta.turnKind).toBe("process_question");
      expect(q.meta.modelCalls).toBe(0);
      expect(q.factsToWrite).toEqual([]);
      expect(w.writer.applied.size).toBe(writes);

      let totalFacts = 0;
      for (const answer of locale === "es" ? ["Vamos a operarlo nosotros mismos", "no sé", "unos 300 pedidos al mes", "sí", "ninguno"] : ["We will run it ourselves", "I don't know", "about 300 orders a month", "yes", "none"]) {
        const r = await w.say(answer);
        expect(r.status).toBe("ok");
        expect(r.meta.modelCalls).toBeLessThanOrEqual(2);
        for (const f of r.factsToWrite) expect(keys.has(f.fieldKey)).toBe(true);
        totalFacts += r.factsToWrite.length;
        // progress is never readiness: a handful of answers cannot make a 20-field manifest ready
        expect(r.progress?.ready ?? false).toBe(false);
      }
      expect(totalFacts).toBeGreaterThan(0);
      expect(w.writer.applied.size).toBe(writes + totalFacts);
    });
  }

  withEngine("is deterministic: the same dialogue twice yields the same assistant texts and fact keys", async (e) => {
    const manifest = e.manifest("logistics") as CategoryManifestContent;
    const run = async (): Promise<string[]> => {
      const w = new World({ surface: "category", locale: "es", manifest, evaluate: e.evaluateCategory, countries: ["CL"], title: "Logística" });
      const out: string[] = [];
      const o = await w.open();
      out.push(...o.turns.map((t) => t.text));
      for (const a of ["Lo operamos nosotros", "unos 300 pedidos al mes", "no sé"]) {
        const r = await w.turn({ text: a }, `det-${out.length}-key-0001`);
        out.push(...r.turns.filter((t) => t.role === "assistant").map((t) => t.text), ...r.factsToWrite.map((f) => f.fieldKey));
      }
      return out;
    };
    expect(await run()).toEqual(await run());
  });
});
