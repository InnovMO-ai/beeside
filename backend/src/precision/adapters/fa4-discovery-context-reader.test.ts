import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { journeyA, journeyNortica } from "@beeside/fa-public-engine/testing";
import {
  Answers, RESOLUTION_SCHEMA_VERSION, RULES_VERSION, SOURCE_SCHEMA_VERSION, buildResolutionSnapshot, buildSourceSnapshot, mapSealedResultToPrecisionContext, resolveAll,
  type Fa4PrecisionContextV1,
} from "@beeside/fa-public-engine";
import { portugueseEnergyAnswers } from "../../__tests__/helpers/discovery-real";
import { createFaContextService } from "../domain/fa-context";
import { Fa4DiscoveryContextReader, SUPPORTED_CONTRACT, UnsupportedDiscoveryContractError, declaredStatements, toClientSafeContext } from "./fa4-discovery-context-reader";

jest.mock("../../fa4/precision", () => ({ getFa4PrecisionContext: jest.fn() }));
import { getFa4PrecisionContext } from "../../fa4/precision";

/** The contract exactly as Discovery produces it (its own engine, its own catalog, its own mapper), without a database. */
function contractOf(a: Answers, resultId = "11111111-1111-4111-8111-111111111111"): Fa4PrecisionContextV1 {
  const res = resolveAll(a, SEED_CATALOG);
  return mapSealedResultToPrecisionContext({
    projectId: "22222222-2222-4222-8222-222222222222", resultId, deliveredAt: "2026-10-15T12:00:00.000Z", catalogVersion: SEED_CATALOG.version, rulesVersion: RULES_VERSION,
    sourceSchemaVersion: SOURCE_SCHEMA_VERSION, sourceSnapshot: buildSourceSnapshot(a), resolutionSchemaVersion: RESOLUTION_SCHEMA_VERSION, resolutionSnapshot: buildResolutionSnapshot(res),
  });
}
const names = new Map(SEED_CATALOG.capabilities.map((c) => [c.capabilityId, c.nameEs]));

describe("Discovery contract -> Precision client-safe context (pure mapping)", () => {
  const pt = contractOf(portugueseEnergyAnswers());
  const ctx = toClientSafeContext(pt, (id) => names.get(id));

  it("carries identity, destination, sector, origin and the client's own words", () => {
    expect(ctx.project.destinationCountry).toBe("MX");
    expect(ctx.project.sector).toMatch(/energía/i);
    expect(ctx.company).toMatchObject({ displayName: "Empresa Portuguesa", operatingCountries: ["PT"], sizeBand: "51-250" });
    expect(ctx.project.expansionObjective).toMatch(/proyectos del sector energético/);
    expect(ctx.literals.motive).toMatch(/subcontratados/);
    expect(ctx.locale).toBe("es");
  });

  it("says in plain Spanish what Discovery already knows (presence, permanence, duration, activities, what moves) so it is never re-asked", () => {
    const text = ctx.literals.context ?? "";
    expect(text).toMatch(/temporal \(30 meses\)/);
    expect(text).toMatch(/contratar personal/);
    expect(text).toMatch(/ejecución propia en sitio/);
    expect(text).toMatch(/personas y equipo/);
    expect(text).toMatch(/hoy no tiene actividad allí/);
  });

  it("lists as needs only what Discovery DETERMINED, with Precision-visible names from the immutable catalog version, each id once", () => {
    expect(ctx.needs.length).toBeGreaterThan(0);
    const ids = ctx.needs.map((n) => n.capabilityId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of ctx.needs) { expect(names.has(n.capabilityId)).toBe(true); expect(n.label).toBe(names.get(n.capabilityId)); }
    const maybe = pt.derived.destinations.flatMap((d) => d.needs).filter((n) => n.possible).flatMap((n) => n.capabilities.map((c) => c.capabilityId));
    for (const id of maybe) if (!pt.derived.destinations.flatMap((d) => d.needs).some((n) => !n.possible && n.capabilities.some((c) => c.capabilityId === id))) expect(ids).not.toContain(id);
  });

  it("never invents a priority: only a topic the client marked critical is 'high'", () => {
    const critical = new Set(pt.derived.destinations.flatMap((d) => d.needs).filter((n) => n.critical).flatMap((n) => n.capabilities.map((c) => c.capabilityId)));
    for (const n of ctx.needs) expect(n.priority === "high").toBe(critical.has(n.capabilityId));
    expect(ctx.needs.every((n) => n.priority === undefined || n.priority === "high")).toBe(true);
  });

  it("holds no contact data, consent, legal acceptance or rendered view", () => {
    const json = JSON.stringify(ctx);
    expect(json).not.toMatch(/@|termsAccepted|marketingConsent|expansion[_ ]view|radar/i);
    expect(declaredStatements(pt).join(" ")).not.toMatch(/@/);
  });

  it("handles multi-destination, open destinations and 'I don't know' states without inventing values", () => {
    const multi = contractOf(journeyA("en"));
    const c = toClientSafeContext(multi, (id) => names.get(id));
    expect(c.project.destinationCountry.split(", ").length).toBe(multi.declared.destinations.list.length);
    const open = contractOf(Object.assign(journeyNortica("es"), { destinations: { list: [], open: true, sameInAll: null } }));
    expect(toClientSafeContext(open, () => undefined).project.destinationCountry).toBe("");
  });
});

