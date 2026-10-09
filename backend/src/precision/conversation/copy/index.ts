import { COPY_ENTRIES, SUPERSEDED_COPY_KEYS, type CopyEntry } from "./entries";
import { expandCrpToken } from "../process-knowledge/term-registry";
import type { Locale } from "../types";

export { COPY_ENTRIES, SUPERSEDED_COPY_KEYS };
export type { CopyEntry };

const BY_KEY: ReadonlyMap<string, CopyEntry> = new Map(COPY_ENTRIES.map((e) => [e.key, e]));

export type CopyKey = string;
export const ALL_COPY_KEYS: readonly string[] = COPY_ENTRIES.map((e) => e.key);

export function hasCopy(key: string): boolean {
  return BY_KEY.has(key);
}

export interface CopyResult {
  key: string;
  text: string;
  /** Introduced terms after this text was shown. */
  introduced: Set<string>;
}

/**
 * Returns the localized fixed text for `key`. `{crp}` expands to "Category Requirement Pack (CRP)" the first
 * time and to "CRP" afterwards; other `{name}` parameters must be supplied.
 */
export function copyText(
  key: string,
  locale: Locale,
  params: Readonly<Record<string, string>> = {},
  introduced: ReadonlySet<string> = new Set(),
): CopyResult {
  const entry = BY_KEY.get(key);
  if (!entry) throw new Error(`unknown copy key: ${key}`);
  const raw = entry[locale];
  const crp = expandCrpToken(raw, introduced);
  const text = crp.text.replace(/\{([A-Za-z_]+)\}/g, (_m, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`copy ${key}: missing parameter {${name}}`);
    return v;
  });
  return { key, text, introduced: crp.introduced };
}

/** Convenience for texts with no `{crp}` token and no parameters. */
export function plainCopy(key: string, locale: Locale, params: Readonly<Record<string, string>> = {}): string {
  return copyText(key, locale, params).text;
}

export function copyEntry(key: string): CopyEntry {
  const e = BY_KEY.get(key);
  if (!e) throw new Error(`unknown copy key: ${key}`);
  return e;
}
