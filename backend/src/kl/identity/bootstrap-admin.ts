import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { Db, createPoolDb } from "../../db/database";
import { recordAudit } from "../../operations/audit";
import { KL_ENV } from "../config/env";

/**
 * Comando `kl:bootstrap-admin --email <correo>` (CR-KL-002 §5, B4): se ejecuta UNA vez por Plataforma como el job
 * dedicado `kl-bootstrap`. Verifica al titular en la base principal, se niega si ya existe un KL_ADMIN, llama a
 * `kl.bootstrap_admin` con kl_owner y escribe además `admin_audit_event` (SYSTEM) con el mismo request_id. No lo
 * ejecuta ninguna prueba contra un entorno compartido.
 */
export class BootstrapRefused extends Error {
  constructor(
    readonly reason: "not_found" | "inactive" | "login_not_enabled" | "technical_identity" | "invalid_email" | "admin_exists",
    message: string,
  ) {
    super(message);
    this.name = "BootstrapRefused";
  }
}

export interface BootstrapResult {
  requestId: string;
  adminUserId: string;
  grantId: string;
}

export async function bootstrapAdmin(deps: { beeside: Db; klOwnerUrl: string; now?: () => Date }, email: string): Promise<BootstrapResult> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) throw new BootstrapRefused("invalid_email", "correo no válido");
  if (normalized.endsWith("@beeside.internal")) throw new BootstrapRefused("technical_identity", "una identidad técnica no puede ser KL_ADMIN");
  const found = await deps.beeside.query<{ admin_user_id: string; auth_identity: string; active: boolean; login_enabled: boolean }>(
    "SELECT admin_user_id, auth_identity, active, login_enabled FROM admin_user WHERE auth_identity = $1",
    [normalized],
  );
  const user = found.rows[0];
  if (!user) throw new BootstrapRefused("not_found", "el admin_user no existe en la base principal");
  if (!user.active) throw new BootstrapRefused("inactive", "el admin_user está inactivo");
  if (!user.login_enabled) throw new BootstrapRefused("login_not_enabled", "el admin_user no tiene login habilitado");

  const requestId = randomUUID();
  const kl = new Client({ connectionString: deps.klOwnerUrl });
  await kl.connect();
  let grantId: string;
  try {
    const existing = await kl.query("SELECT 1 FROM kl.role_grant WHERE role = 'KL_ADMIN' AND revoked_at IS NULL LIMIT 1");
    if ((existing.rowCount ?? 0) > 0) throw new BootstrapRefused("admin_exists", "ya existe un KL_ADMIN no revocado");
    const r = await kl.query<{ g: string }>("SELECT kl.bootstrap_admin($1, $2, $3) AS g", [user.admin_user_id, normalized, requestId]);
    grantId = (r.rows[0] as { g: string }).g;
  } finally {
    await kl.end();
  }
  // Registro en la base principal con la función existente, sin cambiar su código.
  await recordAudit(deps.beeside, { actor: { type: "SYSTEM" }, action: "kl.bootstrap_admin", outcome: "ALLOWED", targetType: "admin_user", targetId: user.admin_user_id, requestId, details: { request_id: requestId, role: "KL_ADMIN" }, now: (deps.now ?? (() => new Date()))() });
  return { requestId, adminUserId: user.admin_user_id, grantId };
}

/* istanbul ignore next -- punto de entrada del job `kl-bootstrap` */
if (require.main === module) {
  void (async () => {
    const email = process.argv[process.argv.indexOf("--email") + 1];
    const url = process.env[KL_ENV.owner];
    const platform = process.env.DATABASE_URL;
    if (!email || !url || !platform) {
      process.stderr.write(`uso: kl:bootstrap-admin --email <correo> (requiere ${KL_ENV.owner} y DATABASE_URL)\n`);
      process.exit(2);
    }
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: platform, max: 1 });
    try {
      const result = await bootstrapAdmin({ beeside: createPoolDb(pool), klOwnerUrl: url }, email);
      process.stdout.write(`${JSON.stringify({ ok: true, requestId: result.requestId })}\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof BootstrapRefused ? `rechazado: ${error.reason}` : String(error)}\n`);
      process.exit(1);
    } finally {
      await pool.end();
    }
  })();
}
