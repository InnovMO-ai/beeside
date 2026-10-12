/**
 * Deterministic pre-router for process questions (Build Readiness §L-3). No model call: bilingual (ES/EN)
 * normalized patterns decide whether a client message is a question about HOW PRECISION WORKS (answered from the
 * Process Knowledge pack, writing nothing) or an answer to the pending question (goes to extraction).
 *
 * Result kinds:
 *  - "pack"             one or two pack topics matched;
 *  - "unknown"          it is clearly a question about the process/product but the pack has no fact for it
 *                       (honest "I can't confirm that" + resume);
 *  - "legal_unverified" a country-specific legal/regulatory question (R10: no approved source -> cannot confirm);
 *  - "none"             not a process question.
 *
 * A model-assisted fallback (`RouteRequest`) exists for ambiguous short questions, but the engine enables it only
 * by configuration: the default is the pure deterministic path (zero model calls for a process turn).
 */
import { isCountryLegalQuestion } from "../verifiers/country-claims";
import { normalizeText, wordCount } from "../text-utils";
import type { StateFlags, Surface } from "../types";
import { getTopic } from "./pack";

export type RouteKind = "pack" | "unknown" | "legal_unverified" | "none";

export interface RouteDecision {
  kind: RouteKind;
  /** At most two topic keys, in the order the client asked. */
  topicKeys: string[];
  /** The message also carries answer content (it is NOT processed as an answer; the pending question is resumed). */
  mixed: boolean;
  /** Which rule matched (diagnostics and tests). */
  rules: string[];
}

export interface RouteContext {
  surface: Surface;
  flags: StateFlags;
  extraCountryNames?: readonly string[];
}

const NONE: RouteDecision = { kind: "none", topicKeys: [], mixed: false, rules: [] };

// ------------------------------------------------------------------ question cue
const QUESTION_STARTERS =
  /^(?:y |and |pero |but |oye |hey |perdon |disculpa |una duda |una pregunta |quick question )?(?:que|cual|cuales|como|cuando|donde|quien|quienes|cuanto|cuantos|por que|para que|puedo|puedes|podemos|podria|podrian|se puede|existe|hay|sera|seran|tengo que|debo|what|which|how|when|where|who|why|can|could|do|does|did|is|are|will|would|should|explain|tell me|explicame|explica|dime|cuentame|ayudame a entender|i would like to know|me gustaria saber|quisiera saber|i want to know|quiero saber)\b/;

/** "I do not understand ..." is a request for help even without a question mark. */
const CLARIFY_STATEMENT = /^(?:no entiendo|no comprendo|no me queda claro|i (?:do not|don t|dont) (?:understand|get)\b|not sure (?:what|i understand))/;

function hasQuestionCue(raw: string, norm: string): boolean {
  return /[?¿]/.test(raw) || QUESTION_STARTERS.test(norm) || CLARIFY_STATEMENT.test(norm);
}

// ------------------------------------------------------------------ rules
interface Rule {
  id: string;
  re: RegExp;
  /** Extra condition on the clause (normalized). */
  also?: RegExp;
  topic: (ctx: RouteContext, clause: string) => string;
}

const CONFIRM_RE = /confirm\w*/;
const SEND_RE = /\b(?:envi\w*|mand\w*|sent|send\w*|submit\w*)\b/;
const MENTIONS_CRP = /\b(?:crp|category requirement packs?|paquetes? de requisitos?|requirement pack|resumen de (?:la |esta )?categoria)\b/;

