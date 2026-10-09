/** Conversation drivers and the customer-safety scan shared by the Precision API suites. */
import { FORBIDDEN_INTERNAL_TERMS, UNAPPROVED_VARIANTS } from "../../conversation/process-knowledge/term-registry";
import type { ApiClient, Seen } from "./harness";

export interface TurnLike { role: string; kind?: string; text: string; quickReplies?: Array<{ value: string; intent: string; label: string }>; confirmCard?: { token: string } }

/** The answer a patient client would give to each Understanding question (driven by the question wording). */
function answerFor(question: string): { text: string } | { quick: { value: string; intent: string } } {
  const q = question.toLowerCase();
  if (q.includes("product or service")) return { text: "Packaged foods and beverages" };
  if (q.includes("company or entity")) return { text: "Harness Foods Mexico S.A. de C.V." };
  if (q.includes("start")) return { text: "April 2027" };
  if (q.includes("achieve")) return { text: "Open a distribution hub for our packaged foods" };
  if (q.includes("countr")) return { text: "Mexico" };
  return { quick: { value: "unknown", intent: "unknown" } };
}

let counter = 0;
export const key = (tag: string): string => `${tag}-${Date.now().toString(36)}-${(counter++).toString(36)}`.slice(0, 100).padEnd(12, "x");

/** Answers the Understanding conversation until the engine says it is ready to confirm. Returns the last thread state. */
export async function completeUnderstanding(api: ApiClient, maxTurns = 14): Promise<{ state: string; turns: TurnLike[] }> {
  let thread = (await api.get("/understanding")).body as { understandingState: string; turns: TurnLike[] };
  let state = thread.understandingState;
  let turns = thread.turns;
  for (let i = 0; i < maxTurns && state !== "ready_to_confirm" && state !== "confirmed"; i++) {
    const last = [...turns].reverse().find((t) => t.role === "assistant" && t.kind !== "disclosure") ?? turns[turns.length - 1]!;
    const body: Record<string, unknown> = { turnKey: key("u") };
    if (last.confirmCard) Object.assign(body, { text: "", confirm: { token: last.confirmCard.token, intent: "confirm" } });
    else {
      const a = answerFor(last.text);
      if ("text" in a) body.text = a.text;
      else Object.assign(body, { text: "", quickReply: a.quick });
    }
    const r = await api.post("/understanding/turns", body);
    if (r.status !== 200) throw new Error(`understanding turn failed: ${r.status} ${JSON.stringify(r.body)}`);
    state = (r.body as { understandingState: string }).understandingState;
    const t = (r.body as { turns: TurnLike[] }).turns;
    if (t.some((x) => x.role === "assistant")) turns = t;
  }
  return { state, turns };
}

export async function confirmMap(api: ApiClient, requestKey = key("confirm")): Promise<{ status: number; body: any }> {
  const r = await api.post("/service-map/confirm", { requestKey });
  return { status: r.status, body: r.body };
}

/** Reaches a confirmed My Service Map and returns the category cards by label. */
export async function confirmedProject(api: ApiClient): Promise<Record<string, any>> {
  const u = await completeUnderstanding(api);
  if (u.state !== "ready_to_confirm" && u.state !== "confirmed") throw new Error(`understanding did not complete: ${u.state}`);
  const c = await confirmMap(api);
  if (c.status !== 200) throw new Error(`confirm failed: ${c.status} ${JSON.stringify(c.body)}`);
  const center = (await api.get("/center")).body as { categories: Array<{ label: string }> };
  return Object.fromEntries(center.categories.map((x) => [x.label, x]));
}

/** Add a Service: describe a need, then confirm it. Returns the confirm answer. */
export async function addNeed(api: ApiClient, need: string, tag = key("add")): Promise<{ status: number; body: any }> {
  const a1 = await api.post("/add-service/turns", { turnKey: `${tag}-1`.padEnd(12, "x"), text: need });
  const card = (a1.body.turns as TurnLike[]).find((t) => t.confirmCard)?.confirmCard;
  if (!card) throw new Error(`no confirmation asked for "${need}": ${JSON.stringify(a1.body)}`);
  const a2 = await api.post("/add-service/turns", { turnKey: `${tag}-2`.padEnd(12, "x"), text: "", confirm: { token: card.token, intent: "confirm" } });
  return { status: a2.status, body: a2.body };
}

// ------------------------------------------------------------------ customer safety
const SKIP_KEYS = new Set(["id", "token", "scopeId", "categoryId", "iconKey", "createdAt", "asOf", "confirmedAt", "expiresAt", "sessionToken", "turnKey", "url", "helpCenterUrl", "kind", "state", "status", "surface", "role", "composition", "mode", "screen", "intent", "error", "locale", "sendState", "priority", "value", "code", "readOnlyUntil", "contactUrl"]);

function collect(value: unknown, key: string | null, out: string[]): void {
  if (typeof value === "string") {
    if (key === null || !SKIP_KEYS.has(key)) out.push(value);
  } else if (Array.isArray(value)) for (const v of value) collect(v, key, out);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) collect(v, k, out);
}

/** Every forbidden internal term found in the text values of the recorded customer responses. */
export function internalTermsIn(seen: readonly Seen[]): string[] {
  const hits: string[] = [];
  for (const s of seen) {
    const texts: string[] = [];
    collect(s.body, null, texts);
    for (const t of texts) {
      for (const f of FORBIDDEN_INTERNAL_TERMS) if (f.pattern.test(t)) hits.push(`${f.id} in ${s.method} ${s.path}: ${t.slice(0, 120)}`);
      for (const f of UNAPPROVED_VARIANTS) if (f.pattern.test(t)) hits.push(`${f.id} in ${s.method} ${s.path}: ${t.slice(0, 120)}`);
    }
  }
  return hits;
}
