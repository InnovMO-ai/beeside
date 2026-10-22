import type { Locale } from '@beeside/fa-public-engine';
import { CANONICAL_URLS } from '../brand';

/** The external Help Center (new tab, D-137). A deployment override exists; otherwise the canonical page. */
export const HELP_URL: Record<Locale, string> = {
  es: (import.meta.env.VITE_FA4_HELP_URL_ES as string | undefined) || CANONICAL_URLS.help,
  en: (import.meta.env.VITE_FA4_HELP_URL_EN as string | undefined) || CANONICAL_URLS.help,
};
