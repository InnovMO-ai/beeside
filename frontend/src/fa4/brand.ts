/**
 * Configuration points for items that block PRODUCTION LAUNCH but not Build:
 *  BRAND-1 official logo · BRAND-2 official typography · BRAND-3 final Night Shift treatment
 *  CHK-1   Terms / Privacy / Help Center canonical URLs (closed 2026-10-12, see CANONICAL_URLS).
 */
// Official assets (supplied by beeside marketing). The bee in these SVGs is an embedded raster: the blur reported by the PO came from the browser
// down-scaling a 1920×1080 PNG ~16:1. Final Design Delta: the embedded rasters were pre-resampled once (bicubic, same artwork, no redraw, no recolour) to
// ≈3× the display size so they render crisply at DPR 1–3. A native vector from Brand (BRAND-1) would replace these four files. lockup = wordmark + bee. "dark" = for light backgrounds, "light" = for dark ones.
import lockupDark from './assets/brand/lockup-dark.svg';
import lockupLight from './assets/brand/lockup-light.svg';
import beeMarkPurple from './assets/brand/bee-mark-purple.svg';
import lifestyleRelaxed from './assets/brand/lifestyle-relaxed.jpg';
// Discovery v1.0 visual delta (PO-approved photographs, 2026-10-14): editorial Hero of the Your Expansion View (desktop + art-directed mobile crop)
// and one editorial breathing image inside the result. Unmodified photographs: resized / cropped only, never recoloured, mirrored or overlaid with text.
import heroArchitecture from './assets/brand/hero-architecture-wide.jpg';   // tablet + desktop: approved photo, cropped (x 0–95 %, y 20–70 %), not altered
import heroArchitectureMobile from './assets/brand/hero-architecture-mobile.jpg';
import editorialFacade from './assets/brand/editorial-facade.jpg';

const env = (k: string, d: string): string => ((import.meta.env as Record<string, string | undefined>)[k]) || d;
// Canonical destinations (Design VF, 2026-10-12). Env vars remain only as a deployment override; no placeholder fallbacks.
export const CANONICAL_URLS = {
  terms: 'https://beeside.you/termsandconditions',
  privacy: 'https://www.beeside.you/privacy',
  help: 'https://www.beeside.you/helpcenter',
} as const;
/** Human contact for FA: From, Reply-To and contact destination of every FA email (save link, YEV, contact, continuation). */
export const CONTACT_EMAIL = 'contact@beeside.you';

/**
 * «Start Your Expansion» destination (PO, 2026-10-14): the conversion CTA from Discovery/YEV into the Premium purchase/payment flow.
 * The destination is NOT supplied yet (Stripe Checkout, an embedded beeside flow or another approved destination): it is a deployment value,
 * never invented or hardcoded. Only an https URL is accepted. Until it is set, the CTA falls back to the recorded-continuation confirmation (D-154)
 * and the UI says there is no payment yet. EXTERNAL dependency.
 */
const purchase = env('VITE_FA4_PREMIUM_PURCHASE_URL', '');
export const PREMIUM_PURCHASE_URL: string | null = /^https:\/\//i.test(purchase) ? purchase : null;

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
  /** Discovery v1.0: YEV Hero photograph (desktop crop by object-position; mobile = pre-cropped right/top 4:5 so the headline sits on open sky). */
  heroImage: { src: heroArchitecture, mobile: heroArchitectureMobile },
  /** Discovery v1.0: single editorial image between "where you are" and "where beeside adds value". Decorative: never data, never text over it. */
  editorialImage: { src: editorialFacade },
  legal: {
    // CHK-1 closed — canonical pages on the beeside website (same page for ES and EN); FA links to them in a new tab and never duplicates them.
    termsUrl: { es: env('VITE_FA4_TERMS_URL_ES', CANONICAL_URLS.terms), en: env('VITE_FA4_TERMS_URL_EN', CANONICAL_URLS.terms) },
    privacyUrl: { es: env('VITE_FA4_PRIVACY_URL_ES', CANONICAL_URLS.privacy), en: env('VITE_FA4_PRIVACY_URL_EN', CANONICAL_URLS.privacy) },
    // Optional marketing consent (D-144): own block in Identity, unchecked, non-blocking. No extra commercial-notices policy link in FA.
  },
  year: 2026,
} as const;
