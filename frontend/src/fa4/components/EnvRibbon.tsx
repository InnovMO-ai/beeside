import { useEffect, useState } from 'react';
import { loadRuntimeConfig } from '../runtimeConfig';

/**
 * A visible strip for non-commercial environments. Two sources, same look:
 *  - build time (VITE_FA4_ENV_LABEL): the internal staging;
 *  - RUNTIME (`config.json` served by the web tier): the CLOSED STABILIZATION deployment in production, so opening commercially is configuration only (no rebuild).
 */
const BUILD_LABEL = (import.meta.env as Record<string, string | undefined>).VITE_FA4_ENV_LABEL;
export function EnvRibbon() {
  const [label, setLabel] = useState<string | null>(BUILD_LABEL || null);
  useEffect(() => {
    if (BUILD_LABEL) return;
    let live = true;
    void loadRuntimeConfig().then((c) => { if (live && c.closedTest && c.label) setLabel(c.label); });
    return () => { live = false; };
  }, []);
  return label ? <div className="env-ribbon" role="note">{label}</div> : null;
}
