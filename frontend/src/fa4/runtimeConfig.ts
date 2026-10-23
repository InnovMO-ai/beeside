/**
 * Runtime, non-sensitive configuration served by the web tier (`config.json`, public, no rebuild): whether this deployment is the CLOSED STABILIZATION test.
 * One cached request shared by the ribbon and the stabilization notice. Absent / unreadable / not JSON (local dev, root-built staging) = not a closed test:
 * the notice appears only when the deployment says so.
 */
export interface RuntimeConfig { closedTest: boolean; label: string | null }
let cached: Promise<RuntimeConfig> | null = null;
export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  cached ??= fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' })
    .then((r) => (r.ok && /json/.test(r.headers.get('content-type') ?? '') ? r.json() : null))
    .then((c): RuntimeConfig => (c && c.closedTest === true ? { closedTest: true, label: typeof c.label === 'string' ? c.label : null } : { closedTest: false, label: null }))
    .catch((): RuntimeConfig => ({ closedTest: false, label: null }));
  return cached;
}
export const resetRuntimeConfigForTests = () => { cached = null; };
