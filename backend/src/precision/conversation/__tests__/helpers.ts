/**
 * Test kit for the conversation module: a small manifest, a simplified EvaluateCategory (stand-in for ENGINE's),
 * a fake DOMAIN (ContextReader + idempotent FactWriter sharing one fact map) and a `World` that wires the engine
 * with the scripted provider and the in-memory store. Not part of the public surface.
 */
import type { CategoryManifestContent, FieldDefinition } from "../../manifest/effective-fields";
import type { CategoryEvaluation, EvaluationInput, FactMap, FactView, RequirementStatus } from "../../manifest/types";
import { createConversationEngine, type ConversationEngine, type EngineOptions } from "../turn-engine";
import { groupCursor, isGroup, type ValueRenderer } from "../fields";
import type { ContextReader, EvaluateCategory, FactWriter, StoredTurn } from "../ports";
import { ScriptedModelProvider, type ScriptedFixture } from "../providers/scripted-model";
import { MemoryConversationStore } from "../stores/memory-store";
import type { ConversationStore } from "../ports";
import { DEFAULT_FLAGS, type ApprovedSource, type CandidateFact, type ConversationContext, type InheritedValue, type Locale, type ProcessTurnInput, type ProcessTurnResult, type StateFlags, type Surface } from "../types";

const L = (en: string, es: string): Record<string, string> => ({ en, es });

export const TEST_MANIFEST = {
  fields: [
    { field_key: "dest_country", type: "country_list", label: L("Which country do you want to enter?", "¿A qué país quieres entrar?"), requirement_level: "blocking" },
    { field_key: "operating_model", type: "enum", label: L("Who will run day-to-day operations?", "¿Quién operará el día a día?"), requirement_level: "blocking", values: ["self_managed", "third_party", "hybrid"] },
    { field_key: "monthly_volume", type: "number", label: L("Monthly shipment volume", "Volumen mensual de envíos"), requirement_level: "required", help_text: L("It sizes the transport and storage you need.", "Sirve para dimensionar el transporte y el almacenaje.") },
    { field_key: "start_date", type: "date", label: L("When do you plan to start?", "¿Cuándo planeas iniciar?"), requirement_level: "required" },
    { field_key: "product_notes", type: "text", label: L("Product description", "Descripción del producto"), requirement_level: "required" },
    { field_key: "needs_warehouse", type: "boolean", label: L("Is dedicated warehousing needed?", "¿Se necesita almacenamiento dedicado?"), requirement_level: "required", execution_dependency: true },
    { field_key: "services", type: "multi_enum", label: L("Services in scope", "Servicios en alcance"), requirement_level: "required", values: ["warehousing", "freight", "last_mile"] },
    {
      field_key: "flows",
      type: "repeatable_group",
      label: L("Logistics flows", "Flujos logísticos"),
      requirement_level: "required",
      min_items: 1,
      group_item_schema: [
        { field_key: "origin_country", type: "country_list", label: L("Origin country", "País de origen"), requirement_level: "required" },
        { field_key: "destination_country", type: "country_list", label: L("Destination country", "País de destino"), requirement_level: "required" },
        { field_key: "cadence", type: "enum", label: L("Shipment cadence", "Frecuencia de envíos"), requirement_level: "required", values: ["weekly", "monthly"] },
      ],
    },
    { field_key: "extra_notes", type: "text", label: L("Other notes", "Otras notas"), requirement_level: "supporting" },
  ],
  critical_decisions: [],
  country_overlays: {},
  operational_pending_items: [],
  visibility_rules: [],
} as unknown as CategoryManifestContent & { category_key?: string };

const REQUIRED = new Set(["blocking", "required", "conditional"]);
const CONFIRMED = new Set(["ANSWERED", "EXPLICIT_NO", "ZERO"]);

