import type { Locale, RoutingState } from '../domain/types';
import type { CountryMessageKind } from '../engine/resolve';

export type L10n = { es: string; en: string };
export const L = (es: string, en: string): L10n => ({ es, en });
/**
 * NEEDS_CANONICAL_COPY marker. Identical to L() at runtime, but the id is listed in docs/COPY_INVENTORY.md and a test keeps the
 * source and the inventory in sync. Never invent a replacement: look for literal copy in the frozen Design / DESIGN_HANDOFF /
 * Front Catalog / canonical product files first, and only then remove the marker.
 */
export const NC = (_id: string, es: string, en: string): L10n => ({ es, en });
export const pick = (l: L10n, locale: Locale) => l[locale];

/** CAPABILITY_REGISTRY_FOR_DESIGN §7.1 — canonical, customer-visible. Internal codes never reach the UI. */
export const COUNTRY_MESSAGES: Record<CountryMessageKind, L10n> = {
  UNDEFINED: L('Cuando definas el país, podremos confirmar la cobertura disponible.', 'Once you choose the country, we can confirm the coverage available.'),
  DEVELOPING: L('beeside está desarrollando su red de aliados en este país.', 'beeside is developing its partner network in this country.'),
  NO_ACTIVE_COVERAGE: L('beeside aún no cuenta con cobertura activa en este país.', 'beeside does not yet have active coverage in this country.'),
};

export type VisibleStateKey = 'ACTIVE' | 'SOURCEABLE' | 'REVIEW' | 'DEPENDENT' | 'TO_REVIEW_WITH_SHERPA' | 'TOPIC_TO_CONSIDER';
export const STATE_MESSAGES: Record<VisibleStateKey, L10n> = {
  ACTIVE: L('beeside puede ayudarte', 'beeside can help'),
  SOURCEABLE: L('Tu beeside Sherpa buscará y validará la mejor opción para ti', 'Your beeside Sherpa will find and validate the best option for you'),
  REVIEW: L('beeside puede explorar la mejor opción contigo', 'beeside can explore the best option with you'),
  DEPENDENT: L('Depende de cómo decidas operar', 'It depends on how you decide to operate'),
  TO_REVIEW_WITH_SHERPA: L('Lo revisaremos con tu Sherpa', "We'll review it with your Sherpa"),
  TOPIC_TO_CONSIDER: L('Lo identificamos como un tema a considerar', 'We identified this as a topic to consider'),
};

/** NOT_OFFERED and UNMAPPED_NEED share messages; the variant depends on whether the result shows the Premium continuation (D-096, D-112). */
export function visibleStateKey(state: RoutingState, premiumShown: boolean): VisibleStateKey {
  switch (state) {
    case 'ACTIVE': case 'SOURCEABLE': case 'REVIEW': case 'DEPENDENT': return state;
    case 'NOT_OFFERED': case 'UNMAPPED_NEED': return premiumShown ? 'TO_REVIEW_WITH_SHERPA' : 'TOPIC_TO_CONSIDER';
  }
}
export const visibleStateMessage = (state: RoutingState, premiumShown: boolean) => STATE_MESSAGES[visibleStateKey(state, premiumShown)];

export const PRIVACY_NOTICE = L('Antes de Premium, no compartimos tu proyecto con proveedores.', "Before Premium, we don't share your project with providers.");

const WORDS_ES = ['cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte'];
const WORDS_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
export function numberWord(n: number, locale: Locale): string {
  if (n >= 0 && n <= 20) return (locale === 'es' ? WORDS_ES : WORDS_EN)[n]!;
  return String(n);
}

const ES_OVERRIDES: Record<string, string> = { CZ: 'República Checa', OPEN: 'País por definir' };
const EN_OVERRIDES: Record<string, string> = { OPEN: 'Country to be decided' };
export function countryName(iso: string, locale: Locale): string {
  const o = locale === 'es' ? ES_OVERRIDES[iso] : EN_OVERRIDES[iso];
  if (o) return o;
  try { return new Intl.DisplayNames([locale], { type: 'region' }).of(iso) ?? iso; } catch { return iso; }
}
export const countryL10n = (iso: string): L10n => L(countryName(iso, 'es'), countryName(iso, 'en'));
