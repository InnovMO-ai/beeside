/**
 * Test harness: drives the Understanding pipeline (interpret -> step) with a scripted or persona-driven simulated client and
 * verifies EVERY assistant text with the same deterministic verifiers the production engine uses.
 */
import { verifyAssistantText, type Violation } from "../../conversation/verifiers";
import { evaluateDepth, type Depth } from "../depth";
import { computeFindings } from "../findings";
import { interpretByRules } from "../interpreter";
import { seedFromDiscovery, type DiscoverySeedInput } from "../seed";
import { emptyFrame, type Finding, type Frame, type Loc } from "../types";
import { plan, promptFor, step, type Action, type QuickValue, type StepResult } from "../step";

export const NOW = "2026-10-14T10:00:00.000Z";

export interface Turn { client: string; askedProbe: string | null; askedProbeResolved: boolean; bot: string; action: Action; changes: StepResult["changes"]; violations: Violation[] }

export class Conv {
  frame: Frame;
  last: Action | null = null;
  transcript: Turn[] = [];
  opening: string;
  private n = 0;
  constructor(public readonly locale: Loc, seed?: DiscoverySeedInput | null) {
    this.frame = seed ? seedFromDiscovery(seed, NOW).frame : emptyFrame(locale);
    const first = plan(this.frame, evaluateDepth(this.frame), locale);
    this.opening = promptFor(this.frame, first, locale).text;
    this.last = first;
  }

  say(input: string | { quick: QuickValue }, extra?: { text?: string }): StepResult & { violations: Violation[] } {
    this.n += 1;
    const quick = typeof input === "string" ? null : input.quick;
    const text = typeof input === "string" ? input : extra?.text ?? "";
    const asked = this.last?.kind === "ask_probe" ? this.last.probeKey : null;
    const interp = interpretByRules({ text, locale: this.locale, frame: this.frame, asked, source: "client" });
    const r = step({ frame: this.frame, text, interp, lastAction: this.last, quick, now: NOW, turnKey: `turn-${this.n}` });
    this.frame = r.frame;
    this.last = r.action;
    const violations = verifyAssistantText(r.text, {
      locale: this.locale, surface: "understanding", introducedTerms: new Set(), sherpaAssigned: false, allowSherpaGeneral: false, approvedSources: [],
      questions: r.action.kind === "ready" ? "none" : "one",
    });
    // The checkpoint summary lives in a card; its body is verified too (no question, no forbidden wording) — length is a conversation-text rule.
    if (r.card) violations.push(...verifyAssistantText(r.card.body, { locale: this.locale, surface: "understanding", introducedTerms: new Set(), sherpaAssigned: false, allowSherpaGeneral: false, approvedSources: [], questions: "none" }).filter((v) => v.code !== "too_long"));
    const askedProbe = r.action.kind === "ask_probe" ? r.action.probeKey : null;
    const askedProbeResolved = askedProbe ? evaluateDepth(r.frame).statuses.some((x) => x.probe.key === askedProbe && x.state === "resolved") : false;
    this.transcript.push({ askedProbe, askedProbeResolved, client: typeof input === "string" ? input : `[${input.quick}]`, bot: r.text, action: r.action, changes: r.changes, violations });
    return { ...r, violations };
  }

  get depth(): Depth { return evaluateDepth(this.frame); }
  findings(): Finding[] { return computeFindings(this.frame, NOW); }
  /** Probe keys the assistant asked, in order. */
  asked(): string[] { return this.transcript.filter((t) => t.action.kind === "ask_probe").map((t) => (t.action as { probeKey: string }).probeKey); }
  critical(): Violation[] { return this.transcript.flatMap((t) => t.violations).filter((v) => v.critical); }
}

export interface Persona {
  opening: string;
  /** Answer by probe key; a missing key means the client does not know. */
  answers: Record<string, string>;
  /** Answer to the priority question. */
  priority?: string;
  /** Reply to an implied-need offer: yes | no. */
  implied?: "yes" | "no";
  /** Reply to a need clarification question (by need text fragment). */
  clarify?: Record<string, string>;
  /** Free text to answer any question we have no key for. */
  fallback?: string;
}

export interface PersonaRun { conv: Conv; turns: number; completed: boolean }

export function runPersona(locale: Loc, seed: DiscoverySeedInput | null, p: Persona, maxTurns = 40): PersonaRun {
  const conv = new Conv(locale, seed);
  let r = conv.say(p.opening);
  let guard = 0;
  while (!r.ready && guard < maxTurns) {
    guard += 1;
    const a = r.action;
    let reply: string | { quick: QuickValue };
    switch (a.kind) {
      case "ask_probe": reply = p.answers[a.probeKey] ?? (locale === "es" ? "Todavía no lo sé." : "I do not know yet."); break;
      case "ask_priority": reply = p.priority ?? (locale === "es" ? "Todo es igual de importante." : "Everything is equally important."); break;
      case "offer_implied": reply = { quick: p.implied === "no" ? "no" : "yes" }; break;
      case "checkpoint": reply = { quick: "ok" }; break;
      case "clarify_need": reply = (p.clarify && Object.entries(p.clarify).find(([k]) => conv.frame.needs.find((n) => n.id === a.needId)?.text.toLowerCase().includes(k))?.[1]) || p.fallback || (locale === "es" ? "Es algo que necesitamos para operar." : "It is something we need to operate."); break;
      case "clarify_conflict": reply = { quick: "new" }; break;
      default: reply = p.fallback ?? (locale === "es" ? "No tengo más detalle." : "I have no more detail.");
    }
    r = conv.say(reply);
  }
  return { conv, turns: conv.transcript.length, completed: r.ready };
}