/** Simplified readiness (test double of ENGINE's evaluateCategory): same shape, same frozen rules for these types. */
export function fakeEvaluate(input: EvaluationInput): CategoryEvaluation {
  const fields = input.manifest.fields as FieldDefinition[];
  const reqs: RequirementStatus[] = [];
  const needsAsk = new Map<string, boolean>();
  for (const f of fields) {
    const fact = input.facts[f.field_key];
    const st = fact?.answerState ?? "NOT_ASKED";
    let state: RequirementStatus["state"];
    if (isGroup(f)) {
      const cur = groupCursor(f, fact?.value);
      state = cur === null ? "confirmed" : "pending";
      needsAsk.set(f.field_key, cur !== null && st !== "UNKNOWN" && st !== "WITHHELD");
    } else {
      state = CONFIRMED.has(st) ? "confirmed" : st === "ASSUMED" ? "assumed" : "pending";
      needsAsk.set(f.field_key, st === "NOT_ASKED");
    }
    reqs.push({ fieldKey: f.field_key, level: f.requirement_level, applicable: true, state, executionDependency: f.execution_dependency === true, answerState: st });
  }
  const req = reqs.filter((r) => REQUIRED.has(r.level));
  const confirmed = req.filter((r) => r.state === "confirmed").length;
  const blockingOpen = req.filter((r) => r.level === "blocking" && r.state !== "confirmed" && r.state !== "assumed");
  const candidates = req.filter((r) => needsAsk.get(r.fieldKey));
  const next = candidates.find((r) => r.level === "blocking") ?? candidates[0];
  return {
    progressPct: req.length === 0 ? null : Math.floor((100 * confirmed) / req.length),
    totalRequired: req.length,
    confirmedRequired: confirmed,
    ready: req.length > 0 && blockingOpen.length === 0,
    critical: blockingOpen.map((r) => ({ itemKey: r.fieldKey, kind: "field" as const, label: (fields.find((f) => f.field_key === r.fieldKey) as FieldDefinition).label })),
    pending: req.filter((r) => r.state !== "confirmed"),
    requirements: reqs,
    notApplicable: [],
    nextFieldKey: next ? next.fieldKey : null,
  };
}

/** Understanding "virtual manifest" (pa_* fields) used by the Understanding surface tests. */
export const UNDERSTANDING_MANIFEST = {
  fields: [
    { field_key: "pa_objective", type: "text", label: L("What do you want to achieve with this expansion?", "¿Qué quieres lograr con esta expansión?"), requirement_level: "blocking" },
    { field_key: "pa_destinations", type: "country_list", label: L("Which countries are you considering?", "¿Qué países estás considerando?"), requirement_level: "blocking" },
    { field_key: "pa_time_window", type: "date", label: L("When would you like to start?", "¿Cuándo te gustaría empezar?"), requirement_level: "required" },
  ],
  critical_decisions: [],
  country_overlays: {},
  operational_pending_items: [],
  visibility_rules: [],
} as unknown as CategoryManifestContent;

export class FakeFactWriter implements FactWriter {
  readonly applied = new Map<string, CandidateFact>();
  /** every recordFacts call, including idempotent repeats */
  calls = 0;
  constructor(private readonly facts: Record<string, FactView>) {}
  async recordFacts(args: { facts: CandidateFact[] }): Promise<void> {
    this.calls += 1;
    for (const f of args.facts) {
      if (this.applied.has(f.idempotencyKey)) continue; // idempotent: no second effect
      this.applied.set(f.idempotencyKey, f);
      this.facts[f.fieldKey] = { value: f.value, answerState: f.answerState, provenance: f.provenanceStage };
    }
  }
}

export interface WorldOptions {
  surface?: Surface;
  locale?: Locale;
  flags?: Partial<StateFlags>;
  inherited?: InheritedValue[];
  approvedSources?: ApprovedSource[];
  canWrite?: boolean;
  fixture?: ScriptedFixture;
  manifest?: CategoryManifestContent;
  facts?: Record<string, FactView>;
  countries?: string[];
  options?: EngineOptions;
  provider?: ScriptedModelProvider;
  title?: string;
  introducedTerms?: string[];
  /** Use another store (e.g. the Drizzle store) together with real project/scope ids. */
  store?: ConversationStore;
  projectId?: string;
  scopeId?: string;
  /** Replace the fake evaluator (engine-compat test uses ENGINE's real evaluateCategory). */
  evaluate?: EvaluateCategory;
  /** The renderer of the app (labels of options and values); the default is the plain one. */
  renderer?: ValueRenderer;
}

