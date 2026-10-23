import type { Answers, ClientResolution, PublicCatalog, YourExpansionViewModel } from '@beeside/fa-public-engine';

/** FA Public v1.0 API client (module fa4). The working session token lives only in this tab; returning later uses the emailed link. */
/** Under the production path the build's base is `/discovery/` and the API is reached at `/discovery/api/fa4` (the edge only routes that prefix); at the root it is `/api/fa4`. */
const BASE = `${import.meta.env.BASE_URL}api/fa4`.replace(/\/{2,}/g, '/');
const SESSION_KEY = 'beeside.fa4.session';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: Record<string, unknown>) { super(code); }
}

const ACTIVITY_KEY = 'beeside.fa4.session.at';
/**
 * DSC-01 — a working session belongs to ONE visit. The token lives in this tab only, and it is resumed on a reload only while the visit is recent: a tab that comes back
 * after a long pause (browser restored on another day, a duplicated or old tab) starts clean instead of silently re-opening an earlier project with its answers.
 * The earlier project is never lost: «Guardar y seguir después» e-mails a private link that resumes it explicitly.
 */
export const RESUME_IDLE_MS = 30 * 60 * 1000;
export const sessionStore = {
  get(): string | null { try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; } },
  set(token: string) { try { sessionStorage.setItem(SESSION_KEY, token); sessionStorage.setItem(ACTIVITY_KEY, String(Date.now())); } catch { /* storage unavailable: the session works until the tab closes */ } },
  /** Marks the visit as active (every request that carries the token). */
  touch() { try { if (sessionStorage.getItem(SESSION_KEY)) sessionStorage.setItem(ACTIVITY_KEY, String(Date.now())); } catch { /* ignore */ } },
  /** The token to resume on load, or null (and the stale token is dropped) when the visit has been idle too long or has no activity record. */
  resumable(now = Date.now()): string | null {
    const token = this.get(); if (!token) return null;
    let at = NaN; try { at = Number(sessionStorage.getItem(ACTIVITY_KEY)); } catch { /* ignore */ }
    if (Number.isFinite(at) && at > 0 && now - at >= 0 && now - at <= RESUME_IDLE_MS) return token;
    this.clear(); return null;
  },
  clear() { try { sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(ACTIVITY_KEY); } catch { /* ignore */ } },
};

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? sessionStore.get() : null;
  // Not `Authorization`: gateways such as Google IAP consume that header for their own credentials.
  if (token) headers['X-Fa4-Session'] = token;
  const response = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  // Where the FA4 API is not enabled, a static host answers with HTML: treat it as unavailable.
  if (!(response.headers.get('Content-Type') ?? '').includes('application/json')) throw new ApiError(response.ok ? 503 : response.status, 'NOT_READY');
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (token && response.ok) sessionStore.touch();
  if (!response.ok) throw new ApiError(response.status, typeof data.error === 'string' ? data.error : 'HTTP_ERROR', data.details as Record<string, unknown> | undefined);
  return data as T;
}

export const api = {
  catalog: () => request<PublicCatalog>('GET', '/catalog', undefined, false),
  resolution: (answers: Answers) => request<ClientResolution>('POST', '/session/resolution', { answers }),
  createSession: (answers: Answers, step: string) => request<{ sessionToken: string }>('POST', '/sessions', { answers, step }, false),
  session: () => request<{ answers: Answers; step: string; status: string }>('GET', '/session'),
  save: (answers: Answers, step: string) => request<{ ok: true }>('PUT', '/session', { answers, step }),
  finishLater: () => request<SendResult>('POST', '/session/finish-later', {}),
  generateResult: () => request<{ preview: true; previewToken: string; model: YourExpansionViewModel }>('POST', '/session/result', {}),
  latestResult: () => request<{ resultId: string; delivered: true; model: YourExpansionViewModel }>('GET', '/session/result'),
  emailResult: (previewToken?: string) => request<SendResult>('POST', '/session/result/email', { previewToken }),
  continueWithBeeside: (previewToken?: string) => request<{ ok: true; resultId: string }>('POST', '/session/continue', { previewToken }),
  /** "Hablar con beeside": a message to contact@beeside.you. `clientRequestId` makes a retry / double click idempotent. */
  contact: (p: { name: string; company: string; email: string; message: string; shareProgress: boolean; clientRequestId: string; stage?: 'FA' | 'YEV' }) => request<SendResult>('POST', sessionStore.get() ? '/session/contact' : '/contact', { ...p, locale: document.documentElement.lang === 'en' ? 'en' : 'es' }, true),
  emailStatus: (kind: 'resume' | 'result') => request<{ state: SendState | 'failed' | 'none' }>('GET', `/session/email-status?kind=${kind}`),
  exchangeLink: (token: string) => request<{ sessionToken: string }>('POST', '/links/continue', { token }, false),
  requestLink: (email: string) => request<{ ok: true }>('POST', '/links/request', { email }, false),
};

/** Truthful delivery state. `sent` = the mail server accepted the message; `pending` = still being delivered; anything else throws. */
export type SendState = 'sent' | 'pending';
export interface SendResult { state: SendState; email?: string }

/**
 * Resolves with the FINAL state of an email request: when the server answers `pending` (202) it keeps asking until the delivery is
 * confirmed or failed (bounded). It resolves `'sent'` only on confirmation and throws otherwise — a click is never reported as a send.
 */
export async function confirmSend(first: Promise<SendResult>, kind: 'resume' | 'result' | null, opts: { intervalMs?: number; timeoutMs?: number } = {}): Promise<SendResult> {
  const r = await first;
  if (r.state === 'sent' || !kind) { if (r.state !== 'sent') throw new ApiError(504, 'EMAIL_PENDING'); return r; }
  const deadline = Date.now() + (opts.timeoutMs ?? 40_000);
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, opts.intervalMs ?? 2_000));
    const s = await api.emailStatus(kind).catch(() => null);
    if (s?.state === 'sent') return { ...r, state: 'sent' };
    if (s?.state === 'failed' || s?.state === 'none') throw new ApiError(502, 'EMAIL_NOT_SENT');
  }
  throw new ApiError(504, 'EMAIL_PENDING');
}

// ---- minimal event capture (docs/fa4/ANALYTICS_EVENTS.md) ----
const VISIT_KEY = 'beeside.fa4.visit';
/** Random per-tab id: not derived from the device, gone when the tab closes, never combined with anything else. */
function visitId(): string {
  try {
    let v = sessionStorage.getItem(VISIT_KEY);
    if (!v) { v = crypto.randomUUID(); sessionStorage.setItem(VISIT_KEY, v); }
    return v;
  } catch { return crypto.randomUUID(); }
}
export type ClientEvent = 'visit' | 'language_selected' | 'start_clicked' | 'step_viewed' | 'help_clicked' | 'contact_opened' | 'result_viewed';
/** Fire-and-forget: capture never blocks, delays or breaks the product. Sends no free text and no personal data. */
export function track(name: ClientEvent, extra: { step?: string; props?: Record<string, string> } = {}): void {
  try {
    const token = sessionStore.get();
    void fetch(`${BASE}/events`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Fa4-Session': token } : {}) },
      body: JSON.stringify({ name, visitId: visitId(), ...(extra.step ? { step: extra.step } : {}), ...(extra.props ? { props: extra.props } : {}) }),
    }).catch(() => undefined);
  } catch { /* ignore */ }
}
