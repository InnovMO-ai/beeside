import { AdminDeps } from "../admin/admin-router";
import { Router } from "express";
import { KlAdminDeps } from "../admin/kl/router";
import { backendKlConfig } from "./config/env";
import { backendPools, BackendKlPools } from "./db/pools";
import { startAuditCorrelation } from "./audit/correlation";
import { startReconciler } from "./identity/reconcile";
import { createPublicEditionRouter } from "./products/delivery";
import { KlReadService } from "./read/read-service";
import { RateLimiter } from "../security/rate-limit";

/**
 * Cableado de KL en el backend compartido (DD-01: mismo backend, módulo propio). KL queda apagado mientras no estén
 * definidas KL_DB_URL_APP y KL_DB_URL_READER; el backend se niega a arrancar si encuentra credenciales de otro proceso de
 * KL (KL_DB_URL_AGENT, KL_DB_URL_KNOWLEDGE, KL_DB_URL_OWNER) o PRECISION_KNOWLEDGE_PROVIDER distinto de «off» (R1).
 */
export interface KlRuntime {
  admin: KlAdminDeps;
  pools: BackendKlPools;
  /** Servicio `kl.v1` de lectura para el puerto `knowledge` que implementa el responsable de Precision. */
  read: KlReadService;
  /** Estado público de edición (PO-2): solo el estado, con límite de tasa por dirección. */
  publicEditions(limiter?: RateLimiter): Router;
  startBackground(log?: (message: string, fields?: Record<string, string | number | boolean | null>) => void): () => void;
}

export function klRuntimeFromEnv(env: NodeJS.ProcessEnv, admin: AdminDeps | undefined): KlRuntime | undefined {
  const config = backendKlConfig(env);
  if (!config) return undefined;
  if (!admin) throw new Error("KL Admin requiere el Admin API del Control Center (ADMIN_API_ENABLED=true)");
  const pools = backendPools(config);
  const runtime: KlRuntime = {
    admin: { platform: admin.fa.db, session: admin.session, klApp: pools.app, now: admin.fa.config.now },
    pools,
    read: new KlReadService(pools.reader),
    publicEditions: (limiter) => createPublicEditionRouter(new KlReadService(pools.reader), limiter ? { limiter } : {}),
    startBackground: (log) => {
      const stops = [
        startReconciler({ beeside: admin.fa.db, kl: pools.app, ...(log ? { log } : {}) }),
        startAuditCorrelation({ platform: admin.fa.db, kl: pools.app, ...(log ? { log } : {}) }),
      ];
      return () => stops.forEach((stop) => stop());
    },
  };
  return runtime;
}
