import type { PrecisionDomainDeps } from "./deps";

/** The dependencies that exist before the conversation engine is built (the engine itself needs the context reader and fact writer). */
export type CoreDeps = Omit<PrecisionDomainDeps, "conversation">;
