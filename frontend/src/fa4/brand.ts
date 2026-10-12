/**
 * Configuration points for items that block PRODUCTION LAUNCH but not Build:
 *  BRAND-1 official logo · BRAND-2 official typography · BRAND-3 final Night Shift treatment
 *  CHK-1   Terms / Privacy / Help Center canonical URLs (closed 2026-10-12, see CANONICAL_URLS).
 */
// Official assets (supplied by beeside marketing; files unmodified): lockup = wordmark + bee. "dark" = for light backgrounds, "light" = for dark ones.
import lockupDark from './assets/brand/lockup-dark.svg';
import lockupLight from './assets/brand/lockup-light.svg';
import beeMarkPurple from './assets/brand/bee-mark-purple.svg';
import lifestyleRelaxed from './assets/brand/lifestyle-relaxed.jpg';

const env = (k: string, d: string): string => ((import.meta.env as Record<string, string | undefined>)[k]) || d;
// Canonical destinations (Design VF, 2026-10-12). Env vars remain only as a deployment override; no placeholder fallbacks.
export const CANONICAL_URLS = {
  terms: 'https://beeside.you/termsandconditions',
  privacy: 'https://beeside.you/Pol%C3%ADticaPrivacidad',   // https://beeside.you/PolíticaPrivacidad
  help: 'https://beeside.you/HelpCenter',
} as const;
/** Human contact for FA: From, Reply-To and contact destination of every FA email (save link, YEV, contact, continuation). */
export const CONTACT_EMAIL = 'contact@beeside.you';

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
    // CHK-1 closed — canonical pages on the beeside website (same page for ES and EN); FA links to them in a new tab and never duplicates them.
    termsUrl: { es: env('VITE_FA4_TERMS_URL_ES', CANONICAL_URLS.terms), en: env('VITE_FA4_TERMS_URL_EN', CANONICAL_URLS.terms) },
    privacyUrl: { es: env('VITE_FA4_PRIVACY_URL_ES', CANONICAL_URLS.privacy), en: env('VITE_FA4_PRIVACY_URL_EN', CANONICAL_URLS.privacy) },
    // Optional marketing consent (D-144): own block in Identity, unchecked, non-blocking. No extra commercial-notices policy link in FA.
  },
  year: 2026,
} as const;
