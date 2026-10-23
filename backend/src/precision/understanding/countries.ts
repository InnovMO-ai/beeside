/**
 * Country vocabulary for reading free narrative (es/en names and demonyms). A mention is only a *lead*: roles are decided by the
 * interpreter from the surrounding words, and every country entry carries the client's quote.
 */
import { fold, hasTerm, termRegex } from "./text";

export interface CountryDef { code: string; es: string; en: string; names: string[]; demonyms: string[] }

const k = (code: string, es: string, en: string, names: string[] = [], demonyms: string[] = []): CountryDef => ({ code, es, en, names: [es, en, ...names], demonyms });

export const COUNTRIES: readonly CountryDef[] = [
  k("MX", "México", "Mexico", ["mexico"], ["mexican*"]),
  k("US", "Estados Unidos", "United States", ["EEUU", "EE.UU", "EE UU", "USA", "US", "los estados unidos", "norteamerica"], ["estadounidense*", "americano*", "american*"]),
  k("CA", "Canadá", "Canada", [], ["canadiense*", "canadian*"]),
  k("PT", "Portugal", "Portugal", [], ["portugues*", "portuguesa*", "portuguese"]),
  k("ES", "España", "Spain", ["espana"], ["espanol*", "espanola*", "spanish"]),
  k("FR", "Francia", "France", [], ["frances*", "francesa*", "french"]),
  k("DE", "Alemania", "Germany", [], ["aleman*", "alemana*", "german*"]),
  k("IT", "Italia", "Italy", [], ["italiano*", "italiana*", "italian*"]),
  k("GB", "Reino Unido", "United Kingdom", ["UK", "Inglaterra", "England", "Gran Bretana"], ["britanic*", "ingles*", "british"]),
  k("NL", "Países Bajos", "Netherlands", ["paises bajos", "Holanda", "Holland"], ["holandes*", "neerlandes*", "dutch"]),
  k("BE", "Bélgica", "Belgium", ["belgica"], ["belga*", "belgian*"]),
  k("CH", "Suiza", "Switzerland", [], ["suizo*", "suiza*", "swiss"]),
  k("PL", "Polonia", "Poland", [], ["polaco*", "polaca*", "polish"]),
  k("SE", "Suecia", "Sweden", [], ["sueco*", "sueca*", "swedish"]),
  k("DK", "Dinamarca", "Denmark", [], ["danes*", "danesa*", "danish"]),
  k("NO", "Noruega", "Norway", [], ["noruego*", "noruega*", "norwegian*"]),
  k("FI", "Finlandia", "Finland", [], ["finlandes*", "finnish"]),
  k("IE", "Irlanda", "Ireland", [], ["irlandes*", "irish"]),
  k("AT", "Austria", "Austria", [], ["austriac*", "austrian*"]),
  k("CZ", "Chequia", "Czechia", ["Republica Checa", "Czech Republic"], ["checo*", "czech"]),
  k("TR", "Turquía", "Turkey", ["turquia"], ["turco*", "turca*", "turkish"]),
  k("CN", "China", "China", [], ["chino*", "china*", "chinese"]),
  k("JP", "Japón", "Japan", ["japon"], ["japones*", "japonesa*", "japanese"]),
  k("KR", "Corea del Sur", "South Korea", ["Corea"], ["coreano*", "coreana*", "korean*"]),
  k("IN", "India", "India", [], ["hindu*", "indio*", "india*", "indian*"]),
  k("SG", "Singapur", "Singapore", [], ["singapurense*", "singaporean*"]),
  k("AE", "Emiratos Árabes Unidos", "United Arab Emirates", ["emiratos arabes", "UAE", "Dubai"], ["emirati*"]),
  k("SA", "Arabia Saudita", "Saudi Arabia", [], ["saudi*", "saudita*"]),
  k("BR", "Brasil", "Brazil", [], ["brasileno*", "brasilena*", "brazilian*"]),
  k("AR", "Argentina", "Argentina", [], ["argentino*", "argentina*", "argentinian*"]),
  k("CL", "Chile", "Chile", [], ["chileno*", "chilena*", "chilean*"]),
  k("CO", "Colombia", "Colombia", [], ["colombiano*", "colombiana*", "colombian*"]),
  k("PE", "Perú", "Peru", ["peru"], ["peruano*", "peruana*", "peruvian*"]),
  k("EC", "Ecuador", "Ecuador", [], ["ecuatoriano*", "ecuadorian*"]),
  k("UY", "Uruguay", "Uruguay", [], ["uruguayo*", "uruguaya*", "uruguayan*"]),
  k("PA", "Panamá", "Panama", ["panama"], ["panameno*", "panamena*", "panamanian*"]),
  k("CR", "Costa Rica", "Costa Rica", [], ["costarricense*", "tico*", "costa rican*"]),
  k("GT", "Guatemala", "Guatemala", [], ["guatemalteco*", "guatemalan*"]),
  k("DO", "República Dominicana", "Dominican Republic", ["republica dominicana"], ["dominicano*", "dominican*"]),
  k("AU", "Australia", "Australia", [], ["australiano*", "australian*"]),
  k("NZ", "Nueva Zelanda", "New Zealand", [], ["neozelandes*", "new zealander*"]),
  k("ZA", "Sudáfrica", "South Africa", ["sudafrica"], ["sudafricano*", "south african*"]),
  k("IL", "Israel", "Israel", [], ["israeli*"]),
  k("VN", "Vietnam", "Vietnam", [], ["vietnamita*", "vietnamese"]),
  k("TH", "Tailandia", "Thailand", [], ["tailandes*", "thai"]),
  k("ID", "Indonesia", "Indonesia", [], ["indonesio*", "indonesian*"]),
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));
export const countryByCode = (code: string): CountryDef | undefined => BY_CODE.get(code.toUpperCase());
export const countryName = (code: string, locale: "es" | "en"): string => {
  const c = BY_CODE.get(code.toUpperCase());
  return c ? c[locale] : code;
};

