import type { Answers, ClientResolution, PublicCatalog, YourExpansionViewModel } from '@beeside/fa-public-engine';

/** FA Public v1.0 API client (module fa4). The working session token lives only in this tab; returning later uses the emailed link. */
const BASE = '/api/fa4';
const SESSION_KEY = 'beeside.fa4.session';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly details?: Record<string, unknown>) { super(code); }
}

export const sessionStore = {
  get(): string | null { try { return sessionStorage.getItem(SESSION_KEY); } catch { return null; } },
  set(token: string) { try { sessionStorage.setItem(SESSION_KEY, token); } catch { /* storage unavailable: the session works until the tab closes */ } },
  clear() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } },
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
  if (!response.ok) throw new ApiError(response.status, typeof data.error === 'string' ? data.error : 'HTTP_ERROR', data.details as Record<string, unknown> | undefined);
  return data as T;
}

export const api = {
  catalog: () => request<PublicCatalog>('GET', '/catalog', undefined, false),
  resolution: (answers: Answers) => request<ClientResolution>('POST', '/session/resolution', { answers }),
  createSession: (answers: Answers, step: string) => request<{ sessionToken: string }>('POST', '/sessions', { answers, step }, false),
  session: () => request<{ answers: Answers; step: string; status: string }>('GET', '/session'),
  save: (answers: Answers, step: string) => request<{ ok: true }>('PUT', '/session', { answers, step }),
  finishLater: () => request<{ ok: true; email: string }>('POST', '/session/finish-later', {}),
  generateResult: () => request<{ resultId: string; model: YourExpansionViewModel }>('POST', '/session/result', {}),
  latestResult: () => request<{ resultId: string; model: YourExpansionViewModel }>('GET', '/session/result'),
  emailResult: () => request<{ ok: true }>('POST', '/session/result/email', {}),
  continueWithBeeside: () => request<{ ok: true }>('POST', '/session/continue', {}),
  exchangeLink: (token: string) => request<{ sessionToken: string }>('POST', '/links/continue', { token }, false),
};
