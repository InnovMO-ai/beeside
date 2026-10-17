import { Pool } from "pg";

/** Pools pequeños por proceso (CR-KL-002 §10): backend 3 + 3, kl-worker 2 + 2, kl-migrate 1. */
export function klPool(connectionString: string, max: number, connectionTimeoutMillis = 2_000): Pool {
  const pool = new Pool({ connectionString, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis });
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

/**
 * El worker es un Cloud Run Job que arranca en frío: la primera conexión por el socket de Cloud SQL puede tardar más que los 2 s del backend
 * interactivo (en dev, el primer intento falló con "knowledge layer database unavailable" y el reintento del job lo resolvió). Por eso espera hasta 10 s.
 */
export const WORKER_CONNECT_TIMEOUT_MS = 10_000;

export function workerPools(urls: { agentUrl: string; knowledgeUrl: string }): WorkerKlPools {
  const agent = klPool(urls.agentUrl, 2, WORKER_CONNECT_TIMEOUT_MS);
  const knowledge = klPool(urls.knowledgeUrl, 2, WORKER_CONNECT_TIMEOUT_MS);
  return { agent, knowledge, close: async () => void (await Promise.all([agent.end(), knowledge.end()])) };
}