const RULES: readonly Rule[] = [
  // --- legal/country handled before this table
  {
    id: "why_this_question",
    re: /\b(?:por que|para que)\b.{0,30}\b(?:pregunt\w*|pid\w*|necesit(?:as|an)|requier(?:es|en)|sirve|sirven|importa)\b|\bwhy\b.{0,22}\b(?:ask\w*|need\w*|important|relevant|matters?)\b|\bwhat (?:s|is) (?:this|that|the point of this)(?: question)? for\b|\bwhy this question\b/,
    topic: () => "why_this_question",
  },
  {
    // "I do not understand the question": the answer is the reason and help text of the pending question, then the question again.
    id: "clarify_question",
    re: /\b(?:no entiendo|no comprendo|no me queda claro|a que te refieres|que quieres decir|que quiere decir|me puedes (?:explicar|aclarar)|puedes (?:explicar|aclarar|repetir)\w*|podrias (?:explicar|aclarar)\w*|i (?:do not|don t|dont) (?:understand|get)\b|not sure (?:what|i understand)|what do you mean|what does that mean|what does this (?:question )?mean|can you (?:explain|clarify|rephrase)|could you (?:explain|clarify|rephrase)|explain (?:this|the) question)\b/,
    topic: () => "why_this_question",
  },
  {
    id: "pause_resume",
    re: /\b(?:parar|pausar|pausa|detener\w*|interrumpir|dejarlo|seguir|continuar|retomar|volver|stop\w*|pause|pausing|take a break|come back|continue|resume|pick (?:it|this) up|finish\w*|terminar\w*|answer\w*|responder\w*|contestar\w*)\b.{0,40}\b(?:despues|luego|mas tarde|mas adelante|otro dia|despues de|later|afterwards|another time|another day|tomorrow|manana)\b/,
    topic: () => "pause_and_resume",
  },
  {
    id: "skip_or_required",
    re: /\b(?:saltar\w*|omitir\w*|omitirla|skip\w*|no responder|not answer\w*|leave (?:it|this|this one|a question) (?:blank|empty|unanswered)|sin (?:responder|contestar))\b|\b(?:tengo que|debo|es obligatori\w*|es necesario|do i (?:have|need) to|must i|is it (?:required|mandatory|necessary))\b.{0,30}\b(?:contest\w*|respond\w*|answer\w*|todo|todas|tod[oa]s las|everything|all)\b/,
    topic: () => "pending_information",
  },
  {
    // Approved confidentiality answer (PO closure 12 Oct 2026). Security/"protected/secure" questions stay "unknown": no extra promises.
    id: "privacy_confidentiality",
    re: /\b(?:confidencial\w*|confidential\w*|privacidad|privacy|privad[oa]s?|private)\b/,
    also: /\b(?:informacion|datos|respuestas|detalles|proyecto|information|data|answers|details|project|esto|this|it|conversacion|conversation|correo|email|documentos?|documents?|nombres|names)\b/,
    topic: () => "privacy_confidentiality",
  },
  {
    id: "ai_use",
    re: /\b(?:inteligencia artificial|usan? (?:ia|ai)\b|usas (?:ia|ai)\b|eres (?:un |una )?(?:bot|robot|ia|humano|humana|persona)|hablo con (?:un |una )?(?:bot|robot|humano|persona|ia)|es (?:esto )?(?:una )?(?:ia|persona real|humano)|artificial intelligence|are you (?:a |an )?(?:bot|robot|ai|human|real person)|am i (?:talking|speaking) (?:to|with)|is this (?:an? )?(?:ai|bot|human|person)|do you use (?:ai|artificial))\b/,
    topic: () => "ai_use",
  },
  {
    id: "contact_timing",
    re: /\b(?:cuando|cuanto tiempo|en cuanto|how long|when)\b.{0,40}\b(?:contact\w*|escrib\w*|respond\w*|llam\w*|call\w*|reach\w*|get back|reply|beeside me|alguien|someone)\b/,
    topic: () => "contact_timing",
  },
  {
    id: "sherpa",
    re: /\bsherpas?\b/,
    topic: () => "sherpa_role",
  },
  {
    id: "confirmed_vs_sent",
    re: CONFIRM_RE,
    also: SEND_RE,
    topic: () => "confirmed_vs_sent",
  },
  {
    id: "preview",
    re: /\b(?:vista previa|preview|antes de (?:enviar|mandar)|before (?:i )?(?:send\w*|submit\w*))\b/,
    topic: () => "preview_before_send",
  },
  {
    id: "send_to_operation_hub",
    re: /\boperation hub\b.{0,40}\b(?:envi\w*|mand\w*|llega\w*|sent|send\w*|goes|go|deliver\w*|share\w*|compart\w*|recib\w*|receiv\w*)\b|\b(?:envi\w*|mand\w*|compart\w*|sent|send\w*|shared?|deliver\w*)\b.{0,40}\boperation hub\b|\bque se (?:envia|manda|comparte)\b|\bwhat (?:is|gets|will be|do you|will you|are you) (?:be )?(?:sent|send\w*|shared?|sharing)\b/,
    topic: () => "send_to_operation_hub",
  },
  {
    id: "confirm_after",
    re: /\b(?:que (?:pasa|pasara|va a pasar|ocurre|sigue|sucede|significa)|what (?:happens|will happen|does|comes|follows)|despues de|after|once i|cuando (?:lo |la )?confirm\w*|si (?:lo |la )?confirm\w*|if i confirm|what next)\b.{0,40}\bconfirm\w*|\bconfirm\w*.{0,30}\b(?:que (?:pasa|ocurre|sigue|significa)|what (?:happens|next|does it mean)|despues|afterwards|then)\b/,
    topic: (ctx, clause) => {
      if (MENTIONS_CRP.test(clause)) return "crp_confirmation";
      if (ctx.surface === "understanding") return "my_service_map_confirmation";
      if (ctx.surface === "add_service") return "requirement_destiny";
      return "crp_confirmation";
    },
  },
  {
    id: "requirement_destiny",
    re: /\b(?:que (?:pasa|va a pasar|ocurre|sucede|hacen|hacemos|se hace|haran|hara)\b.{0,22}\b(?:con )?(?:esto|este requisito|esta informacion|este dato|esa informacion|esa respuesta|mi respuesta|mis respuestas|lo que (?:te )?(?:digo|respondo|contesto)|esta respuesta|el requisito)|what (?:happens|will happen|do you do|are you doing)\b.{0,18}\b(?:with|to)\b.{0,6}\b(?:this|it|that|my answers?|this requirement|this information|the information|what i (?:say|answer|tell)|the requirement)|a donde (?:va|se va|llega)\b|where does (?:this|it|that|my answers?)\b.{0,10}\bgo\b|para que se usa|what is (?:this|it|my answer) used for|how (?:is|will) (?:this|it|my answers?) (?:be )?used)\b/,
    topic: () => "requirement_destiny",
  },
  {
    id: "changes",
    re: /\b(?:puedo|se puede|podria|podemos|can i|can we|could i|is it possible)\b.{0,30}\b(?:cambiar\w*|modificar\w*|editar\w*|corregir\w*|change\w*|edit\w*|modify|update|correct\w*|undo|reabrir|reopen)\b|\b(?:cambiar\w*|modificar\w*|editar\w*|change\w*|edit\w*)\b.{0,25}\b(?:despues|luego|mas adelante|later|afterwards|after)\b|\b(?:si cambia|if (?:it|something|anything) changes)\b/,
    topic: () => "changes_reopen_versioning",
  },
  {
    id: "pending_information",
    re: /\b(?:informacion pendiente|pending information|puntos pendientes|pending items?|dejarlo pendiente|leave it pending)\b|\b(?:que pasa|what happens|what if|y si)\b.{0,28}\b(?:no se|no lo se|no tengo|no sabemos|i don t know|i do not know|i don t have|not sure|no estoy seguro)\b/,
    topic: () => "pending_information",
  },
  {
    id: "documents",
    re: /\b(?:documentos?|archivos?|adjuntar|adjunto|subir|cargar|upload\w*|attach\w*|documents?|files?|comprobantes?|evidencias?|evidence|constancias?)\b/,
    topic: () => "documents_boundary",
  },
  {
    id: "add_a_service",
    re: /\b(?:add a service|add service|agregar (?:un )?servicio|anadir (?:un )?servicio|agregar mas servicios|can i add\b.{0,24}\b(?:service|more)|puedo (?:agregar|anadir)\b.{0,24}\b(?:servicio|mas))\b/,
    topic: () => "add_a_service",
  },
  {
    id: "precision_by_category",
    re: /\b(?:precision by category|precision por categoria)\b/,
    topic: () => "precision_by_category",
  },
  {
    id: "precision_understanding",
    re: /\b(?:precision understanding|understanding)\b/,
    topic: () => "precision_understanding",
  },
  {
    id: "my_service_map",
    re: /\b(?:my service map|service map|mi mapa de servicios|mapa de servicios|mi mapa|my map)\b/,
    topic: () => "my_service_map",
  },
  {
    id: "crp",
    re: MENTIONS_CRP,
    topic: () => "category_requirement_pack",
  },
  {
    id: "operation_hub",
    re: /\boperation hub\b/,
    topic: () => "operation_hub_boundary",
  },
  {
    id: "precision_center",
    re: /\b(?:precision center|centro de precision|que es (?:esto|precision|este (?:lugar|espacio|sitio|centro))|what is (?:this|precision)(?: place| space| tool)?|para que sirve (?:esto|precision|este)|how does (?:this|precision) work|como funciona (?:esto|precision))\b/,
    topic: () => "precision_center",
  },
  {
    id: "help",
    re: /\b(?:ayuda|help|soporte|support|contactar a beeside|contact beeside|hablar con (?:alguien|una persona|beeside)|speak (?:to|with) (?:someone|a person|beeside)|talk to (?:someone|a person|beeside)|preguntas frecuentes|faq)\b/,
    topic: () => "general_help",
  },
];

