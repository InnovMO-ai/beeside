/**
 * Client corrections of the Understanding frame (from My Service Map): remove / restore a need, reword it ("wrong
 * interpretation"), set the CLIENT's priority, move it to another group, or give the reason. Pure and deterministic: the client's
 * decision is applied as stated; nothing is inferred beyond re-reading the client's new words with the same lexicon.
 */
import { conceptById } from "./concepts";
import { detectConcepts } from "./interpreter";
import { classifyPhrase } from "./need-explorer";
import { fold, squash } from "./text";
import type { Frame, NeedItem, PriorityGroup, PriorityRank } from "./types";

export type FrameEdit =
  | { op: "remove"; needId: string }
  | { op: "restore"; needId: string }
  | { op: "rename"; needId: string; text: string }
  | { op: "priority"; needId: string; rank: PriorityRank | null }
  | { op: "move"; needId: string; categoryKey: string }
  | { op: "why"; needId: string; text: string };

export type EditRejection = "unknown_need" | "not_a_service" | "empty";
export interface EditResult { frame: Frame; ok: boolean; reason?: EditRejection }

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function editFrame(prev: Frame, edit: FrameEdit, now: string, catalogKeys: ReadonlySet<string>): EditResult {
  const frame = clone(prev);
  const need = frame.needs.find((n) => n.id === edit.needId);
  if (!need) return { frame: prev, ok: false, reason: "unknown_need" };
  const was = need.text;

  switch (edit.op) {
    case "remove":
      need.status = "removed";
      need.note = "removed by the client";
      break;
    case "restore":
      need.status = "proposed";
      delete need.note;
      break;
    case "rename": {
      const text = squash(edit.text).slice(0, 140);
      if (text.length < 3) return { frame: prev, ok: false, reason: "empty" };
      const phrase = classifyPhrase(text);
      if (phrase.kind === "meta" || phrase.kind === "goods_item") return { frame: prev, ok: false, reason: "not_a_service" };
      need.text = text;
      need.quote = text;
      const { hits } = detectConcepts(text, fold(text));
      const concepts = hits.filter((h) => conceptById(h.id)?.kind === "need").map((h) => h.id);
      const def = concepts[0] ? conceptById(concepts[0]) : undefined;
      need.conceptIds = concepts;
      need.categoryKey = def?.category ?? null;
      need.serviceKeys = def?.services ?? need.serviceKeys;
      need.resolution = def?.category ? "resolved" : phrase.kind === "ambiguous" ? "ambiguous" : "unresolved";
      need.note = "reworded by the client";
      for (const c of concepts) if (!frame.concepts[c]) frame.concepts[c] = { first: text, origin: "client" };
      break;
    }
    case "move":
      if (!catalogKeys.has(edit.categoryKey)) return { frame: prev, ok: false, reason: "unknown_need" };
      need.categoryKey = edit.categoryKey;
      need.resolution = "resolved";
      need.note = "moved by the client";
      break;
    case "why": {
      const t = squash(edit.text).slice(0, 240);
      if (t.length < 3) return { frame: prev, ok: false, reason: "empty" };
      need.why = t;
      break;
    }
    case "priority": {
      const mine = new Set([need.id, ...need.conceptIds]);
      const groups: PriorityGroup[] = frame.priority.groups.map((g) => ({ ...g, subjects: g.subjects.filter((s) => !mine.has(s)) }));
      if (edit.rank) {
        let g = groups.find((x) => x.rank === edit.rank && !x.reason && !x.timing);
        if (!g) { g = { rank: edit.rank, subjects: [] }; groups.push(g); }
        g.subjects.push(need.id);
      }
      frame.priority = { status: "client_set", groups: groups.filter((g) => g.subjects.length > 0), at: now, askedCount: frame.priority.askedCount };
      break;
    }
  }
  if (need.origin === "discovery" && (edit.op === "remove" || edit.op === "rename")) {
    frame.changedSinceDiscovery.push({ key: `need:${need.id}`, from: was, to: edit.op === "remove" ? "" : need.text, at: now });
  }
  frame.version += 1;
  return { frame, ok: true };
}

export const needById = (frame: Frame, id: string): NeedItem | undefined => frame.needs.find((n) => n.id === id);
