/**
 * Variables de conexión de KL (CR-KL-002 Handoff §3, nombres normativos) y rechazo al arrancar: el proceso que
 * encuentra en su entorno una variable que no le corresponde se niega a arrancar.
 */
export const KL_ENV = {
  app: "KL_DB_URL_APP",
  reader: "KL_DB_URL_READER",
  agent: "KL_DB_URL_AGENT",
  knowledge: "KL_DB_URL_KNOWLEDGE",
  owner: "KL_DB_URL_OWNER",
} as const;

export class KlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KlConfigError";
  }
}

const present = (env: NodeJS.ProcessEnv, names: string[]) => names.filter((n) => typeof env[n] === "string" && (env[n] as string).length > 0);

/** Secretos y credenciales de la plataforma compartida que `kl-worker` jamás debe ver (sin credenciales de `beeside`). */
export const SHARED_PLATFORM_ENV = [
  "DATABASE_URL",
  "ADMIN_SESSION_SECRET",
  "ADMIN_OIDC_CLIENT_SECRET",
  "BILLING_WEBHOOK_SECRET",
  "SECURITY_HASH_SECRET",
  "PRECISION_PROJECT_REF_SECRET",
];

/** Defensa de R1: Precision no consume a KL hasta que se cumplan B1, B2 y la línea base R5 (PRECISION_KNOWLEDGE_PROVIDER = off). */
export function assertProviderOff(env: NodeJS.ProcessEnv): void {
  const provider = env.PRECISION_KNOWLEDGE_PROVIDER;
  if (provider !== undefined && provider !== "" && provider !== "off") {
    throw new KlConfigError(`PRECISION_KNOWLEDGE_PROVIDER debe ser "off" en R1 (valor: ${provider})`);
  }
}

export interface BackendKlConfig {
  appUrl: string;
  readerUrl: string;
}

export function backendKlConfig(env: NodeJS.ProcessEnv): BackendKlConfig | null {
  const used = present(env, [KL_ENV.app, KL_ENV.reader]);
  if (used.length === 0) return null; // KL no está configurado: el backend arranca sin el módulo
  assertProviderOff(env);
  const foreign = present(env, [KL_ENV.agent, KL_ENV.knowledge, KL_ENV.owner]);
  if (foreign.length > 0) throw new KlConfigError(`el backend se niega a arrancar con variables que no le corresponden: ${foreign.join(", ")}`);
  const missing = [KL_ENV.app, KL_ENV.reader].filter((n) => !env[n]);
  if (missing.length > 0) throw new KlConfigError(`KL requiere ${missing.join(", ")}`);
  return { appUrl: env[KL_ENV.app] as string, readerUrl: env[KL_ENV.reader] as string };
}

export interface WorkerKlConfig {
  agentUrl: string;
  knowledgeUrl: string;
}

export function workerKlConfig(env: NodeJS.ProcessEnv): WorkerKlConfig {
  assertProviderOff(env);
  const foreign = present(env, [KL_ENV.app, KL_ENV.reader, KL_ENV.owner, ...SHARED_PLATFORM_ENV]);
  if (foreign.length > 0) throw new KlConfigError(`kl-worker se niega a arrancar con variables que no le corresponden: ${foreign.join(", ")}`);
  if (env.KL_AGENTS_ENABLED !== undefined && env.KL_AGENTS_ENABLED !== "" && env.KL_AGENTS_ENABLED !== "false") {
    throw new KlConfigError("los agentes permanecen desactivados en R1 (KL_AGENTS_ENABLED debe ser false o no estar definida)");
  }
  const missing = [KL_ENV.agent, KL_ENV.knowledge].filter((n) => !env[n]);
  if (missing.length > 0) throw new KlConfigError(`kl-worker requiere ${missing.join(", ")}`);
  return { agentUrl: env[KL_ENV.agent] as string, knowledgeUrl: env[KL_ENV.knowledge] as string };
}

export function migrateKlConfig(env: NodeJS.ProcessEnv): { ownerUrl: string } {
  const foreign = present(env, [KL_ENV.app, KL_ENV.reader, KL_ENV.agent, KL_ENV.knowledge, "DATABASE_URL"]);
  if (foreign.length > 0) throw new KlConfigError(`kl-migrate se niega a arrancar con variables que no le corresponden: ${foreign.join(", ")}`);
  if (!env[KL_ENV.owner]) throw new KlConfigError(`kl-migrate requiere ${KL_ENV.owner}`);
  return { ownerUrl: env[KL_ENV.owner] as string };
}
