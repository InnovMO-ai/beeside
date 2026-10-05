/** Internal staging only: a visible strip set at build time (VITE_FA4_ENV_LABEL). Absent in public builds. */
const LABEL = (import.meta.env as Record<string, string | undefined>).VITE_FA4_ENV_LABEL;
export function EnvRibbon() {
  return LABEL ? <div className="env-ribbon" role="note">{LABEL}</div> : null;
}