export interface CountryMention { code: string; index: number; end: number; term: string; demonym: boolean }

const ABBREVIATIONS = new Set(["us", "uk", "usa", "uae", "eeuu"]);

/** Every country mention (name or demonym) with its position in the folded text, in reading order. */
export function findCountryMentions(foldedText: string, original?: string): CountryMention[] {
  const out: CountryMention[] = [];
  for (const c of COUNTRIES) {
    for (const n of c.names) {
      const t = fold(n);
      const abbr = ABBREVIATIONS.has(t) || t === "ee uu";
      // Short abbreviations ("US", "UK") only count when written in capitals in the original text (the English word "us" is not a country).
      if (abbr && original && !new RegExp(`(?<![A-Za-z])${n.replace(/[.]/g, "\\.?")}(?![A-Za-z])`).test(original)) continue;
      const m = termRegex(n).exec(foldedText);
      if (m) out.push({ code: c.code, index: m.index, end: m.index + m[0].length, term: n, demonym: false });
    }
    for (const d of c.demonyms) {
      const m = termRegex(d).exec(foldedText);
      if (m) out.push({ code: c.code, index: m.index, end: m.index + m[0].length, term: d, demonym: true });
    }
  }
  // De-duplicate by (code, index-ish): keep the earliest mention of each code per kind.
  const seen = new Set<string>();
  return out
    .sort((a, b) => a.index - b.index)
    .filter((m) => {
      const key = `${m.code}:${m.demonym}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export const mentionsCountry = (foldedText: string, code: string): boolean => {
  const c = BY_CODE.get(code);
  if (!c) return false;
  return c.names.some((n) => hasTerm(foldedText, fold(n))) || c.demonyms.some((d) => hasTerm(foldedText, d));
};
