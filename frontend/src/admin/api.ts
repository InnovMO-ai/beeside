/**
 * Admin/Supervisor Control Center client. The session lives in an HttpOnly cookie set by the backend
 * after the identity-provider sign-in; this code never sees or stores a credential. Every write
 * carries the X-Beeside-Admin header (CSRF defence together with SameSite=Strict cookies).
 */
const BASE = "/api/admin";

export type AdminRole = "ADMIN" | "SUPERVISOR";
export type Permission =
  | "projects.read"
  | "config.read"
  | "operations.read"
  | "config.write"
  | "config.publish"
  | "operations.execute"
  | "premium.manage"
  | "audit.read"
  | "admin_users.manage";

export interface Me {
  email: string;
  role: AdminRole;
  permissions: Permission[];
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code);
  }
}

type Json = Record<string, unknown>;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") headers["X-Beeside-Admin"] = "1";
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!(response.headers.get("Content-Type") ?? "").includes("application/json")) {
    throw new AdminApiError(response.ok ? 503 : response.status, "UNAVAILABLE");
  }
  const data = (await response.json().catch(() => ({}))) as Json;
  if (!response.ok) throw new AdminApiError(response.status, typeof data.error === "string" ? data.error : "HTTP_ERROR", typeof data.message === "string" ? data.message : undefined);
  return data as T;
}

export const REGISTRIES = [
  { slug: "question-bank", label: "Question bank", key: "QUESTION_BANK" },
  { slug: "rules-engine", label: "Rules engine", key: "RULES_ENGINE" },
  { slug: "snapshot-template", label: "Snapshot template", key: "SNAPSHOT_TEMPLATE" },
] as const;
export type RegistrySlug = (typeof REGISTRIES)[number]["slug"];

export const adminApi = {
  loginUrl: (returnTo: string) => `${BASE}/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
  me: () => call<Me>("GET", "/me"),
  logout: () => call<{ signedOut: boolean }>("POST", "/auth/logout", {}),

  searchProjects: (q: string) => call<{ results: Json[] }>("GET", `/projects?q=${encodeURIComponent(q)}`),
  project: (id: string) => call<Json>("GET", `/projects/${id}`),
  answers: (id: string) => call<Json>("GET", `/projects/${id}/answers`),
  snapshot: (id: string) => call<Json>("GET", `/projects/${id}/snapshot`),
  internalAssessment: (id: string) => call<Json>("GET", `/projects/${id}/internal-assessment`),
  premium: (id: string) => call<Json>("GET", `/projects/${id}/premium`),
  lifecycle: (id: string) => call<Json>("GET", `/projects/${id}/lifecycle`),
  resendPrivateLink: (id: string) => call<Json>("POST", `/projects/${id}/private-link`, {}),
  recordSubscriptionEvent: (id: string, input: { eventType: string; requestId?: string; periodStart?: string; periodEnd?: string }) =>
    call<Json>("POST", `/projects/${id}/premium/events`, input),

  currentConfig: () => call<Record<string, string | null>>("GET", "/config/current"),
  versions: (registry: RegistrySlug) => call<Json[]>("GET", `/config/${registry}/versions`),
  version: (registry: RegistrySlug, version: string) => call<Json>("GET", `/config/${registry}/versions/${encodeURIComponent(version)}`),
  createDraft: (registry: RegistrySlug, version: string, config: unknown) => call<Json>("POST", `/config/${registry}/versions`, { version, config }),
  updateDraft: (registry: RegistrySlug, version: string, config: unknown) => call<Json>("PUT", `/config/${registry}/versions/${encodeURIComponent(version)}/config`, { config }),
  preview: (registry: RegistrySlug, version: string) => call<Json>("POST", `/config/${registry}/versions/${encodeURIComponent(version)}/preview`, {}),
  returnToDraft: (registry: RegistrySlug, version: string, reason: string) => call<Json>("POST", `/config/${registry}/versions/${encodeURIComponent(version)}/return-to-draft`, { reason }),
  review: (registry: RegistrySlug, version: string, input: { decision: "APPROVED" | "REJECTED"; diffReviewed: boolean; notes: string }) =>
    call<Json>("POST", `/config/${registry}/versions/${encodeURIComponent(version)}/reviews`, input),
  publish: (registry: RegistrySlug, version: string) => call<Json>("POST", `/config/${registry}/versions/${encodeURIComponent(version)}/publish`, {}),
  setCurrent: (registry: RegistrySlug, version: string, reason: string) => call<Json>("POST", `/config/${registry}/versions/${encodeURIComponent(version)}/set-current`, { reason }),

  deliveries: (status: string) => call<{ deliveries: Json[] }>("GET", `/operations/email-deliveries${status ? `?status=${status}` : ""}`),
  retryDelivery: (id: string) => call<Json>("POST", `/operations/email-deliveries/${id}/retry`, {}),
  cancelDelivery: (id: string) => call<Json>("POST", `/operations/email-deliveries/${id}/cancel`, {}),
  jobRuns: () => call<{ runs: Json[] }>("GET", "/operations/jobs"),
  runJob: (job: string) => call<Json>("POST", `/operations/jobs/${job}/run`, {}),

  audit: (projectId?: string) => call<{ events: Json[] }>("GET", `/audit${projectId ? `?projectId=${projectId}` : ""}`),
  adminUsers: () => call<{ users: Json[] }>("GET", "/admin-users"),
  provisionAdmin: (email: string, role: AdminRole) => call<Json>("POST", "/admin-users", { email, role }),
  updateAdmin: (id: string, input: { role?: AdminRole; active?: boolean }) => call<Json>("PATCH", `/admin-users/${id}`, input),
};
