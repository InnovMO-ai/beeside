import { BRAND } from '../brand';
/** BRAND-1: renders a neutral placeholder until the official logo asset is configured. The logo is never redrawn or recoloured. */
export function Logo({ onDark = false }: { onDark?: boolean }) {
  if (BRAND.logo.src) return <img src={BRAND.logo.src} alt={BRAND.logo.alt} height={28} />;
  return <span className="logo-ph" style={onDark ? { color: '#d9d2f4', borderColor: '#d9d2f4' } : undefined} aria-label="beeside">LOGO</span>;
}
