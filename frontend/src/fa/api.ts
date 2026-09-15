import { Bundle, ExtensionReason, LinkChoices, Locale, PremiumActivationResult, PremiumContent, PremiumStatus, SessionView, SnapshotView } from "./types";

/** Post-Snapshot feedback: the frozen question and its scale come from the server. */
export interface FeedbackCopy {
  question: string;
  scale_min: string;
  scale_max: string;
  comment_label: string;
  optional: string;
  submit: string;
  thanks: string;
  rating_required: string;
  error: string;
}

export interface FeedbackStatus {
  available: boolean;
  submitted: boolean;
  questionVersion: string;
  copy: Record<Locale, FeedbackCopy>;
}

export interface FeedbackInput {
  usefulness: number;
  comment: string | null;
}

const BASE = "/api/fa";
const SESSION_KEY = "beeside.fa.session";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
  }
}

/** The working session lives only for this browser tab; returning later uses the private email link. */
export const sessionStore = {
  get(): string | null {
    try {
      return sessionStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      sessionStorage.setItem(SESSION_KEY, token);
    } catch {
      // storage unavailable: the session still works until the tab is closed
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  },
};

async function request<T>(method: string, path: string, body?: unknown, auth = false): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = auth ? sessionStore.get() : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Where the First Assessment API is not enabled, a static host answers with HTML: treat it as unavailable.
  if (!(response.headers.get("Content-Type") ?? "").includes("application/json")) {
    throw new ApiError(response.ok ? 503 : response.status, "NOT_READY");
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(response.status, typeof data.error === "string" ? data.error : "HTTP_ERROR", data.details as Record<string, unknown> | undefined);
  }
  return data as T;
}

export const api = {
  currentBundle: () => request<{ version: string; bundle: Bundle }>("GET", "/bundles/current"),
  bundle: (version: string) => request<{ version: string; bundle: Bundle }>("GET", `/bundles/${encodeURIComponent(version)}`),
  submitIdentity: (input: Record<string, unknown>) =>
    request<{ status: "started"; sessionToken: string } | { status: "verification_required" }>("POST", "/identity", input),
  session: () => request<SessionView>("GET", "/session", undefined, true),
  saveAnswer: (questionId: string, value: unknown) =>
    request<SessionView>("PUT", `/session/answers/${encodeURIComponent(questionId)}`, { value }, true),
  completeStep: (stepId: string, durationMs: number | null) =>
    request<SessionView>("POST", `/session/steps/${encodeURIComponent(stepId)}/complete`, { durationMs }, true),
  setInterfaceLanguage: (language: string) => request<SessionView>("PUT", "/session/interface-language", { language }, true),
  finishLater: () => request<{ saved: true; accessUntil: string | null }>("POST", "/session/finish-later", {}, true),
  anotherProject: (acceptLegal: boolean) => request<{ sessionToken: string }>("POST", "/session/another-project", { acceptLegal }, true),
  openLink: (token: string) => request<LinkChoices>("POST", "/links/open", { token }),
  continueLink: (token: string) => request<{ sessionToken: string }>("POST", "/links/continue", { token }),
  extendLink: (token: string, days: 15 | 30, reason: ExtensionReason) =>
    request<{ accessUntil: string }>("POST", "/links/extend", { token, days, reason }),
  newProjectFromLink: (token: string, input: { sameCompany: boolean; acceptLegal: boolean; companyName?: string; companyWebsite?: string }) =>
    request<{ sessionToken: string }>("POST", "/links/new-project", { token, ...input }),
  sessionSnapshot: () => request<SnapshotView>("GET", "/session/snapshot", undefined, true),
  linkSnapshot: (token: string) => request<SnapshotView>("POST", "/links/snapshot", { token }),
  premiumContent: () => request<PremiumContent>("GET", "/premium/content"),
  sessionPremium: () => request<PremiumStatus>("GET", "/session/premium", undefined, true),
  sessionPremiumActivation: (acceptTerms: boolean) => request<PremiumActivationResult>("POST", "/session/premium/activation", { acceptTerms }, true),
  linkPremium: (token: string) => request<PremiumStatus>("POST", "/links/premium", { token }),
  linkPremiumActivation: (token: string, acceptTerms: boolean) => request<PremiumActivationResult>("POST", "/links/premium/activation", { token, acceptTerms }),
  countries: () => request<{ codes: string[] }>("GET", "/reference/countries"),
  requestLink: (email: string) => request<{ status: "accepted" }>("POST", "/links/request", { email }),
  events: (payload: { anonymousSessionId: string; linkToken?: string | null; events: unknown[] }) => request<{ accepted: number }>("POST", "/events", payload, true),
  sessionFeedback: () => request<FeedbackStatus>("GET", "/session/feedback", undefined, true),
  submitSessionFeedback: (input: FeedbackInput) => request<FeedbackStatus>("POST", "/session/feedback", input, true),
  linkFeedback: (token: string) => request<FeedbackStatus>("POST", "/links/feedback", { token }),
  submitLinkFeedback: (token: string, input: FeedbackInput) => request<FeedbackStatus>("POST", "/links/feedback/submit", { token, ...input }),
};
