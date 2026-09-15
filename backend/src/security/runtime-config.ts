import { Db } from "../db/database";
import { normalizeOrigin } from "./http-hardening";

/**
 * Startup configuration validation (Phase 13). Production refuses development conveniences, the
 * migration credential, missing secrets and insecure URLs before the first request is served.
 * Messages name variables only — never values.
 */

export interface ConfigIssue {
  level: "error" | "warning";
  message: string;
}

export const INTEGRATION_MODES = ["disabled", "capture", "live"] as const;
export type IntegrationMode = (typeof INTEGRATION_MODES)[number];

export function integrationMode(value: string | undefined): IntegrationMode {
  return (INTEGRATION_MODES as readonly string[]).includes(value ?? "") ? (value as IntegrationMode) : "disabled";
}

export function trustProxyHops(env: NodeJS.ProcessEnv): number {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw === "") return 0;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
}

export function allowedOrigins(env: NodeJS.ProcessEnv): Set<string> {
  const origins = new Set<string>();
  for (const value of [env.APP_BASE_URL, env.ADMIN_APP_ORIGIN, ...(env.ALLOWED_ORIGINS ?? "").split(",")]) {
    const origin = value ? normalizeOrigin(value.trim()) : null;
    if (origin) origins.add(origin);
  }
  return origins;
}

export function validateRuntimeConfig(env: NodeJS.ProcessEnv): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const error = (message: string) => issues.push({ level: "error", message });
  const warning = (message: string) => issues.push({ level: "warning", message });
  const production = env.NODE_ENV === "production";
  const publicSurface = env.FA_API_ENABLED === "true" || env.ADMIN_API_ENABLED === "true" || env.BILLING_EVENTS_ENABLED === "true";

  if (env.SECURITY_HASH_SECRET !== undefined && env.SECURITY_HASH_SECRET.length < 32) error("SECURITY_HASH_SECRET must be at least 32 characters");
  if (env.TRUST_PROXY_HOPS !== undefined && env.TRUST_PROXY_HOPS !== "" && String(trustProxyHops(env)) !== env.TRUST_PROXY_HOPS) error("TRUST_PROXY_HOPS must be an integer between 0 and 5");
  for (const entry of (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const origin = normalizeOrigin(entry);
    if (!origin) error("ALLOWED_ORIGINS contains an invalid origin");
    else if (production && !origin.startsWith("https://")) error("ALLOWED_ORIGINS must use https in production");
  }
  for (const name of ["INTEGRATION_SMARTSUITE_MODE", "INTEGRATION_OPERATION_HUB_MODE"]) {
    const value = env[name];
    if (value !== undefined && value !== "" && !(INTEGRATION_MODES as readonly string[]).includes(value)) error(`${name} must be one of ${INTEGRATION_MODES.join(", ")}`);
  }
  if (env.MIGRATION_DATABASE_URL && env.DATABASE_URL && env.MIGRATION_DATABASE_URL === env.DATABASE_URL) {
    (production ? error : warning)("DATABASE_URL (runtime) and MIGRATION_DATABASE_URL must use different database users");
  }

  if (production) {
    if (env.DEV_LOG_EMAIL_LINKS === "true") error("DEV_LOG_EMAIL_LINKS is not allowed in production");
    if (env.PREMIUM_DEV_SIMULATION === "true") error("PREMIUM_DEV_SIMULATION is not allowed in production");
    if (env.ADMIN_COOKIE_SECURE === "false") error("ADMIN_COOKIE_SECURE=false is not allowed in production");
    if (env.MIGRATION_DATABASE_URL) error("MIGRATION_DATABASE_URL must not be given to runtime services (migrations run as a separate job)");
    if (publicSurface && (!env.SECURITY_HASH_SECRET || env.SECURITY_HASH_SECRET.length < 32)) error("SECURITY_HASH_SECRET (at least 32 characters) is required in production");
    if (publicSurface && (env.TRUST_PROXY_HOPS === undefined || env.TRUST_PROXY_HOPS === "")) error("TRUST_PROXY_HOPS must be set explicitly in production (client addresses key rate limits)");
    if (env.APP_BASE_URL && !env.APP_BASE_URL.startsWith("https://")) error("APP_BASE_URL must use https in production");
    for (const name of ["INTEGRATION_SMARTSUITE_MODE", "INTEGRATION_OPERATION_HUB_MODE"]) {
      if (env[name] === "capture") error(`${name}=capture is a development mode and is not allowed in production`);
    }
    if (env.DB_PRIVILEGE_CHECK === "off") warning("DB_PRIVILEGE_CHECK=off disables the least-privilege check of the runtime database user");
  }
  return issues;
}

export function assertRuntimeConfig(env: NodeJS.ProcessEnv, log: (level: "warn", message: string) => void): void {
  const issues = validateRuntimeConfig(env);
  for (const issue of issues.filter((i) => i.level === "warning")) log("warn", issue.message);
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length > 0) throw new Error(`invalid runtime configuration:\n- ${errors.map((e) => e.message).join("\n- ")}`);
}

/**
 * Least-privilege check of the database user the application runs as: it must not be able to change
 * the schema, manage roles, own tables or write the migration registry. Returns the problems found.
 */
export async function runtimeDbPrivilegeProblems(db: Db): Promise<string[]> {
  const { rows } = await db.query<{
    rolsuper: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
    rolbypassrls: boolean;
    create_in_public: boolean;
    owns_tables: boolean;
    writes_migrations: boolean;
    cloudsql_superuser: boolean;
  }>(
    `SELECT r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls,
            has_schema_privilege(current_user, 'public', 'CREATE') AS create_in_public,
            EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user) AS owns_tables,
            (to_regclass('drizzle.__drizzle_migrations') IS NOT NULL
               AND has_table_privilege(current_user, 'drizzle.__drizzle_migrations', 'INSERT')) AS writes_migrations,
            (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cloudsqlsuperuser')
               AND pg_has_role(current_user, 'cloudsqlsuperuser', 'MEMBER')) AS cloudsql_superuser
       FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const r = rows[0];
  if (!r) return ["current database role not found"];
  const problems: string[] = [];
  if (r.rolsuper) problems.push("runtime database user is a superuser");
  if (r.cloudsql_superuser) problems.push("runtime database user is a member of cloudsqlsuperuser");
  if (r.rolcreaterole) problems.push("runtime database user can create roles");
  if (r.rolcreatedb) problems.push("runtime database user can create databases");
  if (r.rolbypassrls) problems.push("runtime database user bypasses row-level security");
  if (r.create_in_public) problems.push("runtime database user can create objects in schema public");
  if (r.owns_tables) problems.push("runtime database user owns application tables (it is the migration user)");
  if (r.writes_migrations) problems.push("runtime database user can write the migration registry");
  return problems;
}
