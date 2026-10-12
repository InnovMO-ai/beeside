/**
 * Deterministic conversation engine of the in-memory adapter. It plays the part of the server: it picks the next field,
 * records answers, answers process questions without changing any state, and computes progress as floor(100 * confirmed / total).
 * Fixture content only; nothing here is imported by the customer app.
 */
import type { QuickReplyIntent, TurnKind } from "../api/dto";
import { bi, CATEGORIES, EXTRA_CATEGORY_LABELS, UNDERSTANDING_QUESTIONS, type Bi, type CategoryFx, type QuestionFx, type QuickReplyFx } from "./fixtures";

export interface StoredConfirmCard { kind: "inherited_value" | "service_need" | "classification" | "summary"; title: Bi; body: Bi; confirmLabel: Bi; correctLabel: Bi; token: string }
export interface StoredTurn {
  id: string; role: "client" | "assistant"; kind: TurnKind; text: Bi; createdAt: string;
  quickReplies?: { value: string; label: Bi; intent: QuickReplyIntent }[];
  confirmCard?: StoredConfirmCard;
}
export type AnswerState = "answered" | "unknown" | "assumed";
export interface Interview {
  turns: StoredTurn[];
  answers: Record<string, { state: AnswerState; text: Bi }>;
  asked: string[];
  current: string | null;
  stage: "idle" | "asking" | "pending_review" | "summary" | "summary_correct" | "done" | "added";
  correcting: string | null;
  reviewDone: boolean;
  reasked: boolean;
  started: boolean;
}
export const newInterview = (): Interview => ({ turns: [], answers: {}, asked: [], current: null, stage: "idle", correcting: null, reviewDone: false, reasked: false, started: false });

export interface Ids { next: () => string; now: () => string }

const same = (s: string): Bi => bi(s, s);
export const GENERIC_QUESTIONS = (label: Bi): QuestionFx[] => [
  { key: "need", section: "need", blocking: true, label: bi("What you need", "Qué necesitas"), ask: bi(`Tell me what you need in ${label.en}.`, `Cuéntame qué necesitas en ${label.es}.`) },
  { key: "timing", section: "need", label: bi("Timing", "Plazo"), ask: bi("When do you need this in place?", "¿Para cuándo necesitas tenerlo definido?") },
];
export function categoryFx(id: string): CategoryFx | null {
  if (CATEGORIES[id]) return CATEGORIES[id];
  const label = EXTRA_CATEGORY_LABELS[id];
  if (!label) return null;
  return {
    id, label, iconKey: id, kind: "category",
    intro: bi("Let's define this together. One question at a time.", "Vamos a definirlo juntos. Una pregunta a la vez."),
    questions: GENERIC_QUESTIONS(label), sections: [{ id: "need", title: bi("Your need", "Tu necesidad") }],
    contextLines: [bi("Destination: Mexico", "Destino: México")], requiredLater: [],
  };
}

export function turn(ids: Ids, role: StoredTurn["role"], kind: TurnKind, text: Bi, extra: Partial<StoredTurn> = {}): StoredTurn {
  return { id: ids.next(), role, kind, text, createdAt: ids.now(), ...extra };
}
function withQr(q: QuestionFx): StoredTurn["quickReplies"] {
  return q.qr?.map((r: QuickReplyFx) => ({ value: r.value, label: r.label, intent: r.intent }));
}

/** The assistant turn that asks `q`, with a confirm card when the value is inherited and must be confirmed. */
export function askTurn(ids: Ids, scope: string, q: QuestionFx, lead?: Bi): StoredTurn {
  const text = lead ? bi(`${lead.en} ${q.ask.en}`, `${lead.es} ${q.ask.es}`) : q.ask;
  if (q.prefill) {
    return turn(ids, "assistant", "message", text, {
      confirmCard: {
        kind: "inherited_value", title: q.prefill.title, body: q.prefill.value, token: `${scope}:${q.key}`,
        confirmLabel: bi("Yes, that is right", "Sí, es correcto"), correctLabel: bi("Correct it", "Corregir"),
      },
    });
  }
  return turn(ids, "assistant", "message", text, { quickReplies: withQr(q) });
}

