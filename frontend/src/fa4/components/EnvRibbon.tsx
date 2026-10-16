import { useEffect, useState } from 'react';

/**
 * A visible strip for non-commercial environments. Two sources, same look:
 *  - build time (VITE_FA4_ENV_LABEL): the internal staging;
 *  - RUNTIME (`config.json` served by the web tier): the CLOSED TEST deployment in production ("PRUEBA CONTROLADA · datos ficticios · no comercial"),
 *    so opening commercially is configuration only (no rebuild). Absent / unreadable config = no ribbon; it never blocks the page.
 */
const BUILD_LABEL = (import.meta.env as Record<string, string | undefined>).VITE_FA4_ENV_LABEL;
export function EnvRibbon() {
  const [label, setLabel] = useState<string | null>(BUILD_LABEL || null);
  useEffect(() => {
    if (BUILD_LABEL) return;
    let live = true;
    fetch(`${import.meta.env.BASE_URL}config.json`, { cache: 'no-store' })
      .then((r) => (r.ok && /json/.test(r.headers.get('content-type') ?? '') ? r.json() : null))
      .then((c) => { if (live && c && c.closedTest === true && typeof c.label === 'string') setLabel(c.label); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);
  return label ? <div className="env-ribbon" role="note">{label}</div> : null;
}
