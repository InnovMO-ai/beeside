/**
 * Configuration points for items that block PRODUCTION LAUNCH but not Build:
 *  BRAND-1 official logo · BRAND-2 official typography · BRAND-3 final Night Shift treatment
 *  CHK-1   final Terms / Privacy links (open in a new tab, ES/EN) · LEGAL-1 commercial-contact legal basis.
 * Nothing here invents final legal language: until CHK-1 closes, the links point at the configured URLs.
 */
// Official assets (supplied by beeside marketing; files unmodified): lockup = wordmark + bee. "dark" = for light backgrounds, "light" = for dark ones.
import lockupDark from './assets/brand/lockup-dark.svg';
import lockupLight from './assets/brand/lockup-light.svg';
import beeMarkPurple from './assets/brand/bee-mark-purple.svg';
import lifestyleRelaxed from './assets/brand/lifestyle-relaxed.jpg';

const env = (k: string, d: string): string => ((import.meta.env as Record<string, string | undefined>)[k]) || d;
// Internal staging build (VITE_FA4_ENV_LABEL set): until the real Privacy URL exists, link the explicit non-legal TEST page served by the staging server.
const STAGING = !!(import.meta.env as Record<string, string | undefined>).VITE_FA4_ENV_LABEL;
const PRIVACY_FALLBACK = { es: STAGING ? '/staging/privacy-test' : 'https://beeside.example/legal/privacidad', en: STAGING ? '/staging/privacy-test' : 'https://beeside.example/legal/privacy' };

export const BRAND = {
  /** BRAND-1: official logo. The lockup is never redrawn or recoloured; the accessible name is the wordmark itself ("beeside"). */
  logo: { dark: lockupDark, light: lockupLight, mark: beeMarkPurple, alt: 'beeside' },
  /**
   * BRAND-2: no official typeface file/name has been supplied yet. Interim = the font stack of the live First Assessment product
   * (frontend/src/styles.css), so FA 4.0 reads as the same product. Set via --font-sans in fa4.css when the official font is delivered.
   */
  fontStack: '"Helvetica Neue", Helvetica, Arial, system-ui, -apple-system, "Segoe UI", sans-serif',
  /** BRAND-3: the lifestyle image of the frozen institutional section (Option A) — the approved "relaxed person" photo already used by First Assessment. */
  lifestyleImage: { src: lifestyleRelaxed },
  legal: {
    // CHK-1 — pages already published on the beeside website; FA links to them and never duplicates them.
    // Terms: official page (same document for ES and EN in version 1.0, 2026-08-27). Privacy: PENDING (placeholder until its URL is provided).
    termsUrl: { es: env('VITE_FA4_TERMS_URL_ES', 'https://www.beeside.you/termsandconditions'), en: env('VITE_FA4_TERMS_URL_EN', 'https://www.beeside.you/termsandconditions') },
    privacyUrl: { es: env('VITE_FA4_PRIVACY_URL_ES', env('VITE_FA4_PRIVACY_URL', PRIVACY_FALLBACK.es)), en: env('VITE_FA4_PRIVACY_URL_EN', env('VITE_FA4_PRIVACY_URL', PRIVACY_FALLBACK.en)) },
    /** LEGAL-1 pending: no commercial-contact consent control is rendered until legal defines the basis. */
    commercialContactConsent: null as null | { optional: true },
  },
  year: 2026,
} as const;