describe("Fa4DiscoveryContextReader — contract/version handling", () => {
  const fakeDb = (row: boolean) => ({
    query: jest.fn(async (sql: string) => {
      if (/FROM fa4_result/.test(sql)) return { rows: row ? [{ result_id: "11111111-1111-4111-8111-111111111111" }] : [] };
      if (/fa4_catalog_version/.test(sql)) return { rows: [{ content: SEED_CATALOG }] };
      return { rows: [] };
    }),
  }) as never;
  const mocked = getFa4PrecisionContext as jest.Mock;
  beforeEach(() => mocked.mockReset());

  it("nothing delivered yet is a normal null", async () => {
    expect(await new Fa4DiscoveryContextReader(fakeDb(false)).read("22222222-2222-4222-8222-222222222222")).toBeNull();
    expect(mocked).not.toHaveBeenCalled();
  });

  it("pins the exact result, the contract version and a hash of what Discovery handed over", async () => {
    const c = contractOf(portugueseEnergyAnswers());
    mocked.mockResolvedValue(c);
    const r = (await new Fa4DiscoveryContextReader(fakeDb(true)).read(c.ids.projectId))!;
    expect(r).toMatchObject({ sourceSystem: "fa4", sourceProjectId: c.ids.projectId, sourceResultId: c.ids.resultId, contractVersion: SUPPORTED_CONTRACT, catalogVersion: SEED_CATALOG.version });
    expect(r.contextHash).toMatch(/^[0-9a-f]{64}$/);
    expect((await new Fa4DiscoveryContextReader(fakeDb(true)).read(c.ids.projectId))!.contextHash).toBe(r.contextHash);
  });

  it("refuses a contract version Precision does not know — loudly, never a guess; the service reports Discovery as unavailable", async () => {
    const c = contractOf(portugueseEnergyAnswers());
    mocked.mockResolvedValue({ ...c, contract: { ...c.contract, version: "fa4-precision-context/2" } });
    const reader = new Fa4DiscoveryContextReader(fakeDb(true));
    await expect(reader.read(c.ids.projectId)).rejects.toBeInstanceOf(UnsupportedDiscoveryContractError);
    const logs: string[] = [];
    const svc = createFaContextService(reader, (_l, m) => void logs.push(m));
    expect(await svc.readWithStatus(c.ids.projectId)).toEqual({ read: null, failed: true });
    expect(logs).toContain("fa context unavailable");
  });

  it("never bridges a context that names another project (permanent identity)", async () => {
    mocked.mockResolvedValue(contractOf(portugueseEnergyAnswers()));
    await expect(new Fa4DiscoveryContextReader(fakeDb(true)).read("33333333-3333-4333-8333-333333333333")).rejects.toThrow(/another project/);
  });

  it("an erased or ineligible result yields nothing to inherit (null), not an error", async () => {
    const { FaError } = jest.requireActual("../../fa/services/errors") as typeof import("../../fa/services/errors");
    mocked.mockRejectedValue(new FaError("NOT_RECOVERABLE", "erased"));
    expect(await new Fa4DiscoveryContextReader(fakeDb(true)).read("22222222-2222-4222-8222-222222222222")).toBeNull();
  });
});
