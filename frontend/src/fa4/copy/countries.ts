import type { Locale } from '@beeside/fa-public-engine';
import { countryName } from '@beeside/fa-public-engine';

// ISO 3166-1 alpha-2 (sovereign states and common territories). Names come from Intl.DisplayNames (ES/EN).
const CODES = 'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KM KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NZ OM PA PE PG PH PK PL PR PT PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SN SO SR SS SV SY SZ TD TG TH TJ TM TN TO TR TT TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW'.split(' ');

export function allCountries(locale: Locale): Array<{ iso: string; name: string }> {
  return CODES.map((iso) => ({ iso, name: countryName(iso, locale) })).sort((a, b) => a.name.localeCompare(b.name, locale));
}