/** Questions about the product/process that the pack has no approved fact for (answered "I can't confirm that"). */
const PROCESS_ANCHOR = /\b(?:precision|beeside|operation hub|este proceso|el proceso|esta plataforma|la plataforma|this process|the process|this platform|the platform|premium|esto|this|el servicio|este servicio|your service|tu servicio|ustedes|you guys)\b/;
const PROCESS_PHRASES = /\b(?:como funciona(?:n)?\s+(?:esto|precision|el proceso)|how does (?:it|this|precision) work|que sigue|what s next|what comes next|que viene despues|siguiente paso|next step|quien (?:ve|puede ver)\s+(?:mis|mi|esto)|who (?:sees|can see)\s+(?:my|this)|mis datos|my data)\b/;
const PROCESS_COST_TIME = /\b(?:cuanto (?:cuesta|cuestan|cobran|tarda|tardan|dura|demora)|how (?:much|long)|precio|price|pricing|tarifa|fee|honorarios|garantia|guarantee|privacidad|privacy|confidencial\w*|seguridad|security|cancelar|cancel)\b/;

/** Privacy words: confidentiality/privacy questions are answered by the approved pack topic (rule "privacy_confidentiality"); security/protection questions have no approved fact, so they get "I can't confirm that". */
const PRIVACY_RE = /\b(?:confidencial\w*|confidential\w*|privacidad|privacy|privad[oa]s?|private|protegid\w*|protected|secure|secret\w*)\b/;
const PRIVACY_SUBJECT = /\b(?:informacion|datos|respuestas|detalles|proyecto|information|data|answers|details|project|esto|this)\b/;

