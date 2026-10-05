/**
 * Configuration points for items that block PRODUCTION LAUNCH but not Build:
 *  BRAND-1 official logo · BRAND-2 official typography · BRAND-3 final Night Shift treatment
 *  CHK-1   final Terms / Privacy links (open in a new tab, ES/EN) · LEGAL-1 commercial-contact legal basis.
 * Nothing here invents final legal language: until CHK-1 closes, the links point at the configured URLs.
 */
const env = (k: string, d: string): string => ((import.meta.env as Record<string, string | undefined>)[k]) || d;

export const BRAND = {
  /** BRAND-1: replace with the official logo asset. Renders a neutral "LOGO" placeholder until then. */
  logo: { src: null as string | null, alt: 'beeside' },
  /** BRAND-2: official typography. System stack placeholder; set via CSS variable --font-sans when approved. */
  fontStack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  /** BRAND-3: placeholder for the lifestyle image on the dark institutional section. */
  lifestyleImage: { src: null as string | null, label: { es: 'Imagen lifestyle · persona relajada · asset pendiente', en: 'Lifestyle image · relaxed person · asset pending' } },
  legal: {
    // CHK-1 — pages already published on the beeside website; FA links to them and never duplicates them.
    // Terms: official page (same document for ES and EN in version 1.0, 2026-08-27). Privacy: PENDING (placeholder until its URL is provided).
    termsUrl: { es: env('VITE_FA4_TERMS_URL_ES', 'https://www.beeside.you/termsandconditions'), en: env('VITE_FA4_TERMS_URL_EN', 'https://www.beeside.you/termsandconditions') },
    privacyUrl: { es: env('VITE_FA4_PRIVACY_URL_ES', env('VITE_FA4_PRIVACY_URL', 'https://beeside.example/legal/privacidad')), en: env('VITE_FA4_PRIVACY_URL_EN', env('VITE_FA4_PRIVACY_URL', 'https://beeside.example/legal/privacy')) },
    /** LEGAL-1 pending: no commercial-contact consent control is rendered until legal defines the basis. */
    commercialContactConsent: null as null | { optional: true },
  },
  year: 2026,
} as const;
