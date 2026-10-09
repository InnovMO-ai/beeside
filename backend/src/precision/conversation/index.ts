/**
 * CONV public surface (Track A, release candidate). Other owners rely on:
 *   - `createConversationEngine(deps)` / `processTurn(deps, input)` / `openThread(deps, input)`
 *   - ports: ModelProvider, ConversationStore, ContextReader, FactWriter, EvaluateCategory, Clock, ValueRenderer
 *   - stores: DrizzleConversationStore (precision_turn), MemoryConversationStore (tests)
 *   - providers: selectModelProvider (env PRECISION_MODEL_PROVIDER=gateway|scripted), ScriptedModelProvider, GatewayModelProvider
 *   - copy accessors: copyText / plainCopy / ALL_COPY_KEYS
 *   - verifiers and the Process Knowledge pack (for review surfaces and tests)
 */
export * from "./types";
export * from "./ports";
export * from "./turn-engine";
export * from "./providers";
export * from "./stores";
export * from "./copy";
export { PACK_VERSION, PROCESS_TOPICS, getTopic } from "./process-knowledge/pack";
export { routeProcessQuestion } from "./process-knowledge/router";
export { composeProcessAnswer } from "./process-knowledge/answer";
export { TERM_REGISTRY, FORBIDDEN_INTERNAL_TERMS } from "./process-knowledge/term-registry";
export { verifyAssistantText, hasCriticalViolation, produceVerifiedText } from "./verifiers";
export type { ValueRenderer } from "./fields";
export { basicRenderer } from "./fields";
