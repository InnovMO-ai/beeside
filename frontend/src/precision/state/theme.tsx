import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
const STORE = "beeside.precision.theme";
interface ThemeCtx { theme: Theme; explicit: Theme | null; toggle: () => void }
const Ctx = createContext<ThemeCtx | null>(null);

function systemTheme(): Theme {
  try { return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; } catch { return "light"; }
}
function readExplicit(): Theme | null {
  try { const v = localStorage.getItem(STORE); return v === "light" || v === "dark" ? v : null; } catch { return null; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [explicit, setExplicit] = useState<Theme | null>(readExplicit);
  const [system, setSystem] = useState<Theme>(systemTheme);
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try { mq = window.matchMedia("(prefers-color-scheme: dark)"); } catch { return; }
    const on = () => setSystem(mq!.matches ? "dark" : "light");
    mq.addEventListener?.("change", on);
    return () => mq!.removeEventListener?.("change", on);
  }, []);
  const theme = explicit ?? system;
  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setExplicit(next);
    try { localStorage.setItem(STORE, next); } catch { /* applies for this visit only */ }
  }, [theme]);
  const value = useMemo(() => ({ theme, explicit, toggle }), [theme, explicit, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("ThemeProvider missing");
  return v;
}