function isProcessLike(norm: string): boolean {
  if (PRIVACY_RE.test(norm) && PRIVACY_SUBJECT.test(norm)) return true;
  if (PROCESS_PHRASES.test(norm)) return true;
  if (/\b(?:precision|beeside|operation hub|premium)\b/.test(norm)) return true;
  return PROCESS_COST_TIME.test(norm) && PROCESS_ANCHOR.test(norm);
}

// ------------------------------------------------------------------ clause handling
function splitClauses(raw: string): string[] {
  const lowered = raw.replace(/\s+/g, " ").trim();
  const sentences = lowered.split(/(?<=[.?!…])\s+|[¿]/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  const joiner = /\s+(?:y|and|además|ademas|also|tambien|también)\s+(?=(?:qu[eé]|cu[aá]l(?:es)?|c[oó]mo|cu[aá]ndo|d[oó]nde|qui[eé]n|por qu[eé]|para qu[eé]|puedo|what|how|when|why|can|who|where|will|does|do|is)(?![\p{L}]))/iu;
  for (const s of sentences) for (const part of s.split(joiner)) if (part.trim()) out.push(part.trim());
  return out;
}

function matchRule(ctx: RouteContext, clauseNorm: string): { rule: Rule; topic: string } | null {
  for (const rule of RULES) {
    if (!rule.re.test(clauseNorm)) continue;
    if (rule.also && !rule.also.test(clauseNorm)) continue;
    return { rule, topic: rule.topic(ctx, clauseNorm) };
  }
  return null;
}

/** Deterministic routing of one client message. */
export function routeProcessQuestion(text: string, ctx: RouteContext): RouteDecision {
  const raw = text.trim();
  if (raw.length === 0) return NONE;
  const fullNorm = normalizeText(raw);

  // R10: a country-specific legal question can never be answered from the pack.
  if (isCountryLegalQuestion(raw, ctx.extraCountryNames ?? [])) {
    return { kind: "legal_unverified", topicKeys: [], mixed: false, rules: ["legal_country"] };
  }

  const clauses = splitClauses(raw);
  const topicKeys: string[] = [];
  const rules: string[] = [];
  let processClauses = 0;
  let otherWords = 0;
  let unmatchedQuestionClauses = 0;

  for (const clause of clauses) {
    const norm = normalizeText(clause);
    const isQuestion = hasQuestionCue(clause, norm);
    const hit = isQuestion ? matchRule(ctx, norm) : null;
    if (hit) {
      processClauses += 1;
      const topic = getTopic(hit.topic);
      if (topic && topic.status !== "blocked") {
        if (!topicKeys.includes(hit.topic) && topicKeys.length < 2) topicKeys.push(hit.topic);
        rules.push(hit.rule.id);
      } else {
        rules.push(`${hit.rule.id}:blocked`);
      }
    } else if (isQuestion && isProcessLike(norm)) {
      unmatchedQuestionClauses += 1;
      rules.push("process_like");
    } else if (isQuestion) {
      // A follow-on clause such as "y cuando aparece?" belongs to the question already matched.
      if (processClauses > 0 && wordCount(clause) <= 6) continue;
      otherWords += wordCount(clause);
    } else {
      otherWords += wordCount(clause);
    }
  }

  if (topicKeys.length > 0) {
    return { kind: "pack", topicKeys, mixed: otherWords >= 5, rules };
  }
  if (processClauses > 0 || unmatchedQuestionClauses > 0) {
    // Matched a blocked topic, or a process-like question the pack cannot answer.
    return { kind: "unknown", topicKeys: [], mixed: otherWords >= 5, rules };
  }
  void fullNorm;
  return NONE;
}

/** True when the message looks like a short, ambiguous question where a model-assisted route may help. */
export function isAmbiguousQuestion(text: string): boolean {
  const raw = text.trim();
  const norm = normalizeText(raw);
  return hasQuestionCue(raw, norm) && wordCount(raw) <= 25 && wordCount(raw) >= 3;
}
