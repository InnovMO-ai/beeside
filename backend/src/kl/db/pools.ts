import { Pool } from "pg";

/** Pools pequeños por proceso (CR-KL-002 §10): backend 3 + 3, kl-worker 2 + 2, kl-migrate 1. */
export function klPool(connectionString: string, max: number): Pool {
  const pool = new Pool({ connectionString, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 2_000 });
  // Una conexión inactiva que se cae no debe tumbar el proceso: la siguiente consulta se reporta como UNAVAILABLE.
  pool.on("error", () => undefined);
  return pool;
}

export interface BackendKlPools {
  app: Pool;
  reader: Pool;
  close(): Promise<void>;
}

export function backendPools(urls: { appUrl: string; readerUrl: string }): BackendKlPools {
  const app = klPool(urls.appUrl, 3);
  const reader = klPool(urls.readerUrl, 3);
  return { app, reader, close: async () => void (await Promise.all([app.end(), reader.end()])) };
}

export interface WorkerKlPools {
  agent: Pool;
  knowledge: Pool;
  close(): Promise<void>;
}

export function workerPools(urls: { agentUrl: string; knowledgeUrl: string }): WorkerKlPools {
  const agent = klPool(urls.agentUrl, 2);
  const knowledge = klPool(urls.knowledgeUrl, 2);
  return { agent, knowledge, close: async () => void (await Promise.all([agent.end(), knowledge.end()])) };
}
