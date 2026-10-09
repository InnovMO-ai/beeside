/**
 * Composes the answer to a process question from the Process Knowledge pack (Build Readiness §L-4):
 * brief (<= ~60 words), only pack facts, state-aware (variants), canonical terms, and always followed by the
 * SAME pending question the client had in front of them. Writes nothing.
 */
import { copyText } from "../copy";
import { collapseWhitespace, wordCount } from "../text-utils";
import type { Locale, StateFlags, Surface } from "../types";
import { getTopic, PACK_VERSION, type PackTopic, type PackVariant, type ProcessFlags } from "./pack";
import { CRP_FULL, CRP_SHORT, expandCrpToken } from "./term-registry";

export const MAX_ANSWER_WORDS = 66;

export interface ProcessAnswer {
  /** The pack part only (no resume line). */
  answerText: string;
  /** Pack part + resume line (what the client sees). */
  text: string;
  topicKeys: string[];
  factIds: string[];
  sourceRefs: string[];
  introduced: Set<string>;
  packVersion: string;
  copyKeys: string[];
  /** True when some requested topic could not be served (blocked or empty) and the honest copy was used. */
  usedUnknownCopy: boolean;
}

function specificity(v: PackVariant): number {
  return Object.keys(v.when).length;
}

function variantMatches(v: PackVariant, flags: ProcessFlags): boolean {
  return (Object.entries(v.when) as [keyof ProcessFlags, unknown][]).every(([k, want]) => flags[k] === want);
}

/** The most specific state variant that applies, or the base sentences. */
export function selectSentences(topic: PackTopic, locale: Locale, flags: ProcessFlags): { sentences: string[]; factIds: string[] } {
  const applicable = topic.variants.filter((v) => variantMatches(v, flags)).sort((a, b) => specificity(b) - specificity(a));
  const v = applicable[0];
  if (v) return { sentences: [...v.sentences[locale]], factIds: v.factIds };
  return { sentences: [...topic.sentences[locale]], factIds: topic.factIds };
}

export interface ComposeInput {
  topicKeys: string[];
  locale: Locale;
  surface: Surface;
  flags: StateFlags;
  /** Manifest help text for the field being asked ({reason}); sentences needing it are dropped when absent. */
  reason: string | null;
  introduced: ReadonlySet<string>;
  /** Exact text of the pending question, or null when there is none. */
  pendingQuestion: string | null;
}

export function lastQuestionOf(text: string): string | null {
  const sentences = text.split(/(?<=[.?!…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i] as string;
    if (/[?¿]/.test(s)) {
      // Spanish: keep the leading inverted mark with the sentence (the splitter already keeps it).
      return s;
    }
  }
  return null;
}

export function resumeLine(locale: Locale, pendingQuestion: string | null): { text: string; copyKey: string } {
  if (pendingQuestion && pendingQuestion.trim().length > 0) {
    const lead = copyText("process_resume_lead", locale).text;
    // The pending question was already shown, so any CRP mention in it is no longer a first mention.
    const question = pendingQuestion.trim().split(CRP_FULL).join(CRP_SHORT);
    return { text: `${lead} ${question}`, copyKey: "process_resume_lead" };
  }
  return { text: copyText("process_resume_none", locale).text, copyKey: "process_resume_none" };
}

export function composeUnknownAnswer(locale: Locale, pendingQuestion: string | null, copyKey: "process_unknown" | "r10_cannot_confirm"): ProcessAnswer {
  const body = copyText(copyKey, locale).text;
  const resume = resumeLine(locale, pendingQuestion);
  return {
    answerText: body,
    text: collapseWhitespace(`${body} ${resume.text}`),
    topicKeys: [],
    factIds: [],
    sourceRefs: [],
    introduced: new Set(),
    packVersion: PACK_VERSION,
    copyKeys: [copyKey, resume.copyKey],
    usedUnknownCopy: true,
  };
}

/** Answers from the pack. Falls back to the honest "can't confirm" copy when nothing can be served. */
export function composeProcessAnswer(input: ComposeInput): ProcessAnswer {
  const flags: ProcessFlags = { ...input.flags, surface: input.surface };
  const picked: { topic: PackTopic; sentences: string[]; factIds: string[] }[] = [];
  for (const key of input.topicKeys.slice(0, 2)) {
    const topic = getTopic(key);
    if (!topic || topic.status === "blocked") continue;
    const sel = selectSentences(topic, input.locale, flags);
    const sentences = sel.sentences
      .map((s) => {
        if (s.includes("{reason}")) return input.reason ? s.replace("{reason}", input.reason) : "";
        return s;
      })
      .filter((s) => s.trim().length > 0);
    if (sentences.length > 0) picked.push({ topic, sentences, factIds: sel.factIds });
  }
  if (picked.length === 0) return composeUnknownAnswer(input.locale, input.pendingQuestion, "process_unknown");

  // Merge: with two topics keep up to two sentences of each; then trim the tail to the word budget.
  const perTopic = picked.length === 1 ? 3 : 2;
  const lines: { topicIdx: number; s: string }[] = [];
  picked.forEach((p, i) => p.sentences.slice(0, perTopic).forEach((s) => lines.push({ topicIdx: i, s })));
  const total = (): number => lines.reduce((n, l) => n + wordCount(l.s), 0);
  while (total() > MAX_ANSWER_WORDS && lines.length > picked.length) {
    // Drop the last sentence of the topic that currently has the most sentences (never the first of a topic).
    const counts = picked.map((_, i) => lines.filter((l) => l.topicIdx === i).length);
    const idx = counts.indexOf(Math.max(...counts));
    for (let j = lines.length - 1; j >= 0; j--) {
      if ((lines[j] as { topicIdx: number }).topicIdx === idx) {
        lines.splice(j, 1);
        break;
      }
    }
  }
  const joined = lines.map((l) => l.s).join(" ");
  const expanded = expandCrpToken(joined, input.introduced);

  // mustNotSay guard: a violation means the pack text itself is wrong; never serve it.
  for (const p of picked) {
    for (const pat of p.topic.mustNotSay) {
      if (new RegExp(pat, "iu").test(expanded.text)) return composeUnknownAnswer(input.locale, input.pendingQuestion, "process_unknown");
    }
  }

  const resume = resumeLine(input.locale, input.pendingQuestion);
  const answerText = collapseWhitespace(expanded.text);
  return {
    answerText,
    text: collapseWhitespace(`${answerText} ${resume.text}`),
    topicKeys: picked.map((p) => p.topic.topicKey),
    factIds: picked.flatMap((p) => p.factIds),
    sourceRefs: [...new Set(picked.flatMap((p) => p.topic.facts.filter((f) => p.factIds.includes(f.factId)).map((f) => f.sourceRef)))],
    introduced: expanded.introduced,
    packVersion: PACK_VERSION,
    copyKeys: [resume.copyKey],
    usedUnknownCopy: false,
  };
}
