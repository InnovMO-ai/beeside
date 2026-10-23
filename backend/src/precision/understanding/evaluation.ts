/**
 * Evaluation of an Understanding conversation, as measurable gates (not impressions):
 *   P — conversational quality: no repeated question, no re-asking what is already known, no repeated openings, nothing too long
 *   Q — depth / sufficiency: Understanding is ready exactly when the MATERIAL aspects of THIS project are understood (no generic %)
 * Pure: used by the acceptance suite and available to production monitoring (no conversation text is stored by it).
 */
import { evaluateDepth } from "./depth";
import { computeFindings } from "./findings";
import type { Frame } from "./types";

export interface TurnRecord { bot: string; askedProbe: string | null; askedProbeResolved: boolean }

export interface QualityIssue { code: "repeated_question" | "reasked_known" | "repeated_opening" | "too_long"; turn: number; detail: string }

const firstWords = (t: string, n = 2): string => t.toLowerCase().replace(/[^\p{L}\s]/gu, "").trim().split(/\s+/).slice(0, n).join(" ");
const questionOf = (t: string): string => (t.match(/[^.!?¿]*\?/g) ?? []).pop()?.trim().toLowerCase() ?? "";

/** P gate. `maxRun` = how many consecutive turns may start with the same words. */
export function conversationQuality(turns: readonly TurnRecord[], maxRun = 2): QualityIssue[] {
  const out: QualityIssue[] = [];
  const recent: string[] = [];
  let run = 1;
  turns.forEach((t, i) => {
    if (t.bot.length > 1400) out.push({ code: "too_long", turn: i, detail: `${t.bot.length} chars` });
    const q = questionOf(t.bot);
    if (q && recent.slice(-3).includes(q)) out.push({ code: "repeated_question", turn: i, detail: q.slice(0, 80) });
    if (q) recent.push(q);
    if (t.askedProbe && t.askedProbeResolved) out.push({ code: "reasked_known", turn: i, detail: t.askedProbe });
    if (i > 0 && firstWords(t.bot) === firstWords(turns[i - 1]!.bot) && firstWords(t.bot) !== "") { run += 1; if (run > maxRun) out.push({ code: "repeated_opening", turn: i, detail: firstWords(t.bot) }); } else run = 1;
  });
  return out;
}

export interface DepthReport {
  applicableMaterial: number;
  resolvedMaterial: number;
  openMaterial: string[];
  /** Said "I do not know" / undecided / preferred not to say: honest knowledge handed to the specialist. */
  forSpecialist: string[];
  needs: { active: number; unresolved: number };
  priority: "client_set" | "not_needed" | "open";
  /** The final representation holds something Discovery did not (client-stated facts, findings). */
  beyondDiscovery: { facts: number; findings: number };
  ready: boolean;
  blockers: string[];
}

export function depthReport(frame: Frame, now: string): DepthReport {
  const d = evaluateDepth(frame);
  const active = frame.needs.filter((n) => n.status !== "removed");
  return {
    applicableMaterial: d.totalMaterial,
    resolvedMaterial: d.resolvedMaterial,
    openMaterial: d.openMaterial.map((s) => s.probe.key),
    forSpecialist: d.statuses.filter((s) => s.item && ["unknown", "withheld", "undecided"].includes(s.item.status)).map((s) => s.probe.key),
    needs: { active: active.length, unresolved: d.needsClarification.length },
    priority: frame.priority.status === "client_set" ? "client_set" : d.priorityDone ? "not_needed" : "open",
    beyondDiscovery: { facts: Object.values(frame.items).filter((i) => i.status === "known" && i.provenance !== "discovery").length, findings: computeFindings(frame, now).length },
    ready: d.ready,
    blockers: d.blockers,
  };
}

/** Q gate: "ready" and "no blocker left" are the same statement, and substance is never zero. */
export function sufficiencyIssues(r: DepthReport): string[] {
  const out: string[] = [];
  if (r.ready && r.openMaterial.length > 0) out.push("ready_with_open_material");
  if (r.ready && r.needs.unresolved > 0) out.push("ready_with_unclarified_need");
  if (r.ready && r.priority === "open") out.push("ready_without_client_priority");
  if (r.ready && r.needs.active === 0) out.push("ready_without_needs");
  if (!r.ready && r.blockers.length === 0) out.push("not_ready_without_reason");
  return out;
}