const PROCESS_ANSWERS: { match: RegExp; text: Bi }[] = [
  { match: /crp|category requirement pack/i, text: bi("A Category Requirement Pack (CRP) is the summary of a category once you have answered it: what we captured, what is pending and what will be needed later. You review and confirm it before anything is sent.", "Un Category Requirement Pack (CRP) es el resumen de una categoría una vez que la respondiste: qué capturamos, qué está pendiente y qué se necesitará después. Lo revisas y lo confirmas antes de enviar nada.") },
  { match: /service map|mapa/i, text: bi("My Service Map is a summary of the services you need for this project. Once you confirm it, it is not edited; if something important changes, we create a new one.", "My Service Map es un resumen de los servicios que necesitas para este proyecto. Una vez que lo confirmas no se edita; si cambia algo importante, creamos uno nuevo.") },
  { match: /operation hub|\bhub\b/i, text: bi("Operation Hub is where the work continues after you send your first category. You always see exactly what will be sent before sending it.", "Operation Hub es donde continúa el trabajo después de que envías tu primera categoría. Siempre ves exactamente qué se enviará antes de enviarlo.") },
  { match: /sherpa/i, text: bi("In general, a Sherpa is the person who accompanies clients once their project is in Operation Hub. You will see here when that applies to your project.", "En general, el Sherpa es quien acompaña a los clientes cuando su proyecto ya está en Operation Hub. Verás aquí cuando eso aplique a tu proyecto.") },
  { match: /pause|pausar|save|guard/i, text: bi("Everything you answer is saved, so you can pause and continue from where you left off.", "Todo lo que respondes se guarda, así que puedes pausar y continuar desde donde lo dejaste.") },
];
export function isProcessQuestion(text: string, hasStructured: boolean): boolean {
  if (hasStructured) return false;
  const t = text.trim();
  if (!t.endsWith("?") && !t.startsWith("¿")) return false;
  return /^(¿\s*)?(what|how|why|who|when|can i|do i|is it|qué|que|cómo|como|por qué|quién|cuándo|puedo|es )/i.test(t);
}
export function processReply(ids: Ids, text: string, resume: StoredTurn | null): StoredTurn {
  const hit = PROCESS_ANSWERS.find((p) => p.match.test(text))?.text
    ?? bi("Good question. In short, Precision asks one thing at a time and saves each answer, and you review everything before anything is sent.", "Buena pregunta. En resumen, Precision pregunta una cosa a la vez y guarda cada respuesta, y tú revisas todo antes de enviar nada.");
  const back = resume ? bi(` Back to the question: ${resume.text.en}`, ` Volviendo a la pregunta: ${resume.text.es}`) : bi("", "");
  return turn(ids, "assistant", "process_question", bi(hit.en + back.en, hit.es + back.es), { quickReplies: resume?.quickReplies, confirmCard: resume?.confirmCard });
}

const PENDING_ACCEPT = bi("That is fine, I will leave it as pending. You don't need to invent an answer.", "Está bien, lo dejo como pendiente. No necesitas inventar una respuesta.");

export interface StepInput { text: string; quickReply?: { value: string; intent: QuickReplyIntent }; confirm?: { token: string; intent: "confirm" | "correct" } }

export function lastQuestionTurn(iv: Interview): StoredTurn | null {
  for (let i = iv.turns.length - 1; i >= 0; i--) { const t = iv.turns[i]; if (t.role === "assistant" && (t.quickReplies || t.confirmCard) && t.kind !== "process_question") return t; }
  for (let i = iv.turns.length - 1; i >= 0; i--) { const t = iv.turns[i]; if (t.role === "assistant" && t.kind === "message") return t; }
  return null;
}

export interface InterviewCfg {
  scope: string;
  questions: QuestionFx[];
  /** When every question is asked: how the interview closes. */
  onComplete: (iv: Interview, ids: Ids) => StoredTurn[];
}

export function gap(iv: Interview, q: QuestionFx): boolean {
  const a = iv.answers[q.key];
  return !a || a.state === "unknown";
}
export function blockingGap(iv: Interview, qs: QuestionFx[]): QuestionFx | null {
  return qs.find((q) => q.blocking && gap(iv, q)) ?? null;
}

