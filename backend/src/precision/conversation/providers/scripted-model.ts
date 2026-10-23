/**
 * Scripted model provider (SIMULATED). Deterministic: the same request always yields the same response, so the
 * whole conversation pipeline — turn engine, verifiers, fallbacks, idempotency — runs end to end without a key.
 *
 * It is driven by an optional fixture keyed by (surface, step) and, where the fixture is silent, by small
 * deterministic heuristics (option/number/date/country matching, label-based questions). It is internal: the word
 * "scripted"/"simulated" never appears in customer text, only in `describe()`.
 */
import {
  ModelUnavailableError,
  type ExtractRequest,
  type ExtractResponse,
  type ExtractedValue,
  type InterpretRequest,
  type InterpretResponse,
  type FieldBrief,
  type ModelProvider,
  type ModelProviderDescriptor,
  type ModelRequest,
  type ModelResponseFor,
  type RouteRequest,
  type RouteResponse,
  type WriteRequest,
  type WriteResponse,
} from "../ports";
import { lookupGroup, lookupQuestion } from "../copy/field-questions";
import { hashNumber, lowerFirst, normalizeText } from "../text-utils";

export interface ScriptedStep {
  extract?: ExtractedValue[] | ((req: ExtractRequest) => ExtractedValue[]);
  /** One text, `[attempt1, attempt2]`, or a function. */
  write?: string | string[] | ((req: WriteRequest) => string);
  route?: string[];
  /** The model's JSON reading of the client's words for the Understanding surface (null/absent = no opinion). */
  interpret?: unknown | ((req: InterpretRequest) => unknown);
  /** Simulates an unavailable model for this step. */
  fail?: "timeout" | "exhausted" | "not_configured";
}
/** Keys: `${surface}:${step}`, `${surface}:*` or `*`. */
export type ScriptedFixture = Readonly<Record<string, ScriptedStep>>;

export interface ScriptedCall { task: ModelRequest["task"]; surface?: string; step?: string; attempt?: number }

export interface ScriptedOptions {
  fixture?: ScriptedFixture;
  /** Use the deterministic heuristics when the fixture has no entry (default true). */
  heuristics?: boolean;
}

const COUNTRIES: Record<string, string> = {
  mexico: "MX", "estados unidos": "US", "united states": "US", usa: "US", canada: "CA", chile: "CL", colombia: "CO", peru: "PE",
  argentina: "AR", brasil: "BR", brazil: "BR", espana: "ES", spain: "ES", alemania: "DE", germany: "DE", francia: "FR", france: "FR",
  italia: "IT", italy: "IT", "reino unido": "GB", "united kingdom": "GB", china: "CN", japon: "JP", japan: "JP", india: "IN",
  panama: "PA", "costa rica": "CR", ecuador: "EC", uruguay: "UY", portugal: "PT", "paises bajos": "NL", netherlands: "NL",
};
const LANGUAGES: Record<string, string> = {
  espanol: "es", spanish: "es", ingles: "en", english: "en", portugues: "pt", portuguese: "pt", frances: "fr", french: "fr",
  aleman: "de", german: "de", italiano: "it", italian: "it", chino: "zh", chinese: "zh", japones: "ja", japanese: "ja",
};
const MONTHS: Record<string, string> = {
  enero: "01", january: "01", febrero: "02", february: "02", marzo: "03", march: "03", abril: "04", april: "04", mayo: "05", may: "05",
  junio: "06", june: "06", julio: "07", july: "07", agosto: "08", august: "08", septiembre: "09", setiembre: "09", september: "09",
  octubre: "10", october: "10", noviembre: "11", november: "11", diciembre: "12", december: "12",
};
const CURRENCIES: Record<string, string> = { usd: "USD", dolares: "USD", dollars: "USD", eur: "EUR", euros: "EUR", mxn: "MXN", pesos: "MXN" };

function nf(spec: { name: string }): ExtractedValue {
  return { name: spec.name, status: "not_found", value: null, confidence: null, source: null };
}

