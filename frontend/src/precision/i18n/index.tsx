import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Locale } from "../api/dto";
import { en, type DictKey } from "./en";
import { es } from "./es";

export type { DictKey };
export const DICTIONARIES: Record<Locale, Record<DictKey, string>> = { en, es };
const STORE = "beeside.precision.locale";

export function readStoredLocale(): Locale | null {
  try { const v = localStorage.getItem(STORE); return v === "en" || v === "es" ? v : null; } catch { return null; }
}
export function detectLocale(): Locale {
  try { return (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en"; } catch { return "en"; }
}
export function interpolate(s: string, params?: Record<string, string | number>): string {
  return params ? s.replace(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : `{${k}}`)) : s;
}

export interface I18n {
  locale: Locale;
  /** An explicit choice by the client is remembered; the entry locale only applies until then. */
  setLocale: (l: Locale) => void;
  applyEntryLocale: (l: Locale) => void;
  t: (key: DictKey, params?: Record<string, string | number>) => string;
  /** Picks `${key}.one` / `${key}.other` and fills {n}. */
  tn: (key: string, n: number, params?: Record<string, string | number>) => string;
  date: (iso: string | null | undefined) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLoc] = useState<Locale>(() => readStoredLocale() ?? initial ?? detectLocale());
  const setLocale = useCallback((l: Locale) => {
    setLoc(l);
    try { localStorage.setItem(STORE, l); } catch { /* remembered for this visit only */ }
  }, []);
  const applyEntryLocale = useCallback((l: Locale) => { if (!readStoredLocale()) setLoc(l); }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const value = useMemo<I18n>(() => {
    const dict = DICTIONARIES[locale];
    const t: I18n["t"] = (key, params) => interpolate(dict[key] ?? key, params);
    const tn: I18n["tn"] = (key, n, params) => interpolate(dict[`${key}.${n === 1 ? "one" : "other"}` as DictKey] ?? key, { n, ...params });
    const date: I18n["date"] = (iso) => {
      if (!iso) return "";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      return new Intl.DateTimeFormat(locale === "es" ? "es-MX" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(d);
    };
    return { locale, setLocale, applyEntryLocale, t, tn, date };
  }, [locale, setLocale, applyEntryLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("I18nProvider missing");
  return v;
}