/** Runs one turn of an interview. Returns the assistant turns to append. */
export function interviewStep(iv: Interview, cfg: InterviewCfg, input: StepInput, ids: Ids): StoredTurn[] {
  const qs = cfg.questions;
  const find = (k: string | null) => qs.find((q) => q.key === k) ?? null;
  const resume = lastQuestionTurn(iv);
  iv.started = true;
  const structured = !!input.quickReply || !!input.confirm;
  if (isProcessQuestion(input.text, structured)) return [processReply(ids, input.text, resume)];

  // Final review of pending items.
  if (iv.stage === "pending_review") {
    const wantsNow = input.quickReply?.value === "complete_now";
    if (wantsNow) {
      const q = qs.find((x) => iv.answers[x.key]?.state === "unknown");
      if (q) { iv.stage = "asking"; iv.current = q.key; iv.asked = iv.asked.filter((k) => k !== q.key); return [askTurn(ids, cfg.scope, q, bi("Let's complete it.", "Vamos a completarlo."))]; }
    }
    iv.reviewDone = true;
    return finish(iv, cfg, ids);
  }

  if (iv.correcting) {
    const key = iv.correcting; iv.correcting = null;
    iv.answers[key] = { state: "answered", text: same(input.text.trim()) };
    if (!iv.asked.includes(key)) iv.asked.push(key);
    iv.current = null;
    return nextOrFinish(iv, cfg, ids, bi("Thank you, I updated it.", "Gracias, lo actualicé."));
  }

  const cur = find(iv.current) ?? (iv.stage === "done" ? blockingGap(iv, qs) : null);
  if (!cur) return nextOrFinish(iv, cfg, ids);

  if (input.confirm && cur.prefill) {
    if (input.confirm.intent === "correct") {
      iv.correcting = cur.key;
      return [turn(ids, "assistant", "message", bi("Understood. What is the correct value?", "Entendido. ¿Cuál es el valor correcto?"))];
    }
    iv.answers[cur.key] = { state: "answered", text: cur.prefill.value };
  } else if (input.quickReply?.intent === "unknown") {
    iv.answers[cur.key] = { state: "unknown", text: same("") };
  } else if (input.quickReply?.intent === "estimate") {
    iv.answers[cur.key] = { state: "assumed", text: same(input.text.trim()) };
  } else {
    iv.answers[cur.key] = { state: "answered", text: same(input.text.trim()) };
  }
  if (!iv.asked.includes(cur.key)) iv.asked.push(cur.key);
  iv.current = null;
  return nextOrFinish(iv, cfg, ids, iv.answers[cur.key].state === "unknown" ? PENDING_ACCEPT : undefined);
}

function nextOrFinish(iv: Interview, cfg: InterviewCfg, ids: Ids, lead?: Bi): StoredTurn[] {
  const next = cfg.questions.find((q) => !iv.asked.includes(q.key));
  if (next) { iv.current = next.key; iv.stage = "asking"; return [askTurn(ids, cfg.scope, next, lead)]; }
  const out = finish(iv, cfg, ids);
  if (lead && out.length) out[0] = { ...out[0], text: bi(`${lead.en} ${out[0].text.en}`, `${lead.es} ${out[0].text.es}`) };
  return out;
}

function finish(iv: Interview, cfg: InterviewCfg, ids: Ids): StoredTurn[] {
  const qs = cfg.questions;
  const pendings = qs.filter((q) => iv.answers[q.key]?.state === "unknown" && !q.blocking);
  const bg = blockingGap(iv, qs);
  if (bg && !iv.reasked) {
    iv.reasked = true; iv.current = bg.key; iv.stage = "asking"; iv.asked = iv.asked.filter((k) => k !== bg.key);
    return [askTurn(ids, cfg.scope, bg, bi("One point is critical for this category, so I ask it once more.", "Un punto es crítico para esta categoría, así que te lo pregunto una vez más."))];
  }
  if (pendings.length && !iv.reviewDone) {
    iv.stage = "pending_review"; iv.current = null;
    return [turn(ids, "assistant", "message", bi("Before we finish, a few points are pending. Do you want to confirm them now?", "Antes de terminar, quedan algunos puntos pendientes. ¿Quieres confirmarlos ahora?"), {
      quickReplies: [
        { value: "complete_now", label: bi("Complete now", "Completar ahora"), intent: "answer" },
        { value: "continue", label: bi("Continue with pending information", "Continuar con información pendiente"), intent: "answer" },
      ],
    })];
  }
  iv.stage = "done"; iv.current = null;
  if (bg) return [turn(ids, "assistant", "message", bi("I keep that point as a critical pending item. You can answer it whenever you can, and it stays visible in the summary.", "Dejo ese punto como pendiente crítico. Puedes responderlo cuando puedas y sigue visible en el resumen."))];
  return cfg.onComplete(iv, ids);
}

export function progressOf(iv: Interview, qs: QuestionFx[]) {
  const total = qs.length;
  const confirmed = qs.filter((q) => iv.answers[q.key]?.state === "answered").length;
  const pendingCount = qs.filter((q) => iv.answers[q.key]?.state === "unknown").length;
  const criticalOpen = qs.filter((q) => q.blocking && gap(iv, q)).length;
  const allAsked = qs.every((q) => iv.asked.includes(q.key));
  const ready = iv.stage === "done" && allAsked && criticalOpen === 0;
  return { progressPct: total === 0 ? null : Math.floor((100 * confirmed) / total), criticalOpen, pendingCount, ready, total, confirmed };
}

export { UNDERSTANDING_QUESTIONS };
