/**
 * Deterministic tone checks R1, R2, R3, R4, R7 (Voice Pack F2 §4), ported from the Gate D copy-lint
 * (docs/f5/source/gate-d/validator/copy-lint.mjs). Differences from the Gate D linter, all deliberate:
 *   - "de una" (T-1 false positive, "dueño de una empresa") is flagged only as a stand-alone colloquial reply.
 *   - English colloquialisms and English quality judgments are checked for the `en` locale.
 *   - "Core" is matched case-sensitively so the ordinary word "core" is not flagged.
 *   - "listas" (plural) joins the "listo/lista" family.
 */
import { splitSentences, stripPlaceholders, wordCount } from "../text-utils";
import type { Violation, VerifyContext } from "./types";

const WB = (w: string, flags = "iu"): RegExp => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${w})(?![\\p{L}\\p{N}_])`, flags);

const R1_RE = WB("usted|ustedes|vos|tenés|querés|podés|sos|vosotros");

const R2_ES_WORDS = WB("ahorita|chévere|chevere|órale|orale|chido|guay|bacán|bacan|súper|super|genial|perfecto|vale|qué padre|muy padre");
const R2_DE_UNA = /(?<![\p{L}\p{N}_])de una(?=\s*[.,;:!?¡]|\s*$)/iu;
const R2_EN_WORDS = WB("awesome|cool|amazing|fantastic|no worries|gotcha|hey|oops|wow|super|perfect|great job|well done");
/** English filler that echoes a bare yes/no back ("Noted, no on that one"): the acknowledgement must not parrot the answer. */
const R2_EN_YESNO_ECHO = /(?<![\p{L}\p{N}_])(?:noted|got it|understood)[,:.]?\s+(?:no|yes)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])no on that one(?![\p{L}\p{N}_])/iu;
const R2_SYMBOLS = /!|¡|\p{Extended_Pictographic}/u;

const R7_ES = WB(
  "listo|lista|listos|listas|validado|validada|validados|validadas|calificado|calificada|calificados|calificadas|excelente|excelentes|AAA|provider-ready|RFI|RFP|RFQ|SOW|ClickUp|Add Category|reabrir|reabierto|reopen|Strategic Advisory Brief|Unmapped Service|New Category|Discovery|Out of Scope|scenario|readiness score|On-Demand|SOURCEABLE|NOT_OFFERED|no tenemos ese servicio",
);
const R7_CORE = /(?<![\p{L}\p{N}_])Core(?![\p{L}\p{N}_])/u;
const R7_EN_QUALITY = new RegExp(
  [
    WB("excellent|outstanding|validated|qualified|well-qualified|provider-ready|production-ready").source,
    "|(?<![\\p{L}\\p{N}_])(?:your|the)\\s+(?:project|business|company|category|plan)\\s+(?:is|looks)\\s+(?:ready|great|solid|strong)(?![\\p{L}\\p{N}_])",
    "|(?:^|[.?]\\s+)great(?![\\p{L}\\p{N}_])",
    "|(?<![\\p{L}\\p{N}_])ready to quote(?![\\p{L}\\p{N}_])",
    "|(?<![\\p{L}\\p{N}_])we (?:do not|don't) have that service(?![\\p{L}\\p{N}_])",
  ].join(""),
  "iu",
);
const BRAND_CAP = /(?<![\p{L}])Beeside(?![\p{L}])/u;
const HIVE = /(?<![\p{L}])(?:the hive|Hive)(?![\p{L}])/u;

/** PO-approved customer-facing labels: exact-match exemption from R7 (never from the other rules). */
export const APPROVED_STATE_LABELS: ReadonlySet<string> = new Set(["Datos validados"]);

/** PO-approved verbatim texts: exempt from the R4 length heuristic only. */
export const APPROVED_VERBATIM: ReadonlySet<string> = new Set([
  "Nos ayuda a entender la escala real de tu empresa y dimensionar mejor los servicios que puede requerir tu expansión.",
  "It helps us understand the real scale of your company and better size the services your expansion may require.",
  "Now that I understand your expansion project, I'd like to complete a few company details that will help us prepare the next steps and avoid asking for the same information again later.",
  "Precision usa inteligencia artificial para ayudarte a estructurar tu proyecto. Si algo de lo que entiende no es correcto, puedes corregirlo en cualquier momento.",
  "Precision uses artificial intelligence to help structure your project. If anything it understands is not correct, you can correct it at any time.",
  "La información de tu proyecto se utiliza para estructurar tu expansión y se comparte únicamente cuando corresponde avanzar la ejecución. Precision no envía a Operation Hub el historial de conversación, correo, nombres de personas ni documentos; antes de enviar un Category Requirement Pack (CRP), puedes revisar exactamente qué información se compartirá.",
  "Your project information is used to structure your expansion and is only shared when it is needed to move into execution. Precision does not send conversation history, email, people's names or documents to Operation Hub; before sending a Category Requirement Pack (CRP), you can review exactly what information will be shared.",
  "La información de tu proyecto se utiliza para estructurar tu expansión y se comparte únicamente cuando corresponde avanzar la ejecución. Precision no envía a Operation Hub el historial de conversación, correo, nombres de personas ni documentos; antes de enviar un CRP, puedes revisar exactamente qué información se compartirá.",
  "Your project information is used to structure your expansion and is only shared when it is needed to move into execution. Precision does not send conversation history, email, people's names or documents to Operation Hub; before sending a CRP, you can review exactly what information will be shared.",
]);

function v(rule: Violation["rule"], code: string, hit: string, message: string, critical = true): Violation {
  return { rule, code, hit, message, critical };
}

export function countQuestions(text: string): number {
  const t = stripPlaceholders(text);
  const inverted = (t.match(/¿/g) ?? []).length;
  if (inverted > 0) return inverted;
  // English (and any text without inverted marks): count sentences that end in "?".
  return (t.match(/\?/g) ?? []).length;
}

export function checkTone(text: string, ctx: Pick<VerifyContext, "locale" | "questions">): Violation[] {
  const out: Violation[] = [];
  const t = stripPlaceholders(text);
  const trimmed = text.trim();

  if (ctx.locale === "es") {
    const m = t.match(R1_RE);
    if (m) out.push(v("R1", "register_usted_vos", m[0], "register must be 'tú' (no usted/vos)"));
  }

  const colloquial = ctx.locale === "es" ? (t.match(R2_ES_WORDS) ?? t.match(R2_DE_UNA)) : (t.match(R2_EN_WORDS) ?? t.match(R2_EN_YESNO_ECHO));
  const symbol = t.match(R2_SYMBOLS);
  const m2 = colloquial ?? symbol;
  if (m2) out.push(v("R2", "colloquial_or_exclamation", m2[0], "colloquialism, exclamation or emoji"));

  if (!(ctx.locale === "es" && APPROVED_STATE_LABELS.has(trimmed))) {
    const es = ctx.locale === "es" ? t.match(R7_ES) : null;
    const en = ctx.locale === "en" ? t.match(R7_EN_QUALITY) : null;
    const common = t.match(WB("ClickUp|Strategic Advisory Brief|Unmapped Service|New Category|Add Category|Out of Scope|readiness score|SOURCEABLE|NOT_OFFERED|RFI|RFP|RFQ|SOW|reopen|Discovery|AAA", "iu"));
    const core = t.match(R7_CORE);
    const hit = es ?? en ?? common ?? core;
    if (hit) out.push(v("R7", "forbidden_term_or_quality_judgment", hit[0].trim(), "forbidden term or quality judgment"));
  }
  if (BRAND_CAP.test(t)) out.push(v("R7", "brand_case", "Beeside", "brand is always lowercase: beeside"));
  if (HIVE.test(t) && !/The Hive/.test(t)) out.push(v("R7", "hive_case", "hive", "write The Hive"));

  const q = countQuestions(t);
  const mode = ctx.questions ?? "at-most-one";
  if (mode === "none" && q > 0) out.push(v("R3", "question_not_allowed", `${q} questions`, "this text must not contain a question", true));
  else if (mode === "one" && q !== 1) out.push(v("R3", "exactly_one_question", `${q} questions`, "exactly one question per turn", true));
  else if (mode === "at-most-one" && q > 1) out.push(v("R3", "one_question_per_turn", `${q} questions`, "one question per turn", true));

  if (!APPROVED_VERBATIM.has(trimmed)) {
    const wc = splitSentences(t).map((s) => wordCount(s));
    const avg = wc.reduce((a, b) => a + b, 0) / Math.max(1, wc.length);
    const max = Math.max(0, ...wc);
    if (avg > 18) out.push(v("R4", "avg_sentence_length", `avg ${avg.toFixed(1)}`, "average sentence length > 18", false));
    if (max > 35) out.push(v("R4", "max_sentence_length", `max ${max}`, "a sentence > 35 words", false));
  }
  return out;
}
