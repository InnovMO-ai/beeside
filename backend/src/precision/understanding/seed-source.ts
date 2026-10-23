/** Adapter: Discovery's client-safe context (read through the FaContextService) -> the Understanding seed. */
import type { Db } from "../../db/database";
import { parseCountryCodes, type FaContextService } from "../domain/fa-context";
import type { SeedSource } from "./engine";
import type { DiscoverySeedInput } from "./seed";

export function seedFromFaContext(db: Db, fa: FaContextService): SeedSource {
  return async (projectId, locale) => {
    const read = await fa.read(projectId);
    if (!read) return null;
    const c = read.context;
    let pinId: string | null = null;
    try { pinId = await fa.ensurePin(db, projectId, read); } catch { pinId = null; }
    const input: DiscoverySeedInput = {
      pinId, locale,
      destinationCodes: parseCountryCodes(c.project.destinationCountry),
      ...(c.project.destinationMarket ? { destinationMarket: c.project.destinationMarket } : {}),
      ...(c.project.sector ? { sector: c.project.sector } : {}),
      ...(c.project.expansionObjective ? { objective: c.project.expansionObjective } : {}),
      ...(c.project.timeframe ? { timeframe: c.project.timeframe } : {}),
      operatingCountries: (c.company.operatingCountries ?? []).map((x) => x.toUpperCase()),
      needs: c.needs.map((n) => ({ capabilityId: n.capabilityId, label: n.label, ...(n.priority ? { priority: n.priority } : {}), ...(n.status ? { status: n.status } : {}) })),
      ...(c.literals ? { literals: c.literals } : {}),
    };
    return input;
  };
}
