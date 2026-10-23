/** Geography helpers: the granularity guard depends on knowing what a unit IS (state vs municipality/city). */
import { fold } from "./text";

export const MX_STATES = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Ciudad de México", "Coahuila", "Colima", "Durango",
  "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "México", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro",
  "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
] as const;

/** Aliases that should resolve to a state. */
const STATE_ALIASES: Record<string, string> = {
  cdmx: "Ciudad de México", "distrito federal": "Ciudad de México", "estado de mexico": "México", edomex: "México", "nuevo leon": "Nuevo León",
  queretaro: "Querétaro", yucatan: "Yucatán", "san luis potosi": "San Luis Potosí", michoacan: "Michoacán", "bc": "Baja California",
};

/** Cities / municipalities clients commonly name. A mention of one is NOT a state: state-level sources cannot speak about it. */
export const MX_PLACES: { name: string; state: string }[] = [
  { name: "Monterrey", state: "Nuevo León" }, { name: "San Pedro Garza García", state: "Nuevo León" }, { name: "Apodaca", state: "Nuevo León" }, { name: "Guadalupe", state: "Nuevo León" },
  { name: "Guadalajara", state: "Jalisco" }, { name: "Zapopan", state: "Jalisco" }, { name: "Tlaquepaque", state: "Jalisco" },
  { name: "Tijuana", state: "Baja California" }, { name: "Mexicali", state: "Baja California" }, { name: "Ensenada", state: "Baja California" },
  { name: "Ciudad Juárez", state: "Chihuahua" }, { name: "San Juan del Río", state: "Querétaro" }, { name: "El Marqués", state: "Querétaro" },
  { name: "León", state: "Guanajuato" }, { name: "Silao", state: "Guanajuato" }, { name: "Celaya", state: "Guanajuato" }, { name: "Irapuato", state: "Guanajuato" },
  { name: "Saltillo", state: "Coahuila" }, { name: "Ramos Arizpe", state: "Coahuila" }, { name: "Torreón", state: "Coahuila" },
  { name: "Cancún", state: "Quintana Roo" }, { name: "Playa del Carmen", state: "Quintana Roo" }, { name: "Mérida", state: "Yucatán" }, { name: "Toluca", state: "México" }, { name: "Naucalpan", state: "México" },
  { name: "Reynosa", state: "Tamaulipas" }, { name: "Nuevo Laredo", state: "Tamaulipas" }, { name: "Matamoros", state: "Tamaulipas" }, { name: "Altamira", state: "Tamaulipas" },
  { name: "Hermosillo", state: "Sonora" }, { name: "Nogales", state: "Sonora" }, { name: "Manzanillo", state: "Colima" },
  { name: "Lázaro Cárdenas", state: "Michoacán" }, { name: "Coatzacoalcos", state: "Veracruz" }, { name: "Villahermosa", state: "Tabasco" }, { name: "Dos Bocas", state: "Tabasco" }, { name: "Benito Juárez", state: "Ciudad de México" },
];

const folded = (s: string): string => fold(s);

export interface GeoMention { kind: "state" | "place"; name: string; state: string }

export function findStates(text: string): string[] {
  const f = ` ${folded(text)} `;
  const out = new Set<string>();
  // longest names first so "Baja California Sur" wins over "Baja California", "Ciudad de México" over "México"
  const names = [...MX_STATES].sort((a, b) => b.length - a.length);
  let rest = f;
  for (const n of names) {
    const fn = folded(n);
    const re = new RegExp(`(?<![a-z])${fn}(?![a-z])`, "g");
    if (re.test(rest)) { out.add(n); rest = rest.replace(re, " "); }
  }
  for (const [alias, st] of Object.entries(STATE_ALIASES)) {
    if (new RegExp(`(?<![a-z])${alias}(?![a-z])`).test(rest)) out.add(st);
  }
  return [...out];
}

export function findPlaces(text: string): GeoMention[] {
  // state names are removed first: "Nuevo León" is a state, not the city of León
  let f = ` ${folded(text)} `;
  for (const n of [...MX_STATES].sort((a, b) => b.length - a.length)) f = f.replace(new RegExp(`(?<![a-z])${folded(n)}(?![a-z])`, "g"), " ");
  const out: GeoMention[] = [];
  for (const p of MX_PLACES) {
    const base = folded(p.name);
    // "Leon" alone is also the Spanish for the animal and a state-name fragment; require a place context or city-ish capitalisation in original
    if (new RegExp(`(?<![a-z])${base}(?![a-z])`).test(f)) out.push({ kind: "place", name: p.name, state: p.state });
  }
  // generic "municipio de X" / "ciudad de X" / "city of X"
  const re = /\b([Mm]unicipio|[Cc]iudad|[Cc]ity|[Tt]own|[Aa]lcald[ií]a|[Dd]elegaci[oó]n)\s+(?:de|del|of)\s+([A-ZÁÉÍÓÚÑ][a-zñáéíóú]+(?:\s(?:(?:de|del|la|el)\s)?[A-ZÁÉÍÓÚÑ][a-zñáéíóú]+){0,2})/g;
  for (const m of text.matchAll(re)) {
    const name = m[2] ?? "";
    const isCdmx = folded(name).startsWith("mexico") && folded(m[1] ?? "") === "ciudad";
    if (name && !isCdmx && !out.some((x) => folded(x.name) === folded(name))) out.push({ kind: "place", name, state: findStates(name)[0] ?? "" });
  }
  return out;
}

export function isStateName(name: string): boolean { return findStates(name).length > 0; }