function containsWord(norm: string, needle: string): boolean {
  return new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`).test(norm);
}

/** Heuristic extraction for one spec. The `source` is always a snippet of the client's own text. */
function heuristicExtract(spec: ExtractRequest["specs"][number], text: string): ExtractedValue {
  const norm = normalizeText(text);
  const found = (value: ExtractedValue["value"], source: string, confidence: number): ExtractedValue => ({ name: spec.name, status: "ok", value, confidence, source });
  switch (spec.type) {
    case "enum": {
      const options = (spec.enumValues ?? []).map((v) => ({ v, label: normalizeText(spec.enumLabels?.[v] ?? v), key: normalizeText(v) }));
      const hit = options.filter((o) => (o.label && containsWord(norm, o.label)) || containsWord(norm, o.key)).sort((a, b) => b.label.length - a.label.length)[0];
      return hit ? found(hit.v, containsWord(norm, hit.label) ? hit.label : hit.key, 0.9) : nf(spec);
    }
    case "multi_enum": {
      if (spec.enumValues && spec.enumValues.length > 0) {
        const hits = spec.enumValues.filter((v) => {
          const label = normalizeText(spec.enumLabels?.[v] ?? v);
          return (label && containsWord(norm, label)) || containsWord(norm, normalizeText(v));
        });
        if (!hits.length) return nf(spec);
        const first = hits[0] as string;
        const label = normalizeText(spec.enumLabels?.[first] ?? first);
        return found(hits, containsWord(norm, label) ? label : normalizeText(first), 0.88);
      }
      if (/country|pais/i.test(spec.description) || /ISO 3166/.test(spec.description)) {
        const codes: string[] = [];
        let src = "";
        for (const [name, code] of Object.entries(COUNTRIES).sort((a, b) => b[0].length - a[0].length)) {
          if (containsWord(norm, name) && !codes.includes(code)) {
            codes.push(code);
            src = src || name;
          }
        }
        return codes.length ? found(codes, src, 0.88) : nf(spec);
      }
      if (/ISO 639/.test(spec.description)) {
        const codes: string[] = [];
        let src = "";
        for (const [name, code] of Object.entries(LANGUAGES)) if (containsWord(norm, name) && !codes.includes(code)) { codes.push(code); src = src || name; }
        return codes.length ? found(codes, src, 0.88) : nf(spec);
      }
      const parts = text.split(/[,;\n]| y | and /i).map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 120);
      return parts.length ? found(parts, parts[0] as string, 0.8) : nf(spec);
    }
    case "number": {
      // a year next to a month name is a date, not a quantity
      const stripped = text.replace(/\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)(?: de| of)? \d{4}\b/gi, " ");
      const m = stripped.match(/(?<![\d.])(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,](\d+))?/);
      if (!m) return nf(spec);
      const whole = (m[1] as string).replace(/[.,](?=\d{3}(?:\D|$))/g, "");
      const n = Number(m[2] ? `${whole}.${m[2]}` : whole);
      return Number.isFinite(n) ? found(n, m[0], 0.85) : nf(spec);
    }
    case "boolean": {
      // only a bare yes/no answers a boolean; a "no" inside a longer sentence says nothing about this field
      if (norm.split(" ").length > 3) return nf(spec);
      if (/(?:^|\s)(?:si|yes|claro|correcto)(?:\s|$)/.test(norm)) return found(true, /(?:si|yes|claro|correcto)/.exec(norm)?.[0] ?? norm, 0.85);
      if (/^(?:no|nope)$/.test(norm)) return found(false, "no", 0.85);
      return nf(spec);
    }
    case "date": {
      const mm = norm.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)(?: de| of)? (\d{4})\b/);
      if (mm) return found(`${mm[2]}-${MONTHS[mm[1] as string]}`, mm[0], 0.85);
      const y = norm.match(/\b(20\d{2})\b/);
      if (y) return found(y[1] as string, y[1] as string, 0.8);
      return nf(spec);
    }
    case "string": {
      if (/currency|ISO 4217/.test(spec.description)) {
        for (const [name, code] of Object.entries(CURRENCIES)) if (containsWord(norm, name)) return found(code, name, 0.85);
        return nf(spec);
      }
      const t = text.replace(/\s+/g, " ").trim();
      if (!t) return nf(spec);
      return found(t.slice(0, 600), t.slice(0, 600), 0.8);
    }
    default:
      return nf(spec);
  }
}

// ------------------------------------------------------------------ kind exclusivity and lane roles
const COUNTRY_ALT = Object.keys(COUNTRIES).sort((a, b) => b.length - a.length).join("|");
const FROM_CUE = "(?:de|desde|from|saliendo de|sale de|salen de|salimos de|leaves from|leave from|ship from|shipping from|origen|origin|originating in)";
const TO_CUE = "(?:a|hacia|hasta|para|to|into|destino|destination|llega a|llegan a|arrive in|arrives in|arrive at)";
const LANE_RE = new RegExp(`(?:^|\\s)${FROM_CUE}\\s+(${COUNTRY_ALT})\\s+${TO_CUE}\\s+(${COUNTRY_ALT})(?=\\s|$)`);
const ORIGIN_RE = new RegExp(`(?:^|\\s)${FROM_CUE}\\s+(${COUNTRY_ALT})(?=\\s|$)`);
const DEST_RE = new RegExp(`(?:^|\\s)${TO_CUE}\\s+(${COUNTRY_ALT})(?=\\s|$)`);

type CountryRole = "origin" | "destination";

/** The role a country question has, read from the English description the engine always sends. */
function countryRoleOf(spec: ExtractRequest["specs"][number]): CountryRole | null {
  const d = spec.description.toLowerCase();
  if (/\b(origin|source|departure)\b/.test(d)) return "origin";
  if (/\b(destination|arrival|delivery)\b/.test(d)) return "destination";
  return null;
}

/** Roles the client's own words give to countries: "de Chile a México", "desde Chile", "hacia México". */
function laneRoles(norm: string): Partial<Record<CountryRole, string>> {
  const lane = LANE_RE.exec(norm);
  if (lane) return { origin: COUNTRIES[lane[1] as string], destination: COUNTRIES[lane[2] as string] };
  const roles: Partial<Record<CountryRole, string>> = {};
  const o = ORIGIN_RE.exec(norm);
  if (o) roles.origin = COUNTRIES[o[1] as string];
  const d = DEST_RE.exec(norm);
  if (d && COUNTRIES[d[1] as string] !== roles.origin) roles.destination = COUNTRIES[d[1] as string];
  return roles;
}

function isCountrySpec(spec: ExtractRequest["specs"][number]): boolean {
  return spec.type === "multi_enum" && !(spec.enumValues && spec.enumValues.length > 0) && (/country|pais/i.test(spec.description) || /ISO 3166/.test(spec.description));
}

/** Kind of free value a spec takes; specs of other types (enum, multi_enum lists) keep their own matching. */
function exclusiveKind(spec: ExtractRequest["specs"][number]): string | null {
  if (isCountrySpec(spec)) return "country";
  if (spec.type === "number" || spec.type === "boolean" || spec.type === "date") return spec.type;
  if (spec.type === "string" && !/currency|ISO 4217/.test(spec.description)) return "string";
  return null;
}

/**
 * One piece of the client's text answers one field. The target field takes the value of its kind; a field that is not
 * the target takes it only when the words give it away (a lane's origin and destination, or the only other field of
 * that kind while the target is of a different kind). This keeps "de Chile a México" from filling both countries and a
 * bare answer from being copied into every free-text field.
 */
function reconcile(specs: ExtractRequest["specs"], text: string, raw: ExtractedValue[]): ExtractedValue[] {
  const norm = normalizeText(text);
  const roles = laneRoles(norm);
  const out = raw.slice();
  const target = specs.find((s) => s.isTarget);
  const targetKind = target ? exclusiveKind(target) : null;
  specs.forEach((spec, i) => {
    const kind = exclusiveKind(spec);
    if (!kind) return;
    if (kind === "country") {
      const role = countryRoleOf(spec);
      const code = role ? roles[role] : undefined;
      // a target keeps its own matching unless both ends of a lane were named (then each end is told apart)
      const useCue = code && (!spec.isTarget || Object.keys(roles).length === 2);
      if (useCue && code) {
        out[i] = { name: spec.name, status: "ok", value: [code], confidence: 0.88, source: (Object.entries(COUNTRIES).find(([, c]) => c === code) ?? ["", ""])[0] };
        return;
      }
      if (spec.isTarget) {
        // the client named only the other end of the lane: nothing was said about this one
        if (role && Object.keys(roles).length > 0 && !roles[role]) out[i] = nf(spec);
        return;
      }
      // a volunteered country with no role words belongs to a role-less country field, and only when no other country field competes
      if (!specs.some((s) => s !== spec && isCountrySpec(s))) return;
      out[i] = nf(spec);
      return;
    }
    if (spec.isTarget) return;
    if (kind === "boolean" || kind === "string") {
      out[i] = nf(spec);
      return;
    }
    // number / date: a non-target field of that kind only when it is the single one and the target is of another kind
    const sameKind = specs.filter((s) => !s.isTarget && exclusiveKind(s) === kind).length;
    if (targetKind === kind || sameKind > 1) out[i] = nf(spec);
  });
  return out;
}

const ACK_ES: Record<string, string[]> = {
  recorded: ["Anotado.", "Entendido.", "Gracias, ya lo tengo."],
  corrected: ["Corrección anotada.", "Gracias por aclararlo, ya lo corregí."],
  confirmed: ["Confirmado.", "Gracias por confirmarlo."],
  clarify: ["Necesito precisar un poco esa respuesta."],
};
const ACK_EN: Record<string, string[]> = {
  recorded: ["Noted.", "Understood.", "Thanks, I have that."],
  corrected: ["Correction noted.", "Thanks for clarifying, I have corrected it."],
  confirmed: ["Confirmed.", "Thanks for confirming."],
  clarify: ["I need to clarify that answer a little."],
};

type Locale2 = "es" | "en";

/** "¿Desde qué país…?" becomes "desde qué país…?" so that a short lead can precede it: "Para el flujo 2, ¿desde…?". */
function withLead(lead: string, question: string, locale: Locale2): string {
  const body = lowerFirst(question.replace(/^¿/, ""));
  return locale === "es" ? `${lead} ¿${body}` : `${lead} ${body}`;
}

function endSentence(t: string): string {
  const x = t.trim();
  return /[.!?]$/.test(x) ? x : `${x}.`;
}

/** Last resort for a field that has no entry in the question bank: the label (or a question label) with a neutral frame. */
function questionFromLabel(label: string, groupLabel: string | undefined, locale: Locale2): string {
  if (/[?¿]/.test(label)) {
    const q = label.trim();
    return locale === "es" && !q.startsWith("¿") ? `¿${q}` : q;
  }
  const subject = lowerFirst(groupLabel ? `${groupLabel} - ${label}` : label);
  return locale === "es" ? `¿Qué puedes indicarme sobre este punto: ${subject}?` : `What can you tell me about this point: ${subject}?`;
}

/** A recorded value worth repeating back: short, a real value, not clipped, not a bare yes/no. */
function echoable(recorded: string): boolean {
  const r = recorded.trim();
  if (r.length < 3 || r.length > 40 || /[?!…]|\.\.\./.test(r)) return false;
  return !/^(?:si|sí|no|yes|nope|claro|correcto)$/i.test(r);
}

function optionsHint(options: { label: string }[], locale: Locale2): string {
  const labels = options.map((o) => o.label).filter((l) => l.length > 0);
  if (labels.length < 2 || labels.length > 6) return "";
  const head = labels.slice(0, -1).join(", ");
  const last = labels[labels.length - 1] as string;
  return locale === "es" ? `Las opciones son ${head} o ${last}.` : `The options are ${head} or ${last}.`;
}

/** The field question: from the bank when it has one (with the group lead for later items), else from the label. */
function composeQuestion(req: WriteRequest, field: FieldBrief): { intro: string; why: string; question: string; fromBank: boolean } {
  const locale = req.locale;
  const entry = lookupQuestion(field.fieldKey, field.subKey);
  if (!entry) return { intro: "", why: "", question: questionFromLabel(field.label, field.groupLabel, locale), fromBank: false };
  const group = field.subKey ? lookupGroup(field.fieldKey) : undefined;
  const item = field.itemIndex ?? 0;
  let intro = "";
  let question = entry.q[locale];
  if (group && field.subKey === group.first) {
    if (item === 0) intro = group.intro[locale];
    else question = withLead(`${group.lead[locale]} ${item + 1},`, question, locale);
  }
  return { intro, why: item === 0 && entry.why ? entry.why[locale] : "", question, fromBank: true };
}

export class ScriptedModelProvider implements ModelProvider {
  readonly calls: ScriptedCall[] = [];
  private failuresLeft = 0;
  private failureReason: "timeout" | "exhausted" | "not_configured" = "exhausted";
  private readonly fixture: ScriptedFixture;
  private readonly heuristics: boolean;

  constructor(options: ScriptedOptions = {}) {
    this.fixture = options.fixture ?? {};
    this.heuristics = options.heuristics ?? true;
  }

  /** The next `n` calls throw ModelUnavailableError (tests of the AI-failure path). */
  failNext(n: number, reason: "timeout" | "exhausted" | "not_configured" = "exhausted"): void {
    this.failuresLeft = n;
    this.failureReason = reason;
  }

  describe(): ModelProviderDescriptor {
    return {
      port: "model_provider",
      implementation: "scripted",
      mode: "SIMULATED",
      verification: "NOT_VERIFIED",
      note: "Deterministic scripted provider: no network, no key. Output still goes through the same verifiers and turn engine.",
    };
  }

  private step(surface: string | undefined, step: string | undefined): ScriptedStep | undefined {
    return this.fixture[`${surface}:${step}`] ?? this.fixture[`${surface}:*`] ?? this.fixture["*"];
  }

  async complete<R extends ModelRequest>(req: R): Promise<ModelResponseFor<R>> {
    const surface = "surface" in req ? req.surface : undefined;
    const stepKey = "step" in req ? req.step : undefined;
    this.calls.push({ task: req.task, surface, step: stepKey, attempt: req.task === "write" ? req.attempt : undefined });
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new ModelUnavailableError(this.failureReason);
    }
    const script = this.step(surface, stepKey);
    if (script?.fail) throw new ModelUnavailableError(script.fail);
    switch (req.task) {
      case "extract":
        return this.extract(req, script) as ModelResponseFor<R>;
      case "write":
        return this.write(req, script) as ModelResponseFor<R>;
      case "route":
        return this.route(req, script) as ModelResponseFor<R>;
      case "interpret": {
        const i = script?.interpret;
        const json = typeof i === "function" ? (i as (r: InterpretRequest) => unknown)(req) : i ?? null;
        return { task: "interpret", json, physicalCalls: 1 } satisfies InterpretResponse as ModelResponseFor<R>;
      }
    }
    throw new Error("unknown task");
  }

  private extract(req: ExtractRequest, script: ScriptedStep | undefined): ExtractResponse {
    if (script?.extract) {
      const fields = typeof script.extract === "function" ? script.extract(req) : script.extract;
      const byName = new Map(fields.map((f) => [f.name, f]));
      return { task: "extract", fields: req.specs.map((s) => byName.get(s.name) ?? nf(s)), physicalCalls: 1 };
    }
    if (!this.heuristics) return { task: "extract", fields: req.specs.map(nf), physicalCalls: 1 };
    return { task: "extract", fields: reconcile(req.specs, req.clientText, req.specs.map((s) => heuristicExtract(s, req.clientText))), physicalCalls: 1 };
  }

  private write(req: WriteRequest, script: ScriptedStep | undefined): WriteResponse {
    if (script?.write !== undefined) {
      const w = script.write;
      const text = typeof w === "function" ? w(req) : Array.isArray(w) ? (w[req.attempt - 1] ?? (w[0] as string)) : w;
      return { task: "write", text, physicalCalls: 1 };
    }
    const es = req.locale === "es";
    const f = req.intent.field;
    const { intro, why, question, fromBank } = composeQuestion(req, f);
    const helpSentence = !fromBank && f.helpText && f.helpText.length <= 160 && !/[?¿]/.test(f.helpText) ? endSentence(f.helpText) : "";
    if (req.intent.kind === "ask_field_after_process") return { task: "write", text: [question, helpSentence].filter(Boolean).join(" "), physicalCalls: 1 };
    const pool = (es ? ACK_ES : ACK_EN)[req.intent.ack];
    let ack = "";
    if (pool && pool.length > 0) {
      // rotate by the question's ordinal so that consecutive turns never open with the same words
      const h = hashNumber(req.turnKey) + (req.intent.kind === "ask_field" ? req.intent.nextOrdinal : 0);
      ack = pool[h % pool.length] as string;
      // echo the recorded value only when it is short and says something (never a bare yes/no or a clipped sentence), and not every turn
      const rec = req.intent.kind === "ask_field" ? req.intent.recorded : null;
      if (req.intent.ack === "recorded" && rec && echoable(rec) && h % 3 !== 2) ack = es ? `Anotado: ${rec}.` : `Noted: ${rec}.`;
    }
    const hint = req.intent.ack === "clarify" ? optionsHint(f.options, req.locale) : "";
    const parts = [ack, hint, intro, question, why, helpSentence].filter((x) => x.length > 0);
    return { task: "write", text: parts.join(" "), physicalCalls: 1 };
  }

  private route(req: RouteRequest, script: ScriptedStep | undefined): RouteResponse {
    const allowed = new Set(req.topics.map((t) => t.topicKey));
    return { task: "route", topicKeys: (script?.route ?? []).filter((k) => allowed.has(k)).slice(0, 2), physicalCalls: 1 };
  }
}