let projectCounter = 0;

export class World {
  readonly projectId: string;
  readonly scopeId: string;
  readonly surface: Surface;
  readonly locale: Locale;
  readonly facts: Record<string, FactView>;
  readonly store: ConversationStore;
  private readonly memory: MemoryConversationStore | null;
  readonly provider: ScriptedModelProvider;
  readonly writer: FakeFactWriter;
  readonly engine: ConversationEngine;
  flags: StateFlags;
  canWrite: boolean;
  private n = 0;

  constructor(private readonly o: WorldOptions = {}) {
    projectCounter += 1;
    const hex = (projectCounter + 1000).toString(16).padStart(12, "0");
    this.projectId = o.projectId ?? `00000000-0000-4000-8000-${hex}`;
    this.scopeId = o.scopeId ?? `00000000-0000-4000-9000-${hex}`;
    this.memory = o.store ? null : new MemoryConversationStore();
    this.store = o.store ?? (this.memory as MemoryConversationStore);
    this.surface = o.surface ?? "category";
    this.locale = o.locale ?? "es";
    this.facts = { ...(o.facts ?? {}) };
    this.flags = { ...DEFAULT_FLAGS, ...(o.flags ?? {}) };
    this.canWrite = o.canWrite ?? true;
    this.provider = o.provider ?? new ScriptedModelProvider(o.fixture ? { fixture: o.fixture } : {});
    this.writer = new FakeFactWriter(this.facts);
    const context: ContextReader = { load: async (a) => this.context(a.locale) };
    this.engine = createConversationEngine({
      store: this.store,
      context,
      facts: this.writer,
      evaluate: o.evaluate ?? fakeEvaluate,
      ...(o.renderer ? { renderer: o.renderer } : {}),
      provider: this.provider,
      ...(o.options ? { options: o.options } : {}),
    });
  }

  context(locale: Locale = this.locale): ConversationContext {
    const manifest = this.o.manifest ?? (this.surface === "understanding" ? UNDERSTANDING_MANIFEST : TEST_MANIFEST);
    return {
      projectId: this.projectId,
      surface: this.surface,
      scopeInstanceId: this.scopeId,
      locale,
      title: this.o.title ?? (locale === "es" ? "Logística" : "Logistics"),
      evaluation: { manifest: manifest as EvaluationInput["manifest"], facts: { ...this.facts } as FactMap, countries: this.o.countries ?? ["CL"] },
      inherited: this.o.inherited ?? [],
      flags: this.flags,
      approvedSources: this.o.approvedSources ?? [],
      introducedTerms: this.o.introducedTerms ?? [],
      canWrite: this.canWrite,
    };
  }

  key(label = "turn"): string {
    this.n += 1;
    return `${label}-${String(this.n).padStart(4, "0")}-key`;
  }

  open(): Promise<ProcessTurnResult> {
    return this.engine.openThread({ projectId: this.projectId, surface: this.surface, scopeInstanceId: this.scopeId, locale: this.locale });
  }

  turn(input: Partial<ProcessTurnInput> & { text?: string }, turnKey?: string): Promise<ProcessTurnResult> {
    return this.engine.processTurn({ projectId: this.projectId, surface: this.surface, scopeInstanceId: this.scopeId, locale: this.locale, turnKey: turnKey ?? this.key(), ...input });
  }

  say(text: string, turnKey?: string): Promise<ProcessTurnResult> {
    return this.turn({ text }, turnKey);
  }

  /** Memory store only: every row of the project, in order. */
  all(): StoredTurn[] {
    if (!this.memory) throw new Error("all() needs the memory store");
    return this.memory.all();
  }

  thread(): StoredTurn[] {
    return this.all().filter((r) => r.scopeInstanceId === this.scopeId);
  }

  lastAssistant(): StoredTurn {
    const rows = this.thread().filter((r) => r.role === "assistant" && r.kind !== "disclosure");
    return rows[rows.length - 1] as StoredTurn;
  }
}

export function assistantText(r: ProcessTurnResult): string {
  const a = [...r.turns].reverse().find((t) => t.role === "assistant");
  return a ? a.text : "";
}
