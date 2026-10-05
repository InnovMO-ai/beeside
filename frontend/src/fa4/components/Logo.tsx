import { BRAND } from '../brand';

/** BRAND-1: the official beeside lockup (wordmark + bee). Unmodified asset; picks the variant for the background it sits on. */
export function Logo({ onDark = false }: { onDark?: boolean }) {
  return <img className="logo" src={onDark ? BRAND.logo.light : BRAND.logo.dark} alt={BRAND.logo.alt} height={30} />;
}
