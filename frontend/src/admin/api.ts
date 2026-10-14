/**
 * Admin/Supervisor Control Center client. The session lives in an HttpOnly cookie set by the backend
 * after the identity-provider sign-in; this code never sees or stores a credential. Every write
 * carries the X-Beeside-Admin header (CSRF defence together with SameSite=Strict cookies).
 */
const BASE = "/api/admin";

export type AdminRole = "ADMIN" | "SUPERVISOR" | "SUPER_ADMIN";
export type Permission =
  | "projects.read"
  | "config.read"
  | "operations.read"
  | "analytics.read"
  | "config.write"
  | "config.publish"
  | "operations.execute"
  | "premium.manage"
  | "audit.read"
  | "admin_users.manage"
  | "entitlement.manage"
  | "entitlement.programs.manage"
  | "privacy.manage";

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

  analytics: (view: "funnel" | "journey-health" | "friction" | "feedback" | "segments" | "operations", query: string) => call<Json>("GET", `/analytics/${view}${query}`),
  feedbackComments: (query: string) => call<{ comments: Json[] }>("GET", `/analytics/feedback/comments${query}`),

  integrationDeliveries: (status: string, destination: string) =>
    call<{ deliveries: Json[] }>("GET", `/operations/integration-deliveries?status=${encodeURIComponent(status)}&destination=${encodeURIComponent(destination)}`),
  retryIntegrationDelivery: (id: string) => call<Json>("POST", `/operations/integration-deliveries/${id}/retry`, {}),

  deliveries: (status: string) => call<{ deliveries: Json[] }>("GET", `/operations/email-deliveries${status ? `?status=${status}` : ""}`),
  retryDelivery: (id: string) => call<Json>("POST", `/operations/email-deliveries/${id}/retry`, {}),
  cancelDelivery: (id: string) => call<Json>("POST", `/operations/email-deliveries/${id}/cancel`, {}),
  jobRuns: () => call<{ runs: Json[] }>("GET", "/operations/jobs"),
  runJob: (job: string) => call<Json>("POST", `/operations/jobs/${job}/run`, {}),

  communicationsTemplates: () => call<Json>("GET", "/communications/templates"),
  updateCommunicationsTemplate: (
    source: "question_bank" | "snapshot_template",
    key: string,
    patch: { locale: "en" | "es"; subject: string; body: string; cta: string; secondaryCta?: string; active?: boolean },
  ) => call<Json>("PUT", `/communications/templates/${source}/${encodeURIComponent(key)}`, patch),

  // ---- entitlement / programs / sponsors / privacy (Precision V1.0)
  entitlement: (id: string) => call<Json>("GET", `/projects/${id}/entitlement`),
  issueGrant: (id: string, input: { source: "complimentary" | "manual"; days: number; reason: string; requestId?: string }) => call<Json>("POST", `/projects/${id}/entitlement/grants`, input),
  issueCompanyGrant: (companyId: string, input: { source: "complimentary" | "manual" | "partner"; companyScope: "current_projects" | "projects_created_in_period"; days: number; maxProjects?: number; reason: string }) =>
    call<Json>("POST", `/companies/${companyId}/entitlement/grants`, input),
  extendGrant: (grantId: string, input: { days: number; reason: string }) => call<Json>("POST", `/entitlement/grants/${grantId}/extend`, input),
  terminateGrant: (grantId: string, reason: string) => call<Json>("POST", `/entitlement/grants/${grantId}/terminate`, { reason }),
  sponsors: () => call<{ sponsors: Json[] }>("GET", "/entitlement/sponsors"),
  createSponsor: (input: { name: string; kind: string; country?: string }) => call<Json>("POST", "/entitlement/sponsors", input),
  programs: () => call<{ programs: Json[] }>("GET", "/entitlement/programs"),
  program: (id: string) => call<Json>("GET", `/entitlement/programs/${id}`),
  createProgram: (input: Json) => call<Json>("POST", "/entitlement/programs", input),
  addEligibleCompany: (programId: string, companyId: string) => call<Json>("POST", `/entitlement/programs/${programId}/eligibility`, { companyId }),
  activateProgram: (programId: string) => call<Json>("POST", `/entitlement/programs/${programId}/activate`, {}),
  closeProgram: (programId: string) => call<Json>("POST", `/entitlement/programs/${programId}/close`, {}),
  redeemProgram: (programId: string, input: { projectId: string; market?: string }) => call<Json>("POST", `/entitlement/programs/${programId}/redeem`, input),
  recordPrivacyEvent: (projectId: string, input: { event: "access_blocked" | "access_restored"; reasonCode: string }) => call<Json>("POST", `/projects/${projectId}/privacy`, input),
  privacyPolicy: () => call<{ policy: Json | null }>("GET", "/privacy/policy"),
  approvePrivacyPolicy: (input: { minDaysAfterBlock: number; retainLegalAcceptance: boolean }) => call<Json>("POST", "/privacy/policy", input),
  erasurePlan: (projectId: string) => call<{ plan: Json; runs: Json[] }>("GET", `/projects/${projectId}/privacy/erasure`),
  executeErasure: (projectId: string, confirmProjectId: string) => call<Json>("POST", `/projects/${projectId}/privacy/erasure`, { confirmProjectId }),

  // ---- Precision links and routes (Admin-managed configuration)
  precisionConfig: () => call<{ entries: Json[]; locales: string[] }>("GET", "/precision/config"),
  setPrecisionConfig: (key: string, input: { locale: string; value: string; reason: string }) => call<Json>("PUT", `/precision/config/${encodeURIComponent(key)}`, input),
  resetPrecisionConfig: (key: string, locale: string) => call<Json>("DELETE", `/precision/config/${encodeURIComponent(key)}?locale=${encodeURIComponent(locale)}`),

  precisionDeliveries: (status: string) => call<{ deliveries: Json[]; counts: Record<string, number> }>("GET", `/precision/deliveries${status ? `?status=${encodeURIComponent(status)}` : ""}`),

  // ---- Precision statistics (same event layer Tableau reads)
  precisionMetrics: (view: "catalog" | "funnel" | "quality" | "ai" | "commercial", query: string) => call<Json>("GET", `/analytics/precision/${view}${query}`),

  audit: (projectId?: string) => call<{ events: Json[] }>("GET", `/audit${projectId ? `?projectId=${projectId}` : ""}`),
  adminUsers: () => call<{ users: Json[] }>("GET", "/admin-users"),
  provisionAdmin: (email: string, role: AdminRole) => call<Json>("POST", "/admin-users", { email, role }),
  updateAdmin: (id: string, input: { role?: AdminRole; active?: boolean }) => call<Json>("PATCH", `/admin-users/${id}`, input),
};
