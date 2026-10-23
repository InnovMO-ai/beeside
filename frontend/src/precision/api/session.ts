/** The session token lives in memory and, per tab, in sessionStorage (try/catch: it may be blocked). Never localStorage. */
const KEY = "beeside.precision.session";
let memory: { token: string; expiresAt: number | null } | null = null;

export const sessionStore = {
  get(): string | null {
    if (memory) {
      if (memory.expiresAt !== null && memory.expiresAt < Date.now()) { memory = null; sessionStore.clear(); return null; }
      return memory.token;
    }
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { token: string; expiresAt: number | null };
      if (parsed.expiresAt !== null && parsed.expiresAt < Date.now()) { sessionStorage.removeItem(KEY); return null; }
      memory = parsed;
      return parsed.token;
    } catch { return null; }
  },
  set(token: string, expiresAtIso?: string) {
    const t = expiresAtIso ? Date.parse(expiresAtIso) : NaN;
    memory = { token, expiresAt: Number.isFinite(t) ? t : null };
    try { sessionStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* the session lasts until the tab closes */ }
  },
  clear() {
    memory = null;
    try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  },
};
