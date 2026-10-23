import { expect, test } from "@playwright/test";
import { Api, ApiRecorder, facts, seed, shotDir } from "./support/qa";
import { SCRIPT, assistantTurns, checkScreen, clientBubbles, composer, lastAssistant, openWithCode, scanForbidden, settled, T, type Ctx, type Loc } from "./support/live";
import { newKey } from "./support/flows";

/**
 * Process questions (Build Readiness L-3; PO mandate): every canonical question, in English and Spanish, inserted in the middle of a
 * conversation, on the Understanding and the category surfaces. The answer comes from the process knowledge, the pending question
 * resumes, and NOTHING is written: facts, progress, understanding state and the pending question stay exactly as they were.
 */
const EXTRA = {
  en: ["Are you a bot?", "When will someone contact me?", "What is My Service Map?", "What happens if I do not know an answer?", "What is Operation Hub?", "How long does this take?"],
  es: ["¿Eres un bot?", "¿Cuándo me va a contactar alguien?", "¿Qué es My Service Map?", "¿Qué pasa si no sé una respuesta?", "¿Qué es Operation Hub?", "¿Cuánto tarda esto?"],
} as const;
/** Phrasings a client plausibly asks that the router did not recognise when this suite was written (reported in docs/f5/qa/copy-issues.md). */
const GAPS = {
  en: ["Is it possible to skip a question?", "Can I skip this question?", "Is my information confidential?", "Can I stop and continue later?", "Do I have to answer everything?"],
  es: ["¿Puedo saltarme una pregunta?", "¿Puedo omitir esta pregunta?", "¿Mi información es confidencial?", "¿Puedo parar y continuar después?", "¿Tengo que contestar todo?"],
} as const;

for (const locale of ["en", "es"] as const satisfies readonly Loc[]) {
  const questions = [...SCRIPT[locale].processQ, ...EXTRA[locale]];

  test(`every process question leaves the project untouched and resumes the pending question (${locale}, API on both surfaces)`, async () => {
    for (const surface of ["category", "understanding"] as const) {
      // Understanding is asked while its first question is pending (a fresh project); the category while its first lane question is.
      const s = await seed(surface === "category" ? "map_confirmed" : "start");
      const api = await Api.open(s.projectId, locale);
      const cat = surface === "category" ? await api.categoryId() : "";
      const url = surface === "category" ? `/categories/${cat}/turns` : "/understanding/turns";
      const thread = async () => (surface === "category" ? (await api.get(`/categories/${cat}`)).body.thread : (await api.get("/understanding")).body);
      const snapshot = async () => ({
        facts: JSON.stringify((await facts(s.projectId)).facts),
        progress: surface === "category" ? JSON.stringify((await api.get(`/categories/${cat}`)).body.progress) : null,
        center: JSON.stringify((await api.get("/center")).body.categories.map((k: { id: string; status: string }) => [k.id, k.status])),
        state: (await api.get("/understanding")).body.understandingState,
        clientTurns: (await thread()).turns.filter((t: { role: string }) => t.role === "client").length,
      });
      const pendingBefore = (await thread()).turns.filter((t: { role: string }) => t.role === "assistant").at(-1);
      const before = await snapshot();
      for (const q of questions) {
        const r = await api.post(url, { turnKey: newKey("p"), text: q });
        expect(r.status, `${surface} ${q}`).toBe(200);
        const [mine, answer] = r.body.turns;
        expect(mine.role).toBe("client");
        expect(mine.kind, `${q}: stored as a process question`).toBe("process_question");
        expect(answer.kind, `${q}: answered as a process question`).toBe("process_question");
        expect(answer.text.length).toBeGreaterThan(20);
        expect(r.body.serviceMapChanged).toBe(false);
        // the pending question is asked again (a question mark, or the confirmation card for the inherited value)
        expect(/[?¿]/.test(answer.text) || !!answer.confirmCard, `${surface} ${q}: resumes the pending question`).toBe(true);
        if (pendingBefore?.confirmCard) expect(answer.confirmCard?.token, `${q}: same confirmation card`).toBe(pendingBefore.confirmCard.token);
        expect(scanForbidden(answer.text, { allowSherpa: true }), `${q}: ${answer.text}`).toEqual([]);
      }
      const after = await snapshot();
      expect(after.facts, `${surface}: no fact written`).toBe(before.facts);
      expect(after.progress, `${surface}: progress unchanged`).toBe(before.progress);
      expect(after.center, `${surface}: Center unchanged`).toBe(before.center);
      // Asking before answering anything counts as having opened the conversation ("in progress"); it never moves further.
      expect(after.state, `${surface}: understanding state`).toBe(before.state === "not_started" ? "in_progress" : before.state);
      expect(after.clientTurns, `${surface}: every question is in the history, once`).toBe(before.clientTurns + questions.length);
    }
  });

  test(`process questions inside Understanding, in the browser (${locale}): the confirmation card comes back, the answer after it still counts`, async ({ page }, info) => {
    const rec = new ApiRecorder();
    rec.attach(page);
    const c: Ctx = { page, rec, dir: shotDir(info, locale), locale, errors: [] };
    const s = await seed("start");
    const api = await Api.open(s.projectId, locale);
    await openWithCode(page, s.code, locale, "/precision/understanding");
    await expect(page.locator(".pz-confirm")).toBeVisible();
    const f0 = JSON.stringify((await facts(s.projectId)).facts);
    for (const [i, q] of SCRIPT[locale].processQ.entries()) {
      const bubbles = await clientBubbles(page).count();
      const turns = await assistantTurns(page).count();
      await composer(page).fill(q);
      await composer(page).press("Enter");
      await expect(clientBubbles(page)).toHaveCount(bubbles + 1);
      await expect(assistantTurns(page)).not.toHaveCount(turns, { timeout: 30_000 });
      await settled(page);
      await expect(page.locator(".pz-confirm").last(), `${q}: the pending confirmation is shown again`).toBeVisible();
      await expect(page.locator(".pz-turn-assistant").last()).toHaveAttribute("data-kind", "process_question");
      expect(JSON.stringify((await facts(s.projectId)).facts)).toBe(f0);
      if (i === 2) await checkScreen(c, `P1-understanding-process-${i}`, { allowSherpa: true });
    }
    expect((await api.get("/understanding")).body.understandingState).toBe("in_progress");
    // the pending question is still the same one, and answering it now works (the process questions did not consume or skip it)
    const before = await assistantTurns(page).count();
    await page.locator(".pz-confirm").last().getByRole("button", { name: SCRIPT[locale].yes }).click();
    await expect(assistantTurns(page)).not.toHaveCount(before, { timeout: 30_000 });
    await settled(page);
    expect(JSON.stringify((await facts(s.projectId)).facts), "the confirmed value is now recorded").not.toBe(f0);
    void T; void lastAssistant;
  });

  test(`REGRESSION (${locale}): plausible questions about skipping, pausing and confidentiality are answered as process questions and write nothing`, async () => {
    const s = await seed("map_confirmed");
    const api = await Api.open(s.projectId, locale);
    const cat = await api.categoryId();
    const before = JSON.stringify((await facts(s.projectId)).facts);
    for (const q of GAPS[locale]) {
      const r = await api.post(`/categories/${cat}/turns`, { turnKey: newKey("g"), text: q });
      expect(r.body.turns[1].kind, q).toBe("process_question");
    }
    expect(JSON.stringify((await facts(s.projectId)).facts)).toBe(before);
  });
}
