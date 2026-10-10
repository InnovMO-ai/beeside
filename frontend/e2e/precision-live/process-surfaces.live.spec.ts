import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { Api, facts, seed } from "./support/qa";
import { scanForbidden, type Loc } from "./support/live";
import { newKey } from "./support/flows";

/**
 * P-01 / P-02 on EVERY conversation surface (Understanding, a category, Add a Service), both languages, with the canonical questions of
 * Build Readiness plus the two literal route questions (docs/f5/demo-route.md D3). For each: answered as a process question, nothing
 * written, the pending question resumed, no internal wording. Pass counts are written to /tmp/precision-live/process-counts.json.
 */
const CANON = {
  en: ["What is a Category Requirement Pack?", "What is a CRP?", "What happens after I confirm it?", "What is sent to Operation Hub?", "What does a Sherpa do?", "Why are you asking me this?", "Can I change this later?", "What happens with this requirement?", "What is a CRP and what happens with this?", "What role does the Sherpa play and when does it appear?"],
  es: ["¿Qué es un Category Requirement Pack?", "¿Qué es un CRP?", "¿Qué pasa después de que lo confirme?", "¿Qué se envía a Operation Hub?", "¿Qué hace un Sherpa?", "¿Por qué me preguntas esto?", "¿Puedo cambiar esto después?", "¿Qué pasa con este requisito?", "¿Qué es un CRP y qué va a pasar con esto?", "¿Qué papel juega el Sherpa y cuándo aparece?"],
} as const;
const counts: Record<string, { asked: number; ok: number; misses: string[] }> = {};

for (const locale of ["en", "es"] as const satisfies readonly Loc[]) {
  for (const surface of ["understanding", "category", "add_service"] as const) {
    test(`P-01/P-02 on ${surface} (${locale}): every canonical question is a process answer, writes nothing, resumes the pending question`, async () => {
      const s = await seed(surface === "understanding" ? "start" : "map_confirmed");
      const api = await Api.open(s.projectId, locale);
      const cat = surface === "category" ? await api.categoryId() : "";
      const url = surface === "category" ? `/categories/${cat}/turns` : surface === "understanding" ? "/understanding/turns" : "/add-service/turns";
      const read = async () => (surface === "category" ? (await api.get(`/categories/${cat}`)).body.thread : surface === "understanding" ? (await api.get("/understanding")).body : (await api.get("/add-service")).body.thread);
      await read(); // opening a conversation may derive the proposed categories (system facts); the baseline is taken after it
      const addPrompt: string = surface === "add_service" ? String((await read()).turns[0].text).trim() : "";
      const before = JSON.stringify((await facts(s.projectId)).facts);
      const centerBefore = JSON.stringify((await api.get("/center")).body.categories.map((k: { id: string; status: string }) => [k.id, k.status]));
      const rec = (counts[`${surface}/${locale}`] ??= { asked: 0, ok: 0, misses: [] });
      for (const q of CANON[locale]) {
        rec.asked++;
        const r = await api.post(url, { turnKey: newKey("p"), text: q });
        const [mine, answer] = r.body.turns ?? [];
        const problems: string[] = [];
        if (r.status !== 200) problems.push(`status ${r.status}`);
        if (mine?.kind !== "process_question" || answer?.kind !== "process_question") problems.push(`kind ${mine?.kind}/${answer?.kind}`);
        if (r.body.serviceMapChanged !== false) problems.push("service map changed");
        // the pending prompt: a question (or its confirmation card); on Add a Service the invitation "Tell me what you need." itself
        if (surface === "add_service" ? !(answer?.text ?? "").trimEnd().endsWith(addPrompt) : !/[?¿]/.test(answer?.text ?? "") && !answer?.confirmCard) problems.push("pending question not resumed");
        if (!/Back to where we left off|Retomamos donde nos quedamos/.test(answer?.text ?? "")) problems.push("no resume line");
        if (/\b(tu|your) sherpa\b/i.test(answer?.text ?? "")) problems.push("your Sherpa");
        const hits = scanForbidden(answer?.text ?? "", { allowSherpa: true });
        if (hits.length) problems.push(...hits);
        if (problems.length) rec.misses.push(`${q}: ${problems.join("; ")} :: ${JSON.stringify(r.body).slice(0, 400)}`); else rec.ok++;
      }
      expect(JSON.stringify((await facts(s.projectId)).facts), `${surface}: no fact written`).toBe(before);
      expect(JSON.stringify((await api.get("/center")).body.categories.map((k: { id: string; status: string }) => [k.id, k.status])), "Center unchanged").toBe(centerBefore);
      const th = await read();
      expect(th.turns.filter((t: { role: string }) => t.role === "client").length).toBe(CANON[locale].length);
      expect(rec.misses, `${surface}/${locale}`).toEqual([]);
    });
  }
}
test.afterAll(() => { try { fs.mkdirSync("/tmp/precision-live", { recursive: true }); fs.writeFileSync("/tmp/precision-live/process-counts.json", JSON.stringify(counts, null, 1)); } catch { /* best effort */ } });
