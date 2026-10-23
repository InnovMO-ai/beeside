/**
 * CONV — ports. Everything the conversation module needs from the outside world is behind one of these
 * interfaces, so the same turn engine runs with the scripted provider, the real gateway, an in-memory store
 * or the Drizzle store. No DB code here.
 */
import type { IntegrationMode, IntegrationVerification } from "../ports/integration-descriptor";
import type { CategoryEvaluation, EvaluationInput } from "../manifest/types";
import type {
  CandidateFact,
  ConversationContext,
  Locale,
  Surface,
  TurnKind,
} from "./types";

// ------------------------------------------------------------------ Clock
export interface Clock {
  now(): Date;
  /** Monotonic milliseconds, used only for elapsed-time and budget decisions. */
  monotonicMs(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  monotonicMs: () => Number(process.hrtime.bigint() / 1_000_000n),
};

// ------------------------------------------------------------------ EvaluateCategory (ENGINE)
/** `evaluateCategory` from ENGINE, injected. CONV never imports its implementation. */
export type EvaluateCategory = (input: EvaluationInput) => CategoryEvaluation;

// ------------------------------------------------------------------ ModelProvider
export interface ModelProviderDescriptor {
  readonly port: "model_provider";
  // eslint-disable-next-line @typescript-eslint/ban-types -- keeps the literal union open for autocomplete
  readonly implementation: "scripted" | "gateway" | (string & {});
  readonly mode: IntegrationMode;
  readonly verification: IntegrationVerification;
  readonly note?: string;
}

/** Thrown by a provider when no model result could be produced (timeout, chain exhausted, not configured). */
export class ModelUnavailableError extends Error {
  readonly reason: "timeout" | "exhausted" | "not_configured";
  constructor(reason: "timeout" | "exhausted" | "not_configured") {
    // The message is internal only: it never reaches a client.
    super(`model unavailable (${reason})`);
    this.name = "ModelUnavailableError";
    this.reason = reason;
  }
}

export type ExtractSpecType = "string" | "number" | "boolean" | "date" | "enum" | "multi_enum";

export interface ExtractSpec {
  /** Field key, or `${groupKey}__${subKey}` for a repeatable-group sub-field. */
  name: string;
  type: ExtractSpecType;
  description: string;
  enumValues?: string[];
  /** Localized option labels, by enum value (used by providers that match on labels). */
  enumLabels?: Record<string, string>;
  isTarget: boolean;
}

export interface FieldBrief {
  fieldKey: string;
  /** Present for group sub-fields. */
  subKey?: string;
  itemIndex?: number;
  label: string;
  groupLabel?: string;
  helpText: string | null;
  type: string;
  options: { value: string; label: string }[];
  requirementLevel: string;
}

export interface ExtractRequest {
  task: "extract";
  surface: Surface;
  /** Target field key (or stage name). Scripts are keyed by (surface, step). */
  step: string;
  locale: Locale;
  turnKey: string;
  clientText: string;
  /** The question the client is answering (so a bare "yes" can be interpreted), when known. */
  question: string | null;
  specs: ExtractSpec[];
  timeoutMs: number;
}
export interface ExtractedValue {
  name: string;
  status: "ok" | "not_found" | "unresolved";
  value: string | number | boolean | string[] | null;
  confidence: number | null;
  source: string | null;
}
export interface ExtractResponse {
  task: "extract";
  fields: ExtractedValue[];
  /** Real network calls behind this logical call (the gateway's extraction may retry a malformed shape once). */
  physicalCalls: number;
}

export type WriteIntent =
  | {
      kind: "ask_field";
      field: FieldBrief;
      ack: "none" | "recorded" | "corrected" | "confirmed" | "clarify";
      nextOrdinal: number;
      /** Short client-language rendering of what was just recorded (data, never instructions); null when nothing. */
      recorded: string | null;
    }
  | { kind: "ask_field_after_process"; field: FieldBrief };

export interface WriteRequest {
  task: "write";
  surface: Surface;
  step: string;
  locale: Locale;
  turnKey: string;
  /** 1 = first draft, 2 = regeneration after a verifier violation. */
  attempt: 1 | 2;
  intent: WriteIntent;
  /** Provider-agnostic prompts (the gateway provider sends them; the scripted provider ignores them). */
  system: string;
  user: string;
  /** Verifier rule codes of the rejected draft (attempt 2 only). */
  feedback: string[];
  timeoutMs: number;
}
export interface WriteResponse { task: "write"; text: string; physicalCalls: number }

export interface RouteRequest {
  task: "route";
  surface: Surface;
  /** Always "route" (scripts are keyed by (surface, step)). */
  step: string;
  locale: Locale;
  turnKey: string;
  clientText: string;
  topics: { topicKey: string; hint: string }[];
  timeoutMs: number;
}
export interface RouteResponse { task: "route"; topicKeys: string[]; physicalCalls: number }

/**
 * Understanding: the model READS the client's words into a structured proposal (observations with the client's own quote, concepts,
 * needs, countries, rationale, priorities). It never decides: the governor validates every quote and value, and the frame reducer
 * decides what becomes knowledge. `json` is untrusted data; null = the model has no reading (the rule baseline answers alone).
 */
export interface InterpretRequest {
  task: "interpret";
  surface: Surface;
  step: string;
  locale: Locale;
  turnKey: string;
  clientText: string;
  /** The question the client is answering (so a bare "unas 60" binds to the right aspect). */
  question: string | null;
  /** The vocabulary the answer must stay inside: aspect keys and concept ids. */
  probeKeys: string[];
  conceptIds: string[];
  timeoutMs: number;
}
export interface InterpretResponse { task: "interpret"; json: unknown; physicalCalls: number }

export type ModelRequest = ExtractRequest | WriteRequest | RouteRequest | InterpretRequest;
export type ModelResponseFor<R extends ModelRequest> = R extends ExtractRequest
  ? ExtractResponse
  : R extends WriteRequest
    ? WriteResponse
    : R extends InterpretRequest
      ? InterpretResponse
      : RouteResponse;

export interface ModelProvider {
  describe(): ModelProviderDescriptor;
  complete<R extends ModelRequest>(req: R): Promise<ModelResponseFor<R>>;
}

// ------------------------------------------------------------------ ConversationStore
export interface StoredTurn {
  id: string;
  seq: number;
  projectId: string;
  scopeInstanceId: string;
  turnKey: string;
  role: "client" | "assistant";
  surface: Surface;
  kind: TurnKind;
  locale: Locale;
  content: string;
  structured: Record<string, unknown>;
  createdAt: Date;
}

export interface NewTurn {
  projectId: string;
  scopeInstanceId: string;
  turnKey: string;
  role: "client" | "assistant";
  surface: Surface;
  kind: TurnKind;
  locale: Locale;
  content: string;
  structured: Record<string, unknown>;
}

export interface PersistedTurn { turn: StoredTurn; created: boolean }

export interface ConversationStore {
  /** Both rows (client + assistant) that share a turn key, when they exist. */
  findByTurnKey(projectId: string, turnKey: string): Promise<{ client: StoredTurn | null; assistant: StoredTurn | null }>;
  /** Idempotent by (projectId, turnKey, role): a second call returns the existing row with created=false. */
  persistTurn(turn: NewTurn): Promise<PersistedTurn>;
  /** Chronological (seq ascending), most recent `limit` rows of one scope. */
  loadThread(projectId: string, scopeInstanceId: string, limit: number): Promise<StoredTurn[]>;
  /** True once an assistant turn of kind `disclosure` exists for the project. */
  hasDisclosure(projectId: string): Promise<boolean>;
  /** True when some assistant turn of the project contains the exact needle (e.g. "Category Requirement Pack (CRP)"). */
  hasAssistantTextContaining(projectId: string, needle: string): Promise<boolean>;
  /** Serialises turn processing per project (advisory lock). */
  withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T>;
}

// ------------------------------------------------------------------ ContextReader / FactWriter (DOMAIN)
export interface ContextReader {
  load(args: { projectId: string; surface: Surface; scopeInstanceId: string; locale: Locale }): Promise<ConversationContext>;
}

export interface FactWriter {
  /**
   * Persists validated facts (DOMAIN calls recordFact: append-only, superseding). MUST be idempotent on
   * `CandidateFact.idempotencyKey`: a reprocessed turn never creates a second effect.
   */
  recordFacts(args: { projectId: string; scopeInstanceId: string; surface: Surface; turnKey: string; facts: CandidateFact[] }): Promise<void>;
}
